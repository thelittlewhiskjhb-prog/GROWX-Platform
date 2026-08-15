// Supabase Edge Function: process-withdrawal
// Handles two actions:
//   request — client submits a new withdrawal
//   review  — admin approves/rejects/completes a withdrawal

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

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const anonKey     = Deno.env.get('SUPABASE_ANON_KEY');

  if (!supabaseUrl || !serviceKey || !anonKey) {
    return jsonResponse({ error: 'Missing required server configuration' }, 500);
  }

  const authClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } }
  });

  const serviceClient = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false }
  });

  try {
    const { data: { user }, error: userError } = await authClient.auth.getUser();
    if (userError || !user) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    const { data: profile } = await serviceClient
      .from('users')
      .select('role, status, wallet_balance')
      .eq('id', user.id)
      .single();

    const body = await req.json().catch(() => ({}));
    const { action } = body;

    // ─── CLIENT: Submit withdrawal request ───────────────────
    if (action === 'request') {
      if (profile?.status !== 'active') {
        return jsonResponse({ error: 'Account is not active' }, 403);
      }

      const { amount, walletAddress, networkType } = body;
      const parsedAmount = Number(amount);
      const parsedWallet = typeof walletAddress === 'string' ? walletAddress.trim() : '';
      const parsedNetwork = typeof networkType === 'string' ? networkType : '';

      if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
        return jsonResponse({ error: 'Amount must be greater than zero' }, 400);
      }

      // Delegate to the atomic RPC — validation, balance deduction, and
      // ledger entry all happen in a single database transaction.
      const authUserClient = createClient(supabaseUrl, anonKey, {
        auth: { persistSession: false },
        global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } }
      });

      const { data: withdrawalId, error: rpcError } = await authUserClient.rpc('request_withdrawal', {
        p_amount: parsedAmount,
        p_wallet: parsedWallet,
        p_network: parsedNetwork
      });

      if (rpcError) {
        return jsonResponse({ error: rpcError.message }, 400);
      }

      return jsonResponse({ success: true, withdrawalId });
    }

    // ─── ADMIN: Review (approve / reject / complete) ─────────
    if (action === 'review') {
      if (profile?.role !== 'admin') {
        return jsonResponse({ error: 'Forbidden' }, 403);
      }

      const { withdrawalId, status, notes, transactionHash } = body;
      const isUuid = typeof withdrawalId === 'string' && /^[0-9a-f-]{36}$/i.test(withdrawalId);
      const normalizedStatus = typeof status === 'string' ? status : '';
      const normalizedHash = typeof transactionHash === 'string' ? transactionHash.trim() : '';

      if (!isUuid || !['approved', 'rejected', 'completed'].includes(normalizedStatus)) {
        return jsonResponse({ error: 'Invalid review parameters' }, 400);
      }

      if (normalizedStatus === 'completed' && !normalizedHash) {
        return jsonResponse({ error: 'Transaction hash is required for completion' }, 400);
      }

      const { error: reviewError } = await serviceClient.rpc('admin_review_withdrawal', {
        p_withdrawal_id: withdrawalId,
        p_status: normalizedStatus,
        p_admin_notes: typeof notes === 'string' ? notes.trim() : null,
        p_transaction_hash: normalizedStatus === 'completed' ? normalizedHash : null
      });

      if (reviewError) {
        const reviewStatus = /not found/i.test(reviewError.message) ? 404
          : /cannot transition|invalid|required|unauthorized|already/i.test(reviewError.message) ? 400
          : 500;
        return jsonResponse({ error: reviewError.message }, reviewStatus);
      }

      return jsonResponse({ success: true, status: normalizedStatus });
    }

    return jsonResponse({ error: 'Unknown action' }, 400);

  } catch (err) {
    console.error('process-withdrawal error:', err);
    return jsonResponse({ error: 'Internal server error' }, 500);
  }
});

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}
