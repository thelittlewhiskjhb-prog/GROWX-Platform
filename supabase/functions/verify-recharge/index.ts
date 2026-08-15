// Supabase Edge Function: verify-recharge
// Admin-only: verifies a pending recharge request and credits the client balance.
// Uses service role to bypass RLS for the balance credit.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const anonKey     = Deno.env.get('SUPABASE_ANON_KEY');

    // Auth client — verifies the caller's JWT
    const authClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false },
      global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } }
    });

    // Service client — bypasses RLS for financial operations
    const serviceClient = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false }
    });

    // Verify caller is authenticated
    const { data: { user }, error: userError } = await authClient.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Verify caller is admin
    const { data: adminProfile } = await serviceClient
      .from('users')
      .select('role')
      .eq('id', user.id)
      .single();

    if (adminProfile?.role !== 'admin') {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const { rechargeId, action, adminNotes } = await req.json();

    if (!rechargeId || !['verify', 'reject'].includes(action)) {
      return new Response(JSON.stringify({ error: 'Invalid request' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Load the recharge request (must be pending)
    const { data: recharge, error: fetchError } = await serviceClient
      .from('recharge_requests')
      .select('*')
      .eq('id', rechargeId)
      .eq('status', 'pending')
      .single();

    if (fetchError || !recharge) {
      return new Response(JSON.stringify({ error: 'Recharge request not found or already processed' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    if (action === 'reject') {
      await serviceClient
        .from('recharge_requests')
        .update({ status: 'rejected', admin_notes: adminNotes || null, verified_by: user.id, verified_at: new Date().toISOString() })
        .eq('id', rechargeId);

      // Audit
      await serviceClient.from('audit_log').insert({
        admin_id: user.id,
        action: 'reject_recharge',
        target_table: 'recharge_requests',
        target_id: rechargeId,
        details: { amount: recharge.amount, notes: adminNotes }
      });

      return new Response(JSON.stringify({ success: true, action: 'rejected' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // action === 'verify' — credit the wallet atomically
    // Use a DB transaction via RPC to ensure balance + ledger are consistent
    const { error: creditError } = await serviceClient.rpc('admin_credit_wallet_service', {
      p_user_id: recharge.user_id,
      p_amount: recharge.amount,
      p_description: `Recharge verified — ${recharge.network.toUpperCase()} ${recharge.amount} USDT`,
      p_admin_id: user.id
    });

    if (creditError) {
      console.error('Credit error:', creditError);
      return new Response(JSON.stringify({ error: 'Failed to credit wallet. ' + creditError.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Mark recharge verified
    await serviceClient
      .from('recharge_requests')
      .update({
        status: 'verified',
        admin_notes: adminNotes || null,
        verified_by: user.id,
        verified_at: new Date().toISOString()
      })
      .eq('id', rechargeId);

    await serviceClient.from('audit_log').insert({
      admin_id: user.id,
      action: 'verify_recharge',
      target_table: 'recharge_requests',
      target_id: rechargeId,
      details: { amount: recharge.amount, user_id: recharge.user_id, network: recharge.network }
    });

    return new Response(JSON.stringify({ success: true, action: 'verified', amount: recharge.amount }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (err) {
    console.error('verify-recharge error:', err);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
