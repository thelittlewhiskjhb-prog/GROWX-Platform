create extension if not exists pgcrypto;

create table if not exists public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  role text not null default 'client' check (role in ('client', 'admin')),
  full_name text not null default 'GROWX User',
  phone text,
  pin_hash text,
  status text not null default 'active' check (status in ('active', 'suspended')),
  wallet_balance numeric(14, 2) not null default 0 check (wallet_balance >= 0),
  reward_balance numeric(14, 2) not null default 0 check (reward_balance >= 0),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.packages (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null unique,
  amount numeric(14, 2) not null check (amount >= 50),
  active boolean not null default true,
  cycle_count integer not null default 6 check (cycle_count = 6),
  cycle_duration_days integer not null default 10 check (cycle_duration_days = 10),
  total_return_multiplier numeric(6, 2) not null default 1.50 check (total_return_multiplier = 1.50),
  sort_order integer not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.user_packages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  package_id uuid not null references public.packages (id),
  principal_amount numeric(14, 2) not null check (principal_amount >= 50),
  total_expected_return numeric(14, 2) not null check (total_expected_return >= principal_amount),
  status text not null default 'active' check (status in ('active', 'completed', 'cancelled')),
  purchased_at timestamptz not null default timezone('utc', now()),
  completed_at timestamptz,
  next_payout_at timestamptz
);

create table if not exists public.cycles (
  id uuid primary key default gen_random_uuid(),
  user_package_id uuid not null references public.user_packages (id) on delete cascade,
  cycle_number integer not null check (cycle_number between 1 and 6),
  starts_at timestamptz not null,
  payout_date timestamptz not null,
  payout_amount numeric(14, 2) not null check (payout_amount > 0),
  payout_type text not null check (payout_type in ('principal_return', 'profit')),
  status text not null default 'pending' check (status in ('pending', 'paid')),
  paid_at timestamptz,
  unique (user_package_id, cycle_number)
);

create table if not exists public.withdrawals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  gross_amount numeric(14, 2) not null check (gross_amount > 0),
  fee_amount numeric(14, 2) not null check (fee_amount >= 0),
  net_amount numeric(14, 2) not null check (net_amount >= 0),
  wallet_balance_snapshot numeric(14, 2) not null default 0,
  status text not null default 'pending' check (status in ('pending', 'approved', 'paid', 'rejected')),
  requested_at timestamptz not null default timezone('utc', now()),
  processed_at timestamptz,
  processed_by uuid references public.users (id),
  notes text
);

create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  transaction_type text not null check (transaction_type in ('package_purchase', 'cycle_payout', 'withdrawal_request', 'withdrawal_reversal', 'withdrawal_paid', 'game_reward')),
  amount numeric(14, 2) not null,
  balance_after numeric(14, 2),
  reference_table text,
  reference_id uuid,
  description text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.game_rewards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  reward_amount numeric(14, 2) not null check (reward_amount > 0),
  source text not null default 'grow_rush',
  awarded_at timestamptz not null default timezone('utc', now()),
  synced_at timestamptz not null default timezone('utc', now()),
  transaction_id uuid references public.transactions (id)
);

create unique index if not exists user_packages_one_active_package_per_type_idx
  on public.user_packages (user_id, package_id)
  where status = 'active';

create index if not exists user_packages_user_status_idx on public.user_packages (user_id, status);
create index if not exists cycles_payout_status_idx on public.cycles (payout_date, status);
create index if not exists withdrawals_user_status_idx on public.withdrawals (user_id, status, requested_at desc);
create index if not exists transactions_user_created_idx on public.transactions (user_id, created_at desc);
create index if not exists users_role_status_idx on public.users (role, status);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists set_users_updated_at on public.users;

create trigger set_users_updated_at
before update on public.users
for each row execute function public.set_updated_at();

drop trigger if exists set_packages_updated_at on public.packages;

create trigger set_packages_updated_at
before update on public.packages
for each row execute function public.set_updated_at();

create or replace function public.current_user_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.users
    where id = auth.uid()
      and role = 'admin'
      and status = 'active'
  );
$$;

