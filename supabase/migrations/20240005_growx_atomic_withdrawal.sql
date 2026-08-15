-- ============================================================
-- GROWX PLATFORM — ATOMIC WITHDRAWAL RPC
-- Replaces the two-step insert+debit in the Edge Function
-- with a single atomic operation.
-- ============================================================

create or replace function public.request_withdrawal(
  p_amount       numeric,
  p_wallet       text,
  p_network      text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid          uuid := auth.uid();
  v_fee          numeric;
  v_net          numeric;
  v_withdrawal_id uuid;
  v_new_balance  numeric;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if not public.is_active_user() then
    raise exception 'Account is not active';
  end if;

  if p_amount <= 0 then
    raise exception 'Amount must be greater than zero';
  end if;

  if p_network not in ('trc20', 'erc20') then
    raise exception 'Invalid network. Choose trc20 or erc20.';
  end if;

  if p_network = 'trc20' and p_wallet !~ '^T[a-zA-Z0-9]{33}$' then
    raise exception 'Invalid TRC20 address format (must start with T, 34 characters)';
  end if;

  if p_network = 'erc20' and p_wallet !~ '^0x[a-fA-F0-9]{40}$' then
    raise exception 'Invalid ERC20 address format (must start with 0x, 42 characters)';
  end if;

  v_fee := round(p_amount * 0.1, 2);
  v_net := p_amount - v_fee;

  -- Atomically deduct balance and fail if insufficient
  update public.users
    set wallet_balance = wallet_balance - p_amount,
        updated_at = now()
  where id = v_uid
    and wallet_balance >= p_amount
  returning wallet_balance into v_new_balance;

  if not found then
    raise exception 'Insufficient wallet balance';
  end if;

  -- Record the withdrawal
  insert into public.withdrawals (user_id, gross_amount, fee_amount, net_amount, network, wallet_address, status)
  values (v_uid, p_amount, v_fee, v_net, p_network, p_wallet, 'processing')
  returning id into v_withdrawal_id;

  -- Immutable ledger entry
  insert into public.transactions (user_id, transaction_type, amount, balance_after, description, reference_id, reference_type)
  values (v_uid, 'withdrawal_request', -p_amount, v_new_balance,
          'Withdrawal request — ' || upper(p_network) || ' ' || p_amount || ' USDT',
          v_withdrawal_id, 'withdrawals');

  return v_withdrawal_id;
end;
$$;

-- ============================================================
-- admin_review_withdrawal
-- Race-safe admin state transitions with refund and auditing.
-- ============================================================
create or replace function public.admin_review_withdrawal(
  p_withdrawal_id     uuid,
  p_status            text,
  p_admin_notes       text default null,
  p_transaction_hash  text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_id uuid := auth.uid();
  v_w        public.withdrawals%rowtype;
  v_new_bal  numeric;
begin
  if v_admin_id is null or not public.is_admin() then
    raise exception 'Unauthorized';
  end if;

  if p_status not in ('approved', 'rejected', 'completed') then
    raise exception 'Invalid status';
  end if;

  select * into v_w
  from public.withdrawals
  where id = p_withdrawal_id
  for update;

  if not found then
    raise exception 'Withdrawal not found';
  end if;

  if (v_w.status = 'processing' and p_status not in ('approved', 'rejected'))
     or (v_w.status = 'approved' and p_status not in ('completed', 'rejected'))
     or (v_w.status not in ('processing', 'approved')) then
    raise exception 'Cannot transition from % to %', v_w.status, p_status;
  end if;

  if p_status = 'completed' and coalesce(trim(p_transaction_hash), '') = '' then
    raise exception 'Transaction hash is required to complete a withdrawal';
  end if;

  if p_status = 'rejected' then
    update public.users
      set wallet_balance = wallet_balance + v_w.gross_amount,
          updated_at = now()
    where id = v_w.user_id
    returning wallet_balance into v_new_bal;

    if not found then
      raise exception 'Withdrawal user not found';
    end if;

    insert into public.transactions (user_id, transaction_type, amount, balance_after, description, reference_id, reference_type)
    values (
      v_w.user_id,
      'withdrawal_refund',
      v_w.gross_amount,
      v_new_bal,
      'Withdrawal rejected — refund',
      v_w.id,
      'withdrawals'
    );
  end if;

  update public.withdrawals
    set status = p_status,
        admin_notes = nullif(trim(coalesce(p_admin_notes, '')), ''),
        processed_by = v_admin_id,
        processed_at = now(),
        admin_transaction_hash = case
          when p_status = 'completed' then trim(p_transaction_hash)
          else admin_transaction_hash
        end
  where id = v_w.id;

  insert into public.audit_log (admin_id, action, target_table, target_id, details)
  values (
    v_admin_id,
    'withdrawal_' || p_status,
    'withdrawals',
    v_w.id,
    json_build_object(
      'previous_status', v_w.status,
      'new_status', p_status,
      'transaction_hash', nullif(trim(coalesce(p_transaction_hash, '')), ''),
      'notes', nullif(trim(coalesce(p_admin_notes, '')), '')
    )
  );
end;
$$;

-- ============================================================
-- admin_review_recharge
-- Race-safe recharge verification/rejection with audit trail.
-- ============================================================
create or replace function public.admin_review_recharge(
  p_recharge_id  uuid,
  p_action       text,
  p_admin_notes  text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_id uuid := auth.uid();
  v_r        public.recharge_requests%rowtype;
begin
  if v_admin_id is null or not public.is_admin() then
    raise exception 'Unauthorized';
  end if;

  if p_action not in ('verify', 'reject') then
    raise exception 'Invalid action';
  end if;

  select * into v_r
  from public.recharge_requests
  where id = p_recharge_id
  for update;

  if not found then
    raise exception 'Recharge request not found';
  end if;

  if v_r.status <> 'pending' then
    raise exception 'Recharge request already processed';
  end if;

  if p_action = 'verify' then
    perform public.admin_credit_wallet(
      v_r.user_id,
      v_r.amount,
      'Recharge verified — ' || upper(v_r.network) || ' ' || v_r.amount || ' USDT'
    );
  end if;

  update public.recharge_requests
    set status = case when p_action = 'verify' then 'verified' else 'rejected' end,
        admin_notes = nullif(trim(coalesce(p_admin_notes, '')), ''),
        verified_by = v_admin_id,
        verified_at = now()
  where id = v_r.id;

  insert into public.audit_log (admin_id, action, target_table, target_id, details)
  values (
    v_admin_id,
    case when p_action = 'verify' then 'verify_recharge' else 'reject_recharge' end,
    'recharge_requests',
    v_r.id,
    json_build_object(
      'amount', v_r.amount,
      'network', v_r.network,
      'user_id', v_r.user_id,
      'notes', nullif(trim(coalesce(p_admin_notes, '')), '')
    )
  );
end;
$$;

-- ============================================================
-- Remove direct table update policies on users for safer admin paths.
-- ============================================================
drop policy if exists "admins_update_user_non_financial" on public.users;
drop policy if exists "admins_update_user_status_and_profile" on public.users;

-- ============================================================
-- Function execute permissions hardening
-- ============================================================
revoke all on function public.request_withdrawal(numeric, text, text) from public;
revoke all on function public.admin_review_withdrawal(uuid, text, text, text) from public;
revoke all on function public.admin_review_recharge(uuid, text, text) from public;

grant execute on function public.request_withdrawal(numeric, text, text) to authenticated, service_role;
grant execute on function public.admin_review_withdrawal(uuid, text, text, text) to authenticated, service_role;
grant execute on function public.admin_review_recharge(uuid, text, text) to authenticated, service_role;
