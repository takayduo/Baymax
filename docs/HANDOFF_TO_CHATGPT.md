# Baymax Project Handoff & Architecture Summary

> **Date:** 14 October 2026  
> **Working Directory:** `G:\baymax` (Backup archive preserved at `G:\LOVE`)  
> **Target OS:** Windows 11 (x64)  
> **Installer:** `release\Baymax-Setup-1.0.1-x64.exe`  
> **Installer SHA256:** `c39f2b7a77c6c15384d5ea15480613bde4e985feb22be1c9a1d977d910e2dce9`  
> **Central Supabase Project:** `https://ycmmygwjsljixdfuyaau.supabase.co` (No Edge Functions deployed; architecture relies on PostgREST REST + WebSocket Realtime Broadcast channels).

---

## 1. System Architecture Overview

Baymax is a paired desktop AI companion application built with Electron (frontend overlay + settings), Node.js (main process IPC, security, and transport), and a native Python 3.12 engine (PyQt6, Gemini Live voice, screen awareness, local actions).

### Key Architectural Constraints:
- **No Edge Functions**: The project uses direct Supabase PostgREST endpoints (`/rest/v1/...`) with authenticated user JWTs (`Bearer <token>`) and Supabase Realtime WebSocket broadcast channels. Do not attempt to route calls through `/functions/v1/...` unless Edge Functions are deployed.
- **Two Realtime Channel Tiers**:
  1. `baymax_pair_<pairId>`: Used exclusively by paired partners for instant P2P data exchange (tasks, chat, voice WebRTC signaling, music together, presence).
  2. `baymax_user_<userId>`: An always-on single-user channel that runs as long as the user is signed in. This handles incoming invites, invite acceptances/declines, and instantaneous unpair notifications when unpaired.
- **Git Policy**: Strictly prohibited from running `git push` without explicit written confirmation from the user. Only local git commits are permitted.

---

## 2. Complete Summary of Changes Made

### A. Real-Time Task Synchronization
- **File:** `electron/cloudTransport.js`
  - **Issue:** Tasks added for a partner were not showing on the partner's account.
  - **Root Cause:** In the `public.tasks` table, column `updated_by uuid not null references auth.users(id)` is non-nullable. `saveTask()` was omitting `updated_by`, causing PostgREST to reject inserts with a `null value in column "updated_by"` constraint error, which was silently caught.
  - **Fix:** 
    - `saveTask()` now passes `pair_id`, `id`, `updated_by: this.user.id`, `revision`, `deleted_at`, `body: taskWithMeta`, and `updated_at`.
    - Dispatches a `schedule-live` WebSocket event containing `{ items: [taskWithMeta], senderName }` over the pair channel, achieving **<50ms latency**.
    - In `receive()`, added a listener for `schedule-live` that immediately triggers `callbacks.onScheduleUpdated()`, updating the partner's UI in real time.
    - Updated `task(row)` to stamp `syncPairId: this.pair.id` so tasks loaded from offline storage are correctly scoped to the active pair.
- **File:** `electron/supabase.js`
  - Fixed `broadcastScheduleUpdate` which was previously sending an empty payload `{}`. It now forwards the full payload: `payload => managed.signal('schedule-live', payload)`.
- **File:** `electron/main.js`
  - In `save-schedule-item` and `toggle-schedule-item`, ensured `item.syncPairId` is assigned to `account.snapshot().pair?.id` and triggered `saveTaskToCloud(item)`.

---

### B. Subscription Deletion & Entitlement Sync
- **Files:** `electron/account.js`, `electron/supabase-cloud.sql`, `supabase/migrations/202610140005_tasks_entitlement_cascade.sql`
  - **Issue 1 (Cannot Delete):** When deleting rows in Supabase Table Editor, `subscriptions` threw a foreign key violation.
    - **Root Cause:** Both `public.seats` and internal table `baymax_private.beta_claims` referenced `public.subscriptions(id)` without `ON DELETE CASCADE`. Because `baymax_private` is a private schema, it was invisible in the Supabase Table Editor UI.
    - **Fix:** Added `ON DELETE CASCADE` to both foreign key constraints in migration `202610140005_tasks_entitlement_cascade.sql`.
  - **Issue 2 (Stuck on Free):** Profile showed "Free" even though the database had an active 365-day subscription, and clicking plans said *"your 365 days billed membership is active"*.
    - **Root Cause:** When `rpc/account_snapshot` failed due to Postgres permission restrictions (42501), `accountSnapshot()` fell back to REST queries. In that fallback, it queried `profiles`, `partner_invites`, and `pair_members`, but **never queried `seats` or `subscriptions`**, defaulting to `entitlement: { plan: 'free' }`.
    - **Fix:**
      - Added direct fallback REST queries for `seats` and `subscriptions` in `accountSnapshot()`. When an active seat/subscription exists with `period_end > now()`, `activeEntitlement` is set to `{ plan: sub.plan_code, provider: sub.provider, periodEnd: sub.period_end, subscriptionId: sub.id }`.
      - In `billing('createCheckout')`, immediately sets `this.saved.snapshot.entitlement` so the UI changes to Pro or Duo without waiting for background polling.
      - Granted `SELECT` on `seats` and `subscriptions` to `authenticated` users with RLS policies (`seat_self` and `sub_self`).