create or replace function public.upsert_my_profile(
  p_full_name text default null,
  p_phone text default null,
  p_pin text default null
)
returns public.users
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_role text := coalesce(auth.jwt() -> 'app_metadata' ->> 'role', 'client');
  v_profile public.users;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  if p_pin is not null and p_pin !~ '^\d{4}$' then
    raise exception 'PIN must be exactly 4 digits';
  end if;

  insert into public.users (
    id,
    role,
    full_name,
    phone,
    pin_hash
  )
  values (
    v_user_id,
    case when v_role = 'admin' then 'admin' else 'client' end,
    coalesce(nullif(trim(p_full_name), ''), 'GROWX User'),
    nullif(trim(p_phone), ''),
    case when p_pin is not null then crypt(p_pin, gen_salt('bf')) else null end
  )
  on conflict (id) do update set
    full_name = coalesce(nullif(trim(excluded.full_name), ''), public.users.full_name),
    phone = coalesce(excluded.phone, public.users.phone),
    pin_hash = coalesce(excluded.pin_hash, public.users.pin_hash),
    updated_at = timezone('utc', now())
  returning * into v_profile;

  return v_profile;
end;
$$;

create or replace function public.verify_user_pin(p_pin text)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.users
    where id = auth.uid()
      and status = 'active'
      and pin_hash is not null
      and crypt(p_pin, pin_hash) = pin_hash
  );
$$;

create or replace function public.purchase_package(p_package_id uuid)
returns public.user_packages
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_package public.packages;
  v_user_package public.user_packages;
  v_cycle_number integer;
  v_cycle_amount numeric(14, 2);
  v_purchase_date timestamptz := timezone('utc', now());
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  perform 1 from public.users where id = v_user_id and status = 'active';
  if not found then
    raise exception 'Active client profile not found';
  end if;

  select * into v_package
  from public.packages
  where id = p_package_id
    and active = true;

  if v_package.id is null then
    raise exception 'Package not found or inactive';
  end if;

  if exists (
    select 1
    from public.user_packages
    where user_id = v_user_id
      and package_id = p_package_id
      and status = 'active'
  ) then
    raise exception 'This package is already active for the current client';
  end if;

  insert into public.user_packages (
    user_id,
    package_id,
    principal_amount,
    total_expected_return,
    status,
    purchased_at,
    next_payout_at
  )
  values (
    v_user_id,
    p_package_id,
    v_package.amount,
    round(v_package.amount * 1.5, 2),
    'active',
    v_purchase_date,
    v_purchase_date + make_interval(days => v_package.cycle_duration_days)
  )
  returning * into v_user_package;

  for v_cycle_number in 1..6 loop
    v_cycle_amount := case when v_cycle_number <= 2 then round(v_package.amount * 0.5, 2) else round(v_package.amount * 0.125, 2) end;

    insert into public.cycles (
      user_package_id,
      cycle_number,
      starts_at,
      payout_date,
      payout_amount,
      payout_type,
      status
    )
    values (
      v_user_package.id,
      v_cycle_number,
      v_purchase_date + make_interval(days => (v_cycle_number - 1) * v_package.cycle_duration_days),
      v_purchase_date + make_interval(days => v_cycle_number * v_package.cycle_duration_days),
      v_cycle_amount,
      case when v_cycle_number <= 2 then 'principal_return' else 'profit' end,
      'pending'
    );
  end loop;

  insert into public.transactions (
    user_id,
    transaction_type,
    amount,
    reference_table,
    reference_id,
    description,
    metadata
  )
  values (
    v_user_id,
    'package_purchase',
    v_package.amount,
    'user_packages',
    v_user_package.id,
    concat('Purchased ', v_package.name),
    jsonb_build_object('package_id', v_package.id, 'cycle_count', 6, 'cycle_duration_days', 10)
  );

  return v_user_package;
end;
$$;

