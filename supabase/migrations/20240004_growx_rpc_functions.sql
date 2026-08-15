-- ============================================================
-- GROWX PLATFORM — SERVER-SIDE RPC FUNCTIONS
-- All functions use SECURITY DEFINER so they run as the
-- function owner (superuser/postgres) and bypass RLS where
-- needed. The caller's auth.uid() is still accessible and
-- is used for authorization checks inside the function.
-- ============================================================

-- ============================================================
-- upsert_my_profile
-- Creates or updates the current user's profile row.
-- ============================================================
create or replace function public.upsert_my_profile(
  p_full_name text default null,
  p_phone     text default null,
  p_pin       text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_pin_hash text;
  v_code    text;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if p_pin is not null then
    if p_pin !~ '^\d{4}$' then
      raise exception 'PIN must be exactly 4 digits';
    end if;
    v_pin_hash := crypt(p_pin, gen_salt('bf'));
  end if;

  -- Generate a unique client code if the user does not already have one
  select client_code into v_code from public.users where id = v_uid;

  if v_code is null then
    v_code := upper(substr(md5(v_uid::text || now()::text), 1, 8));
  end if;

  insert into public.users (id, full_name, phone, email, pin_hash, client_code)
  values (
    v_uid,
    p_full_name,
    p_phone,
    (select email from auth.users where id = v_uid),
    coalesce(v_pin_hash, ''),
    v_code
  )
  on conflict (id) do update
    set full_name  = coalesce(excluded.full_name, users.full_name),
        phone      = coalesce(excluded.phone,     users.phone),
        email      = coalesce(excluded.email,     users.email),
        pin_hash   = case when excluded.pin_hash <> '' then excluded.pin_hash else users.pin_hash end,
        updated_at = now();
end;
$$;

-- ============================================================
-- verify_user_pin
-- Returns true if the supplied PIN matches the stored hash.
-- ============================================================
create or replace function public.verify_user_pin(p_pin text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_hash    text;
begin
  if v_uid is null then
    return false;
  end if;

  select pin_hash into v_hash from public.users where id = v_uid;

  if v_hash is null or v_hash = '' then
    return false;
  end if;

  return v_hash = crypt(p_pin, v_hash);
end;
$$;

-- ============================================================
-- admin_dashboard_metrics
-- Returns aggregate stats for the admin overview.
-- ============================================================
create or replace function public.admin_dashboard_metrics()
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result json;
begin
  if not public.is_admin() then
    raise exception 'Unauthorized';
  end if;

  select json_build_object(
    'total_invested',      coalesce(sum(up.principal_amount), 0),
    'total_returned',      coalesce(sum(case when c.status = 'paid' then c.payout_amount else 0 end), 0),
    'total_fees_collected',coalesce((select sum(fee_amount) from public.withdrawals where status = 'completed'), 0),
    'pending_withdrawals', (select count(*) from public.withdrawals where status = 'processing'),
    'active_users',        (select count(*) from public.users where status = 'active' and role = 'client'),
    'active_packages',     (select count(*) from public.user_packages where status = 'active')
  ) into v_result
  from public.user_packages up
  left join public.cycles c on c.user_package_id = up.id;

  return v_result;
end;
$$;

-- ============================================================
-- admin_credit_wallet
-- Admin credits a client's wallet balance and records the
-- transaction. Atomic — both the balance update and the
-- ledger entry succeed or fail together.
-- ============================================================
create or replace function public.admin_credit_wallet(
  p_user_id    uuid,
  p_amount     numeric,
  p_description text default 'Admin fund transfer'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new_balance numeric;
begin
  if not public.is_admin() then
    raise exception 'Unauthorized';
  end if;

  if p_amount <= 0 then
    raise exception 'Amount must be greater than zero';
  end if;

  update public.users
    set wallet_balance = wallet_balance + p_amount,
        updated_at = now()
  where id = p_user_id
  returning wallet_balance into v_new_balance;

  if not found then
    raise exception 'User not found';
  end if;

  insert into public.transactions (user_id, transaction_type, amount, balance_after, description)
  values (p_user_id, 'admin_credit', p_amount, v_new_balance, p_description);

  insert into public.audit_log (admin_id, action, target_table, target_id, details)
  values (
    auth.uid(),
    'credit_wallet',
    'users',
    p_user_id,
    json_build_object('amount', p_amount, 'description', p_description)
  );
end;
$$;

-- ============================================================
-- admin_set_user_status
-- Admin sets user status (active/suspended).
-- ============================================================
create or replace function public.admin_set_user_status(
  p_user_id  uuid,
  p_status   text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Unauthorized';
  end if;

  if p_status not in ('active', 'suspended') then
    raise exception 'Invalid status value';
  end if;

  update public.users
    set status = p_status, updated_at = now()
  where id = p_user_id;

  if not found then
    raise exception 'User not found';
  end if;

  insert into public.audit_log (admin_id, action, target_table, target_id, details)
  values (
    auth.uid(),
    'set_user_status',
    'users',
    p_user_id,
    json_build_object('new_status', p_status)
  );
end;
$$;

-- ============================================================
-- admin_allocate_package
-- Admin creates a package assignment for a client.
-- The principal amount is taken from the packages table —
-- never trusted from the browser.
-- ============================================================
create or replace function public.admin_allocate_package(
  p_user_id    uuid,
  p_package_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pkg            public.packages%rowtype;
  v_user_package_id uuid;
  v_cycle          int;
  v_total_return   numeric;
  v_payout_date    date;
  v_payout_amount  numeric;
  v_payout_type    text;
begin
  if not public.is_admin() then
    raise exception 'Unauthorized';
  end if;

  select * into v_pkg from public.packages where id = p_package_id and active = true;
  if not found then
    raise exception 'Package not found or inactive';
  end if;

  if exists (
    select 1 from public.user_packages
    where user_id = p_user_id and package_id = p_package_id and status = 'active'
  ) then
    raise exception 'Client already has an active allocation for this package';
  end if;

  v_total_return := v_pkg.amount * 1.5;

  insert into public.user_packages (user_id, package_id, principal_amount, total_expected_return, allocated_by)
  values (p_user_id, p_package_id, v_pkg.amount, v_total_return, auth.uid())
  returning id into v_user_package_id;

  -- Create 6 cycles starting today
  for v_cycle in 1..6 loop
    v_payout_date := current_date + ((v_cycle * 10) || ' days')::interval;

    if v_cycle <= 2 then
      v_payout_type   := 'principal_return';
      v_payout_amount := v_pkg.amount * 0.5;
    else
      v_payout_type   := 'profit';
      v_payout_amount := v_pkg.amount * 0.125;
    end if;

    insert into public.cycles (user_package_id, cycle_number, payout_type, payout_date, payout_amount)
    values (v_user_package_id, v_cycle, v_payout_type, v_payout_date, v_payout_amount);
  end loop;

  insert into public.audit_log (admin_id, action, target_table, target_id, details)
  values (
    auth.uid(),
    'allocate_package',
    'user_packages',
    v_user_package_id,
    json_build_object('user_id', p_user_id, 'package_id', p_package_id, 'amount', v_pkg.amount)
  );

  return v_user_package_id;
end;
$$;

-- ============================================================
-- claim_daily_reward
-- Atomically claims a daily reward for the authenticated user.
-- Enforces 24h rule entirely server-side.
-- The reward amount is calculated from the user's active
-- packages — never trusted from the browser.
-- ============================================================
create or replace function public.claim_daily_reward()
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid           uuid := auth.uid();
  v_last_claimed  timestamptz;
  v_reward_amount numeric := 0;
  v_new_balance   numeric;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if not public.is_active_user() then
    raise exception 'Account is not active';
  end if;

  -- Check 24h cooldown
  select max(claimed_at) into v_last_claimed
  from public.reward_claims
  where user_id = v_uid;

  if v_last_claimed is not null and v_last_claimed > now() - interval '24 hours' then
    raise exception 'Daily reward already claimed. Next claim available in % hours.',
      extract(hour from (v_last_claimed + interval '24 hours') - now())::int + 1;
  end if;

  -- Calculate reward from active packages (server-side amount)
  select coalesce(sum(p.daily_reward), 0) into v_reward_amount
  from public.user_packages up
  join public.packages p on p.id = up.package_id
  where up.user_id = v_uid and up.status = 'active';

  if v_reward_amount <= 0 then
    raise exception 'No active packages — no daily reward available';
  end if;

  -- Record the claim
  insert into public.reward_claims (user_id, amount) values (v_uid, v_reward_amount);

  -- Credit reward balance and record transaction atomically
  update public.users
    set reward_balance = reward_balance + v_reward_amount,
        updated_at = now()
  where id = v_uid
  returning reward_balance into v_new_balance;

  insert into public.transactions (user_id, transaction_type, amount, balance_after, description)
  values (v_uid, 'daily_reward', v_reward_amount, v_new_balance, 'Daily reward claim');

  return json_build_object('reward_amount', v_reward_amount, 'new_reward_balance', v_new_balance);
end;
$$;

-- ============================================================
-- redeem_gift_code
-- Atomically redeems a gift code for the authenticated user.
-- ============================================================
create or replace function public.redeem_gift_code(p_code text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid       uuid := auth.uid();
  v_code_row  public.gift_codes%rowtype;
  v_new_bal   numeric;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if not public.is_active_user() then
    raise exception 'Account is not active';
  end if;

  -- Lock the gift code row to prevent race conditions
  select * into v_code_row
  from public.gift_codes
  where code = upper(trim(p_code))
    and active = true
    and (expires_at is null or expires_at > now())
  for update;

  if not found then
    raise exception 'Gift code is invalid, expired, or inactive';
  end if;

  if v_code_row.redemption_count >= v_code_row.max_redemptions then
    raise exception 'This gift code has already reached its maximum redemptions';
  end if;

  -- Check for duplicate redemption by this user
  if exists (
    select 1 from public.gift_code_redemptions
    where gift_code_id = v_code_row.id and user_id = v_uid
  ) then
    raise exception 'You have already redeemed this gift code';
  end if;

  -- Record redemption
  insert into public.gift_code_redemptions (gift_code_id, user_id)
  values (v_code_row.id, v_uid);

  -- Increment redemption count and possibly deactivate
  update public.gift_codes
    set redemption_count = redemption_count + 1,
        active = (redemption_count + 1 < max_redemptions)
  where id = v_code_row.id;

  -- Credit wallet balance atomically
  update public.users
    set wallet_balance = wallet_balance + v_code_row.reward_amount,
        updated_at = now()
  where id = v_uid
  returning wallet_balance into v_new_bal;

  insert into public.transactions (user_id, transaction_type, amount, balance_after, description, reference_id, reference_type)
  values (v_uid, 'gift_code', v_code_row.reward_amount, v_new_bal,
          'Gift code: ' || v_code_row.code, v_code_row.id, 'gift_codes');

  return json_build_object('reward_amount', v_code_row.reward_amount, 'new_wallet_balance', v_new_bal);
end;
$$;

-- ============================================================
-- create_recharge_request
-- Client submits a recharge/deposit request.
-- The deposit address is fetched server-side from the
-- deposit_addresses table — never trusted from the browser.
-- ============================================================
create or replace function public.create_recharge_request(
  p_amount  numeric,
  p_network text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_address text;
  v_req_id  uuid;
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

  select address into v_address
  from public.deposit_addresses
  where network = p_network and active = true;

  if not found then
    raise exception 'Deposit address not configured for this network. Contact support.';
  end if;

  insert into public.recharge_requests (user_id, amount, network, deposit_address)
  values (v_uid, p_amount, p_network, v_address)
  returning id into v_req_id;

  return v_req_id;
end;
$$;

-- ============================================================
-- process_payouts
-- Called by admin or a scheduled function to pay due cycles.
-- ============================================================
create or replace function public.process_payouts()
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cycle     record;
  v_processed int := 0;
  v_new_bal   numeric;
begin
  -- Allow admin or service role (no auth.uid() check for scheduled invocations)
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'Unauthorized';
  end if;

  for v_cycle in
    select c.id, c.user_package_id, c.payout_amount, c.cycle_number,
           up.user_id, up.id as up_id
    from public.cycles c
    join public.user_packages up on up.id = c.user_package_id
    where c.status = 'pending'
      and c.payout_date <= current_date
      and up.status = 'active'
    for update of c
  loop
    -- Credit wallet
    update public.users
      set wallet_balance = wallet_balance + v_cycle.payout_amount,
          updated_at = now()
    where id = v_cycle.user_id
    returning wallet_balance into v_new_bal;

    -- Mark cycle paid
    update public.cycles
      set status = 'paid', paid_at = now()
    where id = v_cycle.id;

    -- Record transaction
    insert into public.transactions (user_id, transaction_type, amount, balance_after, description, reference_id, reference_type)
    values (v_cycle.user_id, 'cycle_payout', v_cycle.payout_amount, v_new_bal,
            'Cycle ' || v_cycle.cycle_number || ' payout', v_cycle.user_package_id, 'user_packages');

    -- If cycle 6, mark package completed
    if v_cycle.cycle_number = 6 then
      update public.user_packages
        set status = 'completed'
      where id = v_cycle.up_id;
    end if;

    v_processed := v_processed + 1;
  end loop;

  return json_build_object('processed_cycles', v_processed);
end;
$$;
