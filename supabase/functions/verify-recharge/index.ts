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

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const anonKey     = Deno.env.get('SUPABASE_ANON_KEY');

    if (!supabaseUrl || !serviceKey || !anonKey) {
      return jsonResponse({ error: 'Missing required server configuration' }, 500);
    }

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
      return jsonResponse({ error: 'Forbidden' }, 403);
    }

    const { rechargeId, action, adminNotes } = await req.json().catch(() => ({}));

    const isUuid = typeof rechargeId === 'string' && /^[0-9a-f-]{36}$/i.test(rechargeId);
    if (!isUuid || !['verify', 'reject'].includes(action)) {
      return jsonResponse({ error: 'Invalid request' }, 400);
    }

    const { error: reviewError } = await serviceClient.rpc('admin_review_recharge', {
      p_recharge_id: rechargeId,
      p_action: action,
      p_admin_notes: typeof adminNotes === 'string' ? adminNotes.trim() : null
    });

    if (reviewError) {
      const status = /not found/i.test(reviewError.message) ? 404
        : /already processed|invalid|unauthorized/i.test(reviewError.message) ? 400
        : 500;
      return jsonResponse({ error: reviewError.message }, status);
    }

    return jsonResponse({ success: true, action: action === 'verify' ? 'verified' : 'rejected' });

  } catch (err) {
    console.error('verify-recharge error:', err);
    return jsonResponse({ error: 'Internal server error' }, 500);
  }
});

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}
