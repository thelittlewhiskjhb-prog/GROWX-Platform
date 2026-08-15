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

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const anonKey     = Deno.env.get('SUPABASE_ANON_KEY');

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

    const body = await req.json();
    const { action } = body;

    // ─── CLIENT: Submit withdrawal request ───────────────────
    if (action === 'request') {
      if (profile?.status !== 'active') {
        return jsonResponse({ error: 'Account is not active' }, 403);
      }

      const { amount, walletAddress, networkType } = body;

      const parsedAmount = Number(amount);
      if (!parsedAmount || parsedAmount <= 0) {
        return jsonResponse({ error: 'Invalid amount' }, 400);
      }

      if (!['trc20', 'erc20'].includes(networkType)) {
        return jsonResponse({ error: 'Invalid network. Choose trc20 or erc20.' }, 400);
      }

      if (!walletAddress || walletAddress.trim().length < 10) {
        return jsonResponse({ error: 'Invalid wallet address' }, 400);
      }

      // Validate address format
      const trimmedAddress = walletAddress.trim();
      if (networkType === 'trc20' && !/^T[a-zA-Z0-9]{33}$/.test(trimmedAddress)) {
        return jsonResponse({ error: 'Invalid TRC20 address format (must start with T, 34 characters)' }, 400);
      }
      if (networkType === 'erc20' && !/^0x[a-fA-F0-9]{40}$/.test(trimmedAddress)) {
        return jsonResponse({ error: 'Invalid ERC20 address format (must start with 0x, 42 characters)' }, 400);
      }

      // Server-side balance check
      if ((profile?.wallet_balance ?? 0) < parsedAmount) {
        return jsonResponse({ error: 'Insufficient wallet balance' }, 400);
      }

      const feeAmount  = Number((parsedAmount * 0.1).toFixed(2));
      const netAmount  = Number((parsedAmount - feeAmount).toFixed(2));

      const { data: withdrawal, error: wError } = await serviceClient
        .from('withdrawals')
        .insert({
          user_id: user.id,
          gross_amount: parsedAmount,
          fee_amount: feeAmount,
          net_amount: netAmount,
          network: networkType,
          wallet_address: trimmedAddress,
          status: 'processing'
        })
        .select()
        .single();

      if (wError) {
        console.error('withdrawal insert error:', wError);
        return jsonResponse({ error: 'Unable to submit withdrawal' }, 500);
      }

      // Reserve the amount (debit wallet balance) so client cannot double-withdraw
      await serviceClient
        .from('users')
        .update({ wallet_balance: (profile.wallet_balance - parsedAmount), updated_at: new Date().toISOString() })
        .eq('id', user.id);

      await serviceClient.from('transactions').insert({
        user_id: user.id,
        transaction_type: 'withdrawal_request',
        amount: -parsedAmount,
        description: `Withdrawal request — ${networkType.toUpperCase()} ${parsedAmount} USDT`,
        reference_id: withdrawal.id,
        reference_type: 'withdrawals'
      });

      return jsonResponse({ success: true, withdrawal });
    }

    // ─── ADMIN: Review (approve / reject / complete) ─────────
    if (action === 'review') {
      if (profile?.role !== 'admin') {
        return jsonResponse({ error: 'Forbidden' }, 403);
      }

      const { withdrawalId, status, notes, transactionHash } = body;

      if (!withdrawalId || !['approved', 'rejected', 'completed'].includes(status)) {
        return jsonResponse({ error: 'Invalid review parameters' }, 400);
      }

      const { data: w } = await serviceClient
        .from('withdrawals')
        .select('*')
        .eq('id', withdrawalId)
        .single();

      if (!w) {
        return jsonResponse({ error: 'Withdrawal not found' }, 404);
      }

      // Validate state transition
      const validTransitions = {
        processing: ['approved', 'rejected'],
        approved:   ['completed', 'rejected']
      };

      if (!validTransitions[w.status]?.includes(status)) {
        return jsonResponse({ error: `Cannot transition from ${w.status} to ${status}` }, 400);
      }

      const updatePayload = {
        status,
        admin_notes: notes || null,
        processed_by: user.id,
        processed_at: new Date().toISOString()
      };

      if (status === 'completed' && transactionHash) {
        updatePayload.admin_transaction_hash = transactionHash.trim();
      }

      // If rejected — refund the reserved amount
      if (status === 'rejected') {
        const { data: clientProfile } = await serviceClient
          .from('users')
          .select('wallet_balance')
          .eq('id', w.user_id)
          .single();

        await serviceClient
          .from('users')
          .update({
            wallet_balance: (clientProfile?.wallet_balance ?? 0) + w.gross_amount,
            updated_at: new Date().toISOString()
          })
          .eq('id', w.user_id);

        await serviceClient.from('transactions').insert({
          user_id: w.user_id,
          transaction_type: 'withdrawal_refund',
          amount: w.gross_amount,
          description: `Withdrawal rejected — refund`,
          reference_id: withdrawalId,
          reference_type: 'withdrawals'
        });
      }

      await serviceClient.from('withdrawals').update(updatePayload).eq('id', withdrawalId);

      await serviceClient.from('audit_log').insert({
        admin_id: user.id,
        action: `withdrawal_${status}`,
        target_table: 'withdrawals',
        target_id: withdrawalId,
        details: { status, notes, transactionHash }
      });

      return jsonResponse({ success: true, status });
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
