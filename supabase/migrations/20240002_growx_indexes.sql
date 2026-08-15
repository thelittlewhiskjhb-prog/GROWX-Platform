-- ============================================================
-- GROWX PLATFORM — INDEXES FOR 10,000 USER SCALE
-- ============================================================

-- users
create index if not exists idx_users_phone    on public.users(phone);
create index if not exists idx_users_role     on public.users(role);
create index if not exists idx_users_status   on public.users(status);
create index if not exists idx_users_client_code on public.users(client_code);

-- user_packages
create index if not exists idx_user_packages_user_id    on public.user_packages(user_id);
create index if not exists idx_user_packages_status     on public.user_packages(status);
create index if not exists idx_user_packages_package_id on public.user_packages(package_id);

-- cycles
create index if not exists idx_cycles_user_package_id on public.cycles(user_package_id);
create index if not exists idx_cycles_payout_date     on public.cycles(payout_date);
create index if not exists idx_cycles_status          on public.cycles(status);

-- recharge_requests
create index if not exists idx_recharge_user_id  on public.recharge_requests(user_id);
create index if not exists idx_recharge_status   on public.recharge_requests(status);
create index if not exists idx_recharge_created  on public.recharge_requests(created_at desc);

-- withdrawals
create index if not exists idx_withdrawals_user_id    on public.withdrawals(user_id);
create index if not exists idx_withdrawals_status     on public.withdrawals(status);
create index if not exists idx_withdrawals_requested  on public.withdrawals(requested_at desc);

-- transactions (ledger history)
create index if not exists idx_transactions_user_id  on public.transactions(user_id);
create index if not exists idx_transactions_created  on public.transactions(created_at desc);
create index if not exists idx_transactions_type     on public.transactions(transaction_type);

-- reward_claims
create index if not exists idx_reward_claims_user_id    on public.reward_claims(user_id);
create index if not exists idx_reward_claims_claimed_at on public.reward_claims(claimed_at desc);

-- gift_code_redemptions
create index if not exists idx_gift_redemptions_user_id on public.gift_code_redemptions(user_id);

-- audit_log
create index if not exists idx_audit_log_admin_id   on public.audit_log(admin_id);
create index if not exists idx_audit_log_created_at on public.audit_log(created_at desc);