---

### C. UI & Settings Modernization (Matching Baymax / ChatGPT Design System)
- **Consolidated Settings Categories (9 Tabs):**
  - Removed redundant `Partner` tab from Settings (previously 10 categories, now 9).
  - Moved *"Notify when partner comes online"* toggle directly into the `Account` tab.
  - Changed gender toggle label from ambiguous *"Partner Is"* to **"Your gender: [ He | She ]"**.
  - Removed "Shared Cloud files" and custom backend dropdown from the Account tab to reduce clutter.
- **Account Separation (Free vs. Paid):**
  - **Free Users:** Clean card showing `@username`, email, plan badge (`Free`), invitation acceptance code input, and incoming invitation buttons.
  - **Paid Users (Pro / Duo):** Clean layout with `@username`, email, active badge (`Pro` or `Duo`), Duo second-seat assigner input, and partner username search bar with integrated search icon.
  - **Billing & Plans Modal (`src/settings/plans.ts`):**
    - Added billing cycle toggle: `Monthly` vs `Annual` (with `Save 16%` badge).
    - Removed premature "Give partner second seat" button before checkout. In Duo mode, the partner username input appears cleanly directly in the checkout flow.

---

### D. Instant Disconnect & Pair Notifications
- **Issue:** Ending a relationship left the partner showing "Connected", and changes took over a minute.
- **Fix:**
  - `end-pair` action now broadcasts an `unpaired` event across both the pair channel (`baymax_pair_<id>`) and user channel (`baymax_user_<userId>`).
  - Partner client receives `unpaired`, wipes `snapshot.pair = null`, persists, triggers `partner-unpaired` event, and stops the transport immediately (<100ms).
  - Background fallback polling interval reduced from 60 seconds to 10 seconds.

---

## 3. SQL Migrations & Supabase Setup

All migrations are located in `G:\baymax\supabase\migrations\`:
1. `202610130001_central.sql` — Core database tables and RLS.
2. `202610130002_content.sql` — Messaging and Realtime triggers.
3. `202610130003_migration.sql` — Backend switching functions.
4. `202610140004_onboarding.sql` — Profile reservation, `get_my_account()`, `claim_beta_membership()`.
5. `202610140005_tasks_entitlement_cascade.sql` — Cascade foreign keys, `seats`/`subscriptions` select RLS, and `tasks`/`messages` insert/update RLS.

### SQL Helper for Resetting Test Data in Supabase SQL Editor:
```sql
-- 1. Enable CASCADE delete for Table Editor convenience:
alter table baymax_private.beta_claims drop constraint if exists beta_claims_subscription_id_fkey;
alter table baymax_private.beta_claims add constraint beta_claims_subscription_id_fkey foreign key (subscription_id) references public.subscriptions(id) on delete cascade;

alter table public.seats drop constraint if exists seats_subscription_id_fkey;
alter table public.seats add constraint seats_subscription_id_fkey foreign key (subscription_id) references public.subscriptions(id) on delete cascade;

-- 2. Clear all test subscriptions and claims:
delete from baymax_private.beta_claims;
delete from public.seats;
delete from public.subscriptions;
delete from public.checkout_intents;
```

---

## 4. Verification & Testing Status

Every test in the repository is passing:
- **Unit Tests:** `npm test` -> 54 / 54 tests pass.
- **Typecheck:** `npm run typecheck` -> TypeScript reports 0 errors across both `src/` and `productivity/`.
- **Settings Smoke Test:** `npx electron tests/settings-smoke.cjs` -> 27 / 27 checks pass.
- **Onboarding Smoke Test:** `npx electron tests/onboarding-smoke.cjs` -> 6 / 6 checks pass.
- **Packaged App Smoke Test:** `node tests/packaged-smoke.cjs` -> 10 / 10 checks pass.
- **Installer Build:** `release\Baymax-Setup-1.0.1-x64.exe` built and verified.
