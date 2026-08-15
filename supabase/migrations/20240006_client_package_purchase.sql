-- ============================================================
-- GROWX PLATFORM — CLIENT PACKAGE PURCHASE
-- ============================================================
-- Clients purchase packages using their available wallet balance.
--
-- Rules:
-- 1. Client must be authenticated and active.
-- 2. Price comes from the packages table.
-- 3. Client cannot buy the same package while it is ACTIVE.
-- 4. Different packages can be ACTIVE simultaneously.
-- 5. A COMPLETED package can be purchased again.
-- 6. Wallet deduction and package creation are atomic.
-- 7. Duplicate simultaneous purchases are prevented.
-- ============================================================

create or replace function public.purchase_package(
  p_package_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid              uuid := auth.uid();
  v_pkg              public.packages%rowtype;
  v_user_package_id  uuid;
  v_new_balance      numeric(18,2);
  v_cycle            int;
  v_total_return     numeric(18,2);
  v_payout_date      date;
  v_payout_amount    numeric(18,2);
  v_payout_type      text;
begin

  -- ----------------------------------------------------------
  -- 1. Authentication
  -- ----------------------------------------------------------
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  -- ----------------------------------------------------------
  -- 2. Account must be active
  -- ----------------------------------------------------------
  if not public.is_active_user() then
    raise exception 'Account is not active';
  end if;

  -- ----------------------------------------------------------
  -- 3. Lock the user's wallet row.
  -- This prevents two simultaneous purchases from spending
  -- the same available balance.
  -- ----------------------------------------------------------
  perform 1
  from public.users
  where id = v_uid
  for update;

  if not found then
    raise exception 'User profile not found';
  end if;

  -- ----------------------------------------------------------
  -- 4. Expire completed package cycles before checking whether
  -- the client can purchase the same package again.
  --
  -- The existing system uses six cycles, each 10 days apart.
  -- After the sixth cycle date has passed, the package is
  -- considered completed.
  -- ----------------------------------------------------------
  update public.user_packages up
  set status = 'completed'
  where up.user_id = v_uid
    and up.status = 'active'
    and exists (
      select 1
      from public.cycles c
      where c.user_package_id = up.id
      group by c.user_package_id
      having max(c.payout_date) < current_date
    );

  -- ----------------------------------------------------------
  -- 5. Retrieve the trusted package from the database.
  -- Never trust a price supplied by the browser.
  -- ----------------------------------------------------------
  select *
  into v_pkg
  from public.packages
  where id = p_package_id
    and active = true
  for update;

  if not found then
    raise exception 'Package not found or inactive';
  end if;

  -- ----------------------------------------------------------
  -- 6. SAME PACKAGE protection.
  --
  -- Only the same package is blocked.
  -- Other package IDs remain available.
  -- ----------------------------------------------------------
  if exists (
    select 1
    from public.user_packages
    where user_id = v_uid
      and package_id = p_package_id
      and status = 'active'
  ) then
    raise exception 'This package is already active';
  end if;

  -- ----------------------------------------------------------
  -- 7. Check available wallet balance.
  -- ----------------------------------------------------------
  select wallet_balance
  into v_new_balance
  from public.users
  where id = v_uid;

  if v_new_balance < v_pkg.amount then
    raise exception
      'Insufficient available balance. Required: %, Available: %',
      v_pkg.amount,
      v_new_balance;
  end if;

  -- ----------------------------------------------------------
  -- 8. Calculate expected package return using trusted
  -- server-side package data.
  --
  -- Preserve the existing GROWX package-cycle structure.
  -- ----------------------------------------------------------
  v_total_return := v_pkg.amount * 1.5;

  -- ----------------------------------------------------------
  -- 9. Deduct wallet balance atomically.
  -- ----------------------------------------------------------
  update public.users
  set wallet_balance = wallet_balance - v_pkg.amount,
      updated_at = now()
  where id = v_uid
    and wallet_balance >= v_pkg.amount
  returning wallet_balance
  into v_new_balance;

  if not found then
    raise exception 'Insufficient available balance';
  end if;

  -- ----------------------------------------------------------
  -- 10. Create the user's package.
  -- allocated_by remains NULL because this is a CLIENT
  -- purchase, not an admin allocation.
  -- ----------------------------------------------------------
  insert into public.user_packages (
    user_id,
    package_id,
    principal_amount,
    total_expected_return,
    status
  )
  values (
    v_uid,
    p_package_id,
    v_pkg.amount,
    v_total_return,
    'active'
  )
  returning id
  into v_user_package_id;

  -- ----------------------------------------------------------
  -- 11. Create the six existing GROWX cycles.
  -- ----------------------------------------------------------
  for v_cycle in 1..6 loop

    v_payout_date := current_date + ((v_cycle * 10) || ' days')::interval;

    if v_cycle <= 2 then
      v_payout_type   := 'principal_return';
      v_payout_amount := v_pkg.amount * 0.5;
    else
      v_payout_type   := 'profit';
      v_payout_amount := v_pkg.amount * 0.125;
    end if;

    insert into public.cycles (
      user_package_id,
      cycle_number,
      payout_type,
      payout_date,
      payout_amount
    )
    values (
      v_user_package_id,
      v_cycle,
      v_payout_type,
      v_payout_date,
      v_payout_amount
    );

  end loop;

  -- ----------------------------------------------------------
  -- 12. Record the wallet deduction in the immutable ledger.
  -- ----------------------------------------------------------
  insert into public.transactions (
    user_id,
    transaction_type,
    amount,
    balance_after,
    description,
    reference_id,
    reference_type
  )
  values (
    v_uid,
    'package_purchase',
    -v_pkg.amount,
    v_new_balance,
    'Package purchase: ' || v_pkg.name,
    v_user_package_id,
    'user_packages'
  );

  -- ----------------------------------------------------------
  -- 13. Return the newly created package ID.
  -- ----------------------------------------------------------
  return v_user_package_id;

end;
$$;

-- ------------------------------------------------------------
-- Security:
-- Allow authenticated users to call the purchase function.
-- The function itself performs all authorization and validation.
-- ------------------------------------------------------------

revoke all on function public.purchase_package(uuid) from public;

grant execute on function public.purchase_package(uuid)
to authenticated;
