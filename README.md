# GROWX Platform

Production-ready baseline for a Supabase-backed GROWX client and admin platform.

## What is included

- Supabase Auth with email/password and phone authentication flows
- Session-only browser auth persistence (no `localStorage` for balances, packages, rewards, or withdrawals)
- Row Level Security policies for client and admin data isolation
- Real-time client and admin dashboard refresh using Supabase Realtime
- 6-cycle package engine (10 days per cycle, 150% total return)
- 10% withdrawal fee handling through a secure edge function
- GROW RUSH reward sync into wallet balance via Supabase RPC

## Package rules

Available packages are seeded in the initial migration:

- $50
- $100
- $200
- $500
- $1000

Return model for every package:

- Cycle 1: 50% of package amount
- Cycle 2: 50% of package amount
- Cycles 3-6: 12.5% of package amount each
- Total return after 6 cycles: 150% of package amount

Additional rules enforced in SQL:

- Same package cannot be purchased twice while active
- Package automatically completes after the 6th paid cycle
- A new package must be purchased after completion to continue
- Every withdrawal applies a 10% fee
- Investments are non-refundable

## Required Supabase setup

1. Create a Supabase project.
2. Run `supabase/migrations/001_init_schema.sql`.
3. Deploy edge functions:
   - `supabase/functions/process-payouts.ts`
   - `supabase/functions/process-withdrawal.ts`
4. Configure environment variables from `.env.example` in Supabase Function secrets.
5. Add the publishable URL and anon key to one of these runtime locations:
   - `window.__GROWX_CONFIG__ = { supabaseUrl, supabaseAnonKey }`
   - or the `<meta name="growx-supabase-url">` and `<meta name="growx-supabase-anon-key">` tags in `index.html` and `admin.html`

## Auth and PIN flow

- Supabase Auth handles primary sign-up and sign-in.
- The 4-digit PIN remains as the UI unlock step for the client dashboard.
- PIN verification is performed in Supabase using a hashed value stored in `public.users.pin_hash`.
- Browser session state uses `sessionStorage` only.

## Database overview

Main tables:

- `users`
- `packages`
- `user_packages`
- `cycles`
- `withdrawals`
- `transactions`
- `game_rewards`

## GROW RUSH reward sync

Existing game code can sync rewards by dispatching this browser event after a reward is earned:

```js
window.dispatchEvent(new CustomEvent('growx:reward-earned', {
  detail: { amount: 5 }
}));
```

The client dashboard listener sends the reward to Supabase and updates wallet and reward balances in real time.

## Files changed

- `supabase-config.js` - session-only Supabase client bootstrap using the publishable anon key
- `supabase/migrations/001_init_schema.sql` - schema, indexes, RLS, package rules, and payout logic
- `supabase/functions/process-payouts.ts` - secure payout processor for cron or admin trigger
- `supabase/functions/process-withdrawal.ts` - secure withdrawal request/review handler
- `js/supabase-auth.js` - Supabase auth and PIN orchestration
- `js/api-client.js` - typed frontend access layer for tables, RPCs, and edge functions
- `js/storage-manager.js` - session-only UI state storage
- `js/client-dashboard.js` - client registration, login, PIN unlock, real-time dashboard sync
- `js/package-manager.js` - package purchase UI and enforcement of package clauses
- `js/withdrawal-manager.js` - withdrawal form, 10% fee preview, and history
- `js/cycle-tracker.js` - package cycle progress and next payout rendering
- `admin.html` and `js/admin-*.js` - real-time admin dashboard, users, packages, and withdrawals
- `components/*.js` - PIN, terms, and cycle progress UI components
- `css/styles.css` - shared page styling

## Manual verification

After configuring Supabase:

1. Register a client with email/password or phone/password.
2. Verify the client can only see their own packages, withdrawals, transactions, and rewards.
3. Sign in as an admin-seeded account and verify full dashboard visibility.
4. Purchase a package and confirm that six cycles are created.
5. Process payouts and confirm wallet balance updates in real time.
6. Submit a withdrawal and confirm the 10% fee is shown before confirmation.