create or replace function public.record_grow_rush_reward(p_reward_amount numeric)
returns public.game_rewards
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_balance numeric(14, 2);
  v_transaction_id uuid;
  v_reward public.game_rewards;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  if coalesce(p_reward_amount, 0) <= 0 then
    raise exception 'Reward amount must be greater than zero';
  end if;

  update public.users
  set wallet_balance = wallet_balance + round(p_reward_amount, 2),
      reward_balance = reward_balance + round(p_reward_amount, 2),
      updated_at = timezone('utc', now())
  where id = v_user_id
  returning wallet_balance into v_balance;

  insert into public.transactions (
    user_id,
    transaction_type,
    amount,
    balance_after,
    description,
    metadata
  )
  values (
    v_user_id,
    'game_reward',
    round(p_reward_amount, 2),
    v_balance,
    'GROW RUSH reward synced to wallet',
    jsonb_build_object('source', 'grow_rush')
  )
  returning id into v_transaction_id;

  insert into public.game_rewards (
    user_id,
    reward_amount,
    transaction_id
  )
  values (
    v_user_id,
    round(p_reward_amount, 2),
    v_transaction_id
  )
  returning * into v_reward;

  return v_reward;
end;
$$;

create or replace function public.create_withdrawal_request(p_amount numeric)
returns public.withdrawals
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_fee numeric(14, 2);
  v_net numeric(14, 2);
  v_balance numeric(14, 2);
  v_withdrawal public.withdrawals;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  if coalesce(p_amount, 0) <= 0 then
    raise exception 'Withdrawal amount must be greater than zero';
  end if;

  v_fee := round(p_amount * 0.10, 2);
  v_net := round(p_amount - v_fee, 2);

  update public.users
  set wallet_balance = wallet_balance - round(p_amount, 2),
      updated_at = timezone('utc', now())
  where id = v_user_id
    and wallet_balance >= round(p_amount, 2)
  returning wallet_balance into v_balance;

  if v_balance is null then
    raise exception 'Insufficient wallet balance';
  end if;

  insert into public.withdrawals (
    user_id,
    gross_amount,
    fee_amount,
    net_amount,
    wallet_balance_snapshot,
    status
  )
  values (
    v_user_id,
    round(p_amount, 2),
    v_fee,
    v_net,
    v_balance,
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
    description,
    metadata
  )
  values (
    v_user_id,
    'withdrawal_request',
    round(-p_amount, 2),
    v_balance,
    'withdrawals',
    v_withdrawal.id,
    'Withdrawal request submitted',
    jsonb_build_object('gross_amount', round(p_amount, 2), 'fee_amount', v_fee, 'net_amount', v_net)
  );

  return v_withdrawal;
end;
$$;

create or replace function public.process_withdrawal_request(
  p_withdrawal_id uuid,
  p_status text,
  p_notes text default null
)
returns public.withdrawals
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_withdrawal public.withdrawals;
  v_balance numeric(14, 2);
begin
  if v_actor is null or not public.current_user_is_admin() then
    raise exception 'Admin access required';
  end if;

  if p_status not in ('approved', 'paid', 'rejected') then
    raise exception 'Invalid withdrawal status';
  end if;

  select * into v_withdrawal
  from public.withdrawals
  where id = p_withdrawal_id
  for update;

  if v_withdrawal.id is null then
    raise exception 'Withdrawal request not found';
  end if;

  if p_status = 'approved' and v_withdrawal.status <> 'pending' then
    raise exception 'Only pending withdrawals can be approved';
  end if;

  if p_status = 'paid' and v_withdrawal.status <> 'approved' then
    raise exception 'Only approved withdrawals can be marked as paid';
  end if;

  if p_status = 'rejected' and v_withdrawal.status not in ('pending', 'approved') then
    raise exception 'Only pending or approved withdrawals can be rejected';
  end if;

  if p_status = 'rejected' then
    update public.users
    set wallet_balance = wallet_balance + v_withdrawal.gross_amount,
        updated_at = timezone('utc', now())
    where id = v_withdrawal.user_id
    returning wallet_balance into v_balance;

    insert into public.transactions (
      user_id,
      transaction_type,
      amount,
      balance_after,
      reference_table,
      reference_id,
      description,
      metadata
    )
    values (
      v_withdrawal.user_id,
      'withdrawal_reversal',
      v_withdrawal.gross_amount,
      v_balance,
      'withdrawals',
      v_withdrawal.id,
      'Withdrawal request rejected and balance restored',
      jsonb_build_object('notes', p_notes)
    );
  elsif p_status = 'paid' then
    insert into public.transactions (
      user_id,
      transaction_type,
      amount,
      balance_after,
      reference_table,
      reference_id,
      description,
      metadata
    )
    values (
      v_withdrawal.user_id,
      'withdrawal_paid',
      0,
      v_withdrawal.wallet_balance_snapshot,
      'withdrawals',
      v_withdrawal.id,
      'Withdrawal paid out',
      jsonb_build_object('net_amount', v_withdrawal.net_amount, 'fee_amount', v_withdrawal.fee_amount, 'notes', p_notes)
    );
  end if;

  update public.withdrawals
  set status = p_status,
      notes = coalesce(p_notes, notes),
      processed_at = timezone('utc', now()),
      processed_by = v_actor
  where id = p_withdrawal_id
  returning * into v_withdrawal;

  return v_withdrawal;
