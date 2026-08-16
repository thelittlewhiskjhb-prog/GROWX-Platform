-- ============================================================
-- GROWX PLATFORM — PRODUCTION SCHEMA MIGRATION
-- ============================================================
-- Run this against your Supabase project via:
--   supabase db push
-- or paste into the Supabase SQL Editor.
-- ============================================================

-- ============================================================
-- 0. REQUIRED EXTENSIONS
-- ============================================================
create extension if not exists pgcrypto with schema extensions;

-- ============================================================
-- 1. USERS TABLE
-- Extends auth.users. One row per registered client/admin.
-- ============================================================
create table if not exists public.users (
  id           uuid primary key references auth.users(id) on delete cascade,
  full_name    text,
  phone        text unique,
  email        text,
  role         text not null default 'client' check (role in ('client', 'admin')),
  status       text not null default 'active' check (status in ('active', 'suspended')),
  pin_hash     text,          -- bcrypt hash, never exposed to clients
  client_code  text unique,
  wallet_balance   numeric(18,2) not null default 0 check (wallet_balance >= 0),
  reward_balance   numeric(18,2) not null default 0 check (reward_balance >= 0),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ============================================================
-- 2. PACKAGES TABLE
-- Admin-managed list of investment packages.
-- ============================================================
create table if not exists public.packages (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  amount        numeric(18,2) not null check (amount > 0),
  daily_reward  numeric(18,2) not null default 0 check (daily_reward >= 0),
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);

-- ============================================================
-- 3. USER PACKAGES
-- Admin-allocated package assignments.
-- Clients cannot insert directly — only via admin_allocate_package().
-- ============================================================
create table if not exists public.user_packages (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references public.users(id) on delete cascade,
  package_id           uuid not null references public.packages(id),
  principal_amount     numeric(18,2) not null check (principal_amount > 0),
  total_expected_return numeric(18,2) not null default 0,
  status               text not null default 'active' check (status in ('active', 'completed', 'cancelled')),
  purchased_at         timestamptz not null default now(),
  allocated_by         uuid references public.users(id),
  unique (user_id, package_id, status)
);

-- ============================================================
-- 4. CYCLES TABLE
-- 6 payout cycles per user_package.
-- ============================================================
create table if not exists public.cycles (
  id              uuid primary key default gen_random_uuid(),
  user_package_id uuid not null references public.user_packages(id) on delete cascade,
  cycle_number    int not null check (cycle_number between 1 and 6),
  payout_type     text not null,
  payout_date     date not null,
  payout_amount   numeric(18,2) not null check (payout_amount >= 0),
  status          text not null default 'pending' check (status in ('pending', 'paid', 'cancelled')),
  paid_at         timestamptz,
  unique (user_package_id, cycle_number)
);

-- ============================================================
-- 5. DEPOSIT ADDRESSES TABLE
-- Admin-configurable USDT deposit addresses per network.
-- Clients read only; admins manage via SQL / admin panel.
-- ============================================================
create table if not exists public.deposit_addresses (
  id          uuid primary key default gen_random_uuid(),
  network     text not null unique check (network in ('trc20', 'erc20')),
  address     text not null,
  active      boolean not null default true,
  updated_at  timestamptz not null default now()
);

-- Seed final production addresses
insert into public.deposit_addresses (network, address) values
  ('trc20', 'TRmdXgVDBfC7z54fD3gHS2zXHd2E77CjXV'),
  ('erc20', '0xe5f65dd88d16ea1ff9a9682d6ed8e10993c3c9a0')
on conflict (network) do update
  set address = excluded.address,
      active = true,
      updated_at = now();

-- ============================================================
-- 6. RECHARGE REQUESTS TABLE
-- Client deposit requests — admins verify and credit.
-- ============================================================
create table if not exists public.recharge_requests (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.users(id) on delete cascade,
  amount          numeric(18,2) not null check (amount > 0),
  currency        text not null default 'USDT',
  network         text not null check (network in ('trc20', 'erc20')),
  deposit_address text not null,
  status          text not null default 'pending' check (status in ('pending', 'verified', 'rejected')),
  admin_notes     text,
  verified_at     timestamptz,
  verified_by     uuid references public.users(id),
  created_at      timestamptz not null default now()
);

-- ============================================================
-- 7. WITHDRAWALS TABLE
-- ============================================================
create table if not exists public.withdrawals (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references public.users(id) on delete cascade,
  gross_amount          numeric(18,2) not null check (gross_amount > 0),
  fee_amount            numeric(18,2) not null default 0,
  net_amount            numeric(18,2) not null default 0,
  currency              text not null default 'USDT',
  network               text check (network in ('trc20', 'erc20')),
  wallet_address        text,
  status                text not null default 'processing' check (status in ('processing', 'approved', 'completed', 'rejected')),
  admin_notes           text,
  admin_transaction_hash text,
  processed_by          uuid references public.users(id),
  requested_at          timestamptz not null default now(),
  processed_at          timestamptz,
  network_type          text generated always as (network) stored  -- backward compat alias
);

-- ============================================================
-- 8. TRANSACTIONS TABLE
-- Immutable ledger history for all balance-changing events.
-- No client writes — only server-side RPCs/functions insert here.
-- ============================================================
create table if not exists public.transactions (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.users(id) on delete cascade,
  transaction_type text not null,
  amount           numeric(18,2) not null,
  balance_after    numeric(18,2),
  description      text,
  reference_id     uuid,
  reference_type   text,
  created_at       timestamptz not null default now()
);

-- ============================================================
-- 9. REWARD CLAIMS TABLE
-- One row per successful daily reward claim — enforces 24h rule server-side.
-- ============================================================
create table if not exists public.reward_claims (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users(id) on delete cascade,
  amount      numeric(18,2) not null check (amount > 0),
  claimed_at  timestamptz not null default now()
);

-- ============================================================
-- 10. GIFT CODES TABLE
-- ============================================================
create table if not exists public.gift_codes (
  id              uuid primary key default gen_random_uuid(),
  code            text not null unique,
  reward_amount   numeric(18,2) not null check (reward_amount > 0),
  max_redemptions int not null default 1,
  redemption_count int not null default 0,
  active          boolean not null default true,
  expires_at      timestamptz,
  created_at      timestamptz not null default now()
);

-- ============================================================
-- 11. GIFT CODE REDEMPTIONS TABLE
-- Prevents duplicate redemptions per user per code.
-- ============================================================
create table if not exists public.gift_code_redemptions (
  id           uuid primary key default gen_random_uuid(),
  gift_code_id uuid not null references public.gift_codes(id),
  user_id      uuid not null references public.users(id) on delete cascade,
  redeemed_at  timestamptz not null default now(),
  unique (gift_code_id, user_id)
);

-- ============================================================
-- 12. AUDIT LOG TABLE
-- Records all admin actions for accountability.
-- ============================================================
create table if not exists public.audit_log (
  id           uuid primary key default gen_random_uuid(),
  admin_id     uuid not null references public.users(id),
  action       text not null,
  target_table text,
  target_id    uuid,
  details      jsonb,
  created_at   timestamptz not null default now()
);
