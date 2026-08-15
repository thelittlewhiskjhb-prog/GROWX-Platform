-- ============================================================
-- GROWX PLATFORM — ROW LEVEL SECURITY POLICIES
-- ============================================================
-- Principle of least privilege:
--   • Clients read/write ONLY their own rows.
--   • Admins can read/write all rows through server-side RPCs
--     or Edge Functions (service role bypasses RLS when needed).
--   • No client can modify financial totals directly.
-- ============================================================

-- Enable RLS on every table
alter table public.users              enable row level security;
alter table public.packages           enable row level security;
alter table public.user_packages      enable row level security;
alter table public.cycles             enable row level security;
alter table public.deposit_addresses  enable row level security;
alter table public.recharge_requests  enable row level security;
alter table public.withdrawals        enable row level security;
alter table public.transactions       enable row level security;
alter table public.reward_claims      enable row level security;
alter table public.gift_codes         enable row level security;
alter table public.gift_code_redemptions enable row level security;
alter table public.audit_log          enable row level security;

-- Helper: check if caller is an admin
create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(
    (select role = 'admin' from public.users where id = auth.uid()),
    false
  )
$$;

-- Helper: check if user account is active
create or replace function public.is_active_user()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(
    (select status = 'active' from public.users where id = auth.uid()),
    false
  )
$$;

-- ============================================================
-- USERS TABLE POLICIES
-- ============================================================
-- Clients: read their own row only
create policy "clients_select_own_profile"
  on public.users for select
  using (id = auth.uid());

-- Admins: read all profiles
create policy "admins_select_all_profiles"
  on public.users for select
  using (public.is_admin());

-- No direct UPDATE from client-side SQL. Admin updates must use RPC/Edge paths
-- where each action is validated and audited.

-- ============================================================
-- PACKAGES TABLE POLICIES
-- ============================================================
create policy "all_authenticated_select_packages"
  on public.packages for select
  to authenticated
  using (active = true);

create policy "admins_manage_packages"
  on public.packages for all
  using (public.is_admin())
  with check (public.is_admin());

-- ============================================================
-- USER PACKAGES TABLE POLICIES
-- ============================================================
-- Clients: read their own packages only
create policy "clients_select_own_packages"
  on public.user_packages for select
  using (user_id = auth.uid());

-- Admins: read all
create policy "admins_select_all_packages"
  on public.user_packages for select
  using (public.is_admin());

-- NO client INSERT/UPDATE/DELETE — only via admin_allocate_package() RPC
create policy "admins_manage_user_packages"
  on public.user_packages for all
  using (public.is_admin())
  with check (public.is_admin());

-- ============================================================
-- CYCLES TABLE POLICIES
-- ============================================================
create policy "clients_select_own_cycles"
  on public.cycles for select
  using (
    exists (
      select 1 from public.user_packages up
      where up.id = cycles.user_package_id
        and up.user_id = auth.uid()
    )
  );

create policy "admins_select_all_cycles"
  on public.cycles for select
  using (public.is_admin());

create policy "admins_manage_cycles"
  on public.cycles for all
  using (public.is_admin())
  with check (public.is_admin());

-- ============================================================
-- DEPOSIT ADDRESSES TABLE POLICIES
-- ============================================================
-- All authenticated users can read deposit addresses (needed for recharge UI)
create policy "authenticated_select_deposit_addresses"
  on public.deposit_addresses for select
  to authenticated
  using (active = true);

create policy "admins_manage_deposit_addresses"
  on public.deposit_addresses for all
  using (public.is_admin())
  with check (public.is_admin());

-- ============================================================
-- RECHARGE REQUESTS TABLE POLICIES
-- ============================================================
-- Clients: read and insert their own requests only
create policy "clients_select_own_recharges"
  on public.recharge_requests for select
  using (user_id = auth.uid());

create policy "clients_insert_own_recharge"
  on public.recharge_requests for insert
  with check (
    user_id = auth.uid()
    and public.is_active_user()
  );

-- Clients cannot update or delete recharge requests
create policy "admins_manage_recharge_requests"
  on public.recharge_requests for all
  using (public.is_admin())
  with check (public.is_admin());

-- ============================================================
-- WITHDRAWALS TABLE POLICIES
-- ============================================================
create policy "clients_select_own_withdrawals"
  on public.withdrawals for select
  using (user_id = auth.uid());

create policy "clients_insert_own_withdrawal"
  on public.withdrawals for insert
  with check (
    user_id = auth.uid()
    and public.is_active_user()
  );

-- Clients cannot update or delete withdrawals
create policy "admins_manage_withdrawals"
  on public.withdrawals for all
  using (public.is_admin())
  with check (public.is_admin());

-- ============================================================
-- TRANSACTIONS TABLE POLICIES
-- ============================================================
-- Clients: read-only of their own transactions
create policy "clients_select_own_transactions"
  on public.transactions for select
  using (user_id = auth.uid());

-- No client inserts — all inserts come from security definer RPCs
create policy "admins_select_all_transactions"
  on public.transactions for select
  using (public.is_admin());

-- ============================================================
-- REWARD CLAIMS TABLE POLICIES
-- ============================================================
create policy "clients_select_own_reward_claims"
  on public.reward_claims for select
  using (user_id = auth.uid());

-- No client inserts — only via claim_daily_reward() RPC (security definer)
create policy "admins_select_all_reward_claims"
  on public.reward_claims for select
  using (public.is_admin());

-- ============================================================
-- GIFT CODES TABLE POLICIES
-- ============================================================
-- Active codes are readable by all authenticated users (for redemption UI)
-- But reward_amount details are not a security concern since validation
-- is server-side — the client cannot dictate the credit amount.
create policy "authenticated_select_active_gift_codes"
  on public.gift_codes for select
  to authenticated
  using (active = true and (expires_at is null or expires_at > now()));

create policy "admins_manage_gift_codes"
  on public.gift_codes for all
  using (public.is_admin())
  with check (public.is_admin());

-- ============================================================
-- GIFT CODE REDEMPTIONS TABLE POLICIES
-- ============================================================
create policy "clients_select_own_redemptions"
  on public.gift_code_redemptions for select
  using (user_id = auth.uid());

-- No client inserts — only via redeem_gift_code() RPC (security definer)
create policy "admins_select_all_redemptions"
  on public.gift_code_redemptions for select
  using (public.is_admin());

-- ============================================================
-- AUDIT LOG TABLE POLICIES
-- ============================================================
-- Only admins can read audit log; no client access at all
create policy "admins_select_audit_log"
  on public.audit_log for select
  using (public.is_admin());

-- Inserts come only from security definer functions (bypasses RLS)