end;
$$;

create or replace function public.process_due_cycles()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cycle record;
  v_processed integer := 0;
  v_total_paid numeric(14, 2) := 0;
  v_balance numeric(14, 2);
  v_next_payout timestamptz;
begin
  for v_cycle in
    select c.id,
           c.user_package_id,
           c.cycle_number,
           c.payout_amount,
           up.user_id
    from public.cycles c
    join public.user_packages up on up.id = c.user_package_id
    where c.status = 'pending'
      and c.payout_date <= timezone('utc', now())
      and up.status = 'active'
    order by c.payout_date asc
    for update of c skip locked
  loop
    update public.cycles
    set status = 'paid',
        paid_at = timezone('utc', now())
    where id = v_cycle.id;

    update public.users
    set wallet_balance = wallet_balance + v_cycle.payout_amount,
        updated_at = timezone('utc', now())
    where id = v_cycle.user_id
    returning wallet_balance into v_balance;

    insert into public.transactions (
      user_id,
      transaction_type,
      amount,
      balance_after,
      reference_table,
      reference_id,
      description,
      metadata
    )
    values (
      v_cycle.user_id,
      'cycle_payout',
      v_cycle.payout_amount,
      v_balance,
      'cycles',
      v_cycle.id,
      concat('Cycle ', v_cycle.cycle_number, ' payout processed'),
      jsonb_build_object('cycle_number', v_cycle.cycle_number)
    );

    select payout_date into v_next_payout
    from public.cycles
    where user_package_id = v_cycle.user_package_id
      and status = 'pending'
    order by cycle_number asc
    limit 1;

    update public.user_packages
    set status = case when v_cycle.cycle_number = 6 then 'completed' else status end,
        completed_at = case when v_cycle.cycle_number = 6 then timezone('utc', now()) else completed_at end,
        next_payout_at = v_next_payout
    where id = v_cycle.user_package_id;

    v_processed := v_processed + 1;
    v_total_paid := v_total_paid + v_cycle.payout_amount;
  end loop;

  return jsonb_build_object(
    'processed_cycles', v_processed,
    'total_paid', coalesce(v_total_paid, 0)
  );
end;
$$;

create or replace function public.admin_dashboard_metrics()
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'total_invested', coalesce((select sum(principal_amount) from public.user_packages), 0),
    'total_returned', coalesce((select sum(amount) from public.transactions where transaction_type = 'cycle_payout'), 0),
    'total_fees_collected', coalesce((select sum(fee_amount) from public.withdrawals where status in ('approved', 'paid')), 0),
    'pending_withdrawals', coalesce((select count(*) from public.withdrawals where status = 'pending'), 0),
    'active_users', coalesce((select count(*) from public.users where status = 'active' and role = 'client'), 0),
    'active_packages', coalesce((select count(*) from public.user_packages where status = 'active'), 0)
  )
  where public.current_user_is_admin();
$$;

insert into public.packages (code, name, amount, sort_order)
values
  ('starter-50', 'USD 50 Package', 50, 1),
  ('builder-100', 'USD 100 Package', 100, 2),
  ('growth-200', 'USD 200 Package', 200, 3),
  ('pro-500', 'USD 500 Package', 500, 4),
  ('elite-1000', 'USD 1000 Package', 1000, 5)
