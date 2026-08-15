-- Add wallet address and network type to withdrawal requests so admins can
-- see exactly where to send funds when processing a payout.

alter table public.withdrawals
  add column if not exists wallet_address text,
  add column if not exists network_type text check (network_type in ('trc20', 'erc20'));

-- Replace the withdrawal-request function so it stores the wallet fields.
create or replace function public.create_withdrawal_request(
  p_amount numeric,
  p_wallet_address text default null,
  p_network_type text default null
)
returns public.withdrawals
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_balance_after numeric;
  v_gross_amount numeric;
  v_fee_amount numeric;
  v_net_amount numeric;
  v_withdrawal public.withdrawals;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  if p_amount <= 0 then
    raise exception 'Withdrawal amount must be greater than zero';
  end if;

  if p_network_type is not null and p_network_type not in ('trc20', 'erc20') then
    raise exception 'Network type must be trc20 or erc20';
  end if;

  v_gross_amount := round(p_amount, 2);
  v_fee_amount  := round(v_gross_amount * 0.10, 2);
  v_net_amount  := round(v_gross_amount - v_fee_amount, 2);

  -- Reserve the gross amount and capture the post-deduction balance for the snapshot.
  update public.users
  set wallet_balance = wallet_balance - v_gross_amount,
      updated_at     = timezone('utc', now())
  where id = v_user_id
    and wallet_balance >= v_gross_amount
  returning wallet_balance into v_balance_after;

  if v_balance_after is null then
    raise exception 'Insufficient wallet balance for this withdrawal request';
  end if;

  insert into public.withdrawals (
    user_id,
    gross_amount,
    fee_amount,
    net_amount,
    wallet_balance_snapshot,
    wallet_address,
    network_type,
    status
  )
  values (
    v_user_id,
    v_gross_amount,
    v_fee_amount,
    v_net_amount,
    v_balance_after,
    p_wallet_address,
    p_network_type,
    'pending'
  )
  returning * into v_withdrawal;

  insert into public.transactions (
    user_id,
    transaction_type,
    amount,
    balance_after,
    reference_table,
    reference_id,
    description
  )
  values (
    v_user_id,
    'withdrawal_request',
    -v_gross_amount,
    v_balance_after,
    'withdrawals',
    v_withdrawal.id,
    'Withdrawal request submitted'
  );

  return v_withdrawal;
end;
$$;

grant execute on function public.create_withdrawal_request(numeric, text, text) to authenticated;