on conflict (code) do update set
  name = excluded.name,
  amount = excluded.amount,
  active = true,
  sort_order = excluded.sort_order,
  updated_at = timezone('utc', now());

delete from public.packages where amount = 20;

alter table public.users enable row level security;
alter table public.packages enable row level security;
alter table public.user_packages enable row level security;
alter table public.cycles enable row level security;
alter table public.withdrawals enable row level security;
alter table public.transactions enable row level security;
alter table public.game_rewards enable row level security;

drop policy if exists users_select_own_or_admin on public.users;
create policy users_select_own_or_admin
on public.users
for select
using (id = auth.uid() or public.current_user_is_admin());

drop policy if exists users_update_own_or_admin on public.users;
create policy users_update_own_or_admin
on public.users
for update
using (id = auth.uid() or public.current_user_is_admin())
with check (id = auth.uid() or public.current_user_is_admin());

drop policy if exists users_insert_self on public.users;
create policy users_insert_self
on public.users
for insert
with check (id = auth.uid() or public.current_user_is_admin());

drop policy if exists packages_select_authenticated on public.packages;
create policy packages_select_authenticated
on public.packages
for select
using (auth.role() = 'authenticated');

drop policy if exists packages_admin_write on public.packages;
create policy packages_admin_write
on public.packages
for all
using (public.current_user_is_admin())
with check (public.current_user_is_admin());

drop policy if exists user_packages_select_own_or_admin on public.user_packages;
create policy user_packages_select_own_or_admin
on public.user_packages
for select
using (user_id = auth.uid() or public.current_user_is_admin());

drop policy if exists user_packages_admin_write on public.user_packages;
create policy user_packages_admin_write
on public.user_packages
for all
using (public.current_user_is_admin())
with check (public.current_user_is_admin());

drop policy if exists cycles_select_own_or_admin on public.cycles;
create policy cycles_select_own_or_admin
on public.cycles
for select
using (
  exists (
    select 1
    from public.user_packages up
    where up.id = cycles.user_package_id
      and (up.user_id = auth.uid() or public.current_user_is_admin())
  )
);

drop policy if exists cycles_admin_write on public.cycles;
create policy cycles_admin_write
on public.cycles
for all
using (public.current_user_is_admin())
with check (public.current_user_is_admin());

drop policy if exists withdrawals_select_own_or_admin on public.withdrawals;
create policy withdrawals_select_own_or_admin
on public.withdrawals
for select
using (user_id = auth.uid() or public.current_user_is_admin());

drop policy if exists withdrawals_admin_write on public.withdrawals;
create policy withdrawals_admin_write
on public.withdrawals
for all
using (public.current_user_is_admin())
with check (public.current_user_is_admin());

drop policy if exists transactions_select_own_or_admin on public.transactions;
create policy transactions_select_own_or_admin
on public.transactions
for select
using (user_id = auth.uid() or public.current_user_is_admin());

drop policy if exists transactions_admin_write on public.transactions;
create policy transactions_admin_write
on public.transactions
for all
using (public.current_user_is_admin())
with check (public.current_user_is_admin());

drop policy if exists rewards_select_own_or_admin on public.game_rewards;
create policy rewards_select_own_or_admin
on public.game_rewards
for select
using (user_id = auth.uid() or public.current_user_is_admin());

drop policy if exists rewards_admin_write on public.game_rewards;
create policy rewards_admin_write
on public.game_rewards
for all
using (public.current_user_is_admin())
with check (public.current_user_is_admin());

grant execute on function public.upsert_my_profile(text, text, text) to authenticated;
grant execute on function public.verify_user_pin(text) to authenticated;
grant execute on function public.purchase_package(uuid) to authenticated;
grant execute on function public.record_grow_rush_reward(numeric) to authenticated;
grant execute on function public.create_withdrawal_request(numeric) to authenticated;
grant execute on function public.process_withdrawal_request(uuid, text, text) to authenticated;
grant execute on function public.admin_dashboard_metrics() to authenticated;
grant execute on function public.process_due_cycles() to service_role;
