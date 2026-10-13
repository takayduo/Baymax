# Baymax Project Handoff & Architecture Summary

> **Date:** 14 October 2026  
> **Working Directory:** `G:\baymax` (Backup archive preserved at `G:\LOVE`)  
> **Target OS:** Windows 11 (x64)  
> **Installer:** `release\Baymax-Setup-1.0.1-x64.exe`  
> **Installer SHA256:** `6444c6f41ff805bde94d46114a7052a11b20b372eaa6b5b073d6846fc7e776f9`  
> **Central Supabase Project:** `https://ycmmygwjsljixdfuyaau.supabase.co` (PostgREST REST + WebSocket Realtime Broadcast channels).

---

## 1. System Architecture Overview

Baymax is a paired desktop AI companion application built with Electron (frontend overlay + preferences settings), Node.js (main process IPC, security, and transport), and a native Python 3.12 engine (PyQt6, Gemini Live voice, screen awareness, local actions).

### Key Architectural Constraints:
- **No Edge Functions**: The project uses direct Supabase PostgREST endpoints (`/rest/v1/...`) with authenticated user JWTs (`Bearer <token>`) and Supabase Realtime WebSocket broadcast channels. Do not attempt to route calls through `/functions/v1/...`.
- **Two Realtime Channel Tiers**:
  1. `baymax_pair_<pairId>`: Used exclusively by paired partners for instant P2P data exchange (tasks, chat, voice WebRTC signaling, music together, presence).
  2. `baymax_user_<userId>`: An always-on single-user channel that runs as long as the user is signed in. This handles incoming invites, invite acceptances/declines, and instantaneous unpair notifications when unpaired.
- **Git Policy**: Strictly prohibited from running `git push` without explicit written confirmation from the user. Only local git commits are permitted.

---

## 2. Complete Summary of Changes Made Since ChatGPT Limit

### A. Real-Time Task Synchronization (<50ms Latency)
- **File:** `electron/cloudTransport.js`
  - **Issue:** Tasks added for a partner were not showing on the partner's account.
  - **Root Cause:** In the `public.tasks` table, column `updated_by uuid not null references auth.users(id)` is non-nullable. `saveTask()` was omitting `updated_by`, causing PostgREST to reject inserts with a `null value in column "updated_by"` constraint error.
  - **Fix:** 
    - `saveTask()` passes `pair_id`, `id`, `updated_by: this.user.id`, `revision`, `deleted_at`, `body: taskWithMeta`, and `updated_at`.
    - Dispatches a `schedule-live` WebSocket event containing `{ items: [taskWithMeta], senderName }` over the pair channel, achieving **<50ms latency**.
    - In `receive()`, added a listener for `schedule-live` that immediately triggers `callbacks.onScheduleUpdated()`, updating the partner's UI in real time.
    - Updated `task(row)` to stamp `syncPairId: this.pair.id` so tasks loaded from offline storage are correctly scoped to the active pair.
- **File:** `electron/supabase.js`
  - Fixed `broadcastScheduleUpdate` which was previously sending an empty payload `{}`. It now forwards the full payload: `payload => managed.signal('schedule-live', payload)`.
- **File:** `electron/main.js`
  - In `save-schedule-item` and `toggle-schedule-item`, ensured `item.syncPairId` is assigned to `account.snapshot().pair?.id` and triggered `saveTaskToCloud(item)`.

---

### B. Duo Subscription Lifecycle, Seat Revocation & Security Enforcement
- **Files:** `electron/account.js`, `electron/supabase-cloud.sql`, `supabase/migrations/202610140006_duo_seats_revocation.sql`, `src/settings/plans.ts`, `src/settings/account.ts`
  - **Database Seat Limit & Security Enforcement:**
    - Confirmed that **no user can sell or distribute Duo seats infinitely**. Postgres strictly throws `'The second seat is already assigned'` if more than 2 seats (`purchaser` + `1 partner`) are created under one subscription.
    - Added check for `state = 'active'` in `claim_beta_membership()` so revoked seats do not block new partners.
  - **Automatic Seat Revocation on Disconnect (`end-pair`):**
    - Updated `public.end_pair(p_actor uuid)`: When either partner clicks "End relationship", any seat granted to the partner under the purchaser's subscription is automatically revoked (`state = 'revoked'`).
    - The ex-partner immediately drops back to the **Free** plan.
    - The purchaser's 2nd seat is freed and becomes **Available** again.
  - **Explicit Partner Seat Revocation (`revoke-seat`):**
    - Created RPC `public.revoke_partner_seat()` and client action `revoke-seat`. The purchaser can revoke their partner's seat anytime directly from the Account tab with one click.
  - **Plans Modal UI Cleanup:**
    - Removed the detached floating text box below the plan cards.
    - When purchasing "Pay for both", a native Baymax `<dialog class="upgrade-dialog duo-assign-dialog">` appears asking for the partner's `@username` with **[Assign seat]** and **[Skip for now]** options.
    - When clicking **[Assign partner seat]** on the Duo card, the same sleek modal appears.
    - Entering a username automatically grants the Duo seat and connects/invites the partner.
  - **Account Tab Partner Search UI:**
    - Removed the separate search icon button from the partner search input.
    - Searching now triggers automatically when the user presses **Enter** inside the input box (`Partner @username (press Enter to search)`).
    - If 2nd seat is assigned, shows: `Duo Partner Seat: Assigned to @partner (Active) [Revoke seat]`.
    - If 2nd seat is unassigned, shows: `Duo Partner Seat · Available [Partner @username] [Gift seat]`.

---

### C. Foreign Key Cascade & Entitlement Fallback
- **Files:** `electron/account.js`, `supabase/migrations/202610140005_tasks_entitlement_cascade.sql`
  - **Issue 1 (Cannot Delete Test Rows):** Deleting rows in Supabase Table Editor failed because `baymax_private.beta_claims` and `public.seats` referenced `subscriptions` without cascade.
  - **Fix:** Added `ON DELETE CASCADE` to foreign keys on both tables.
  - **Issue 2 (Fallback to Free):** Fallback REST queries omitted `seats` and `subscriptions`.
  - **Fix:** Direct REST query in `accountSnapshot()` queries `public.seats` and `public.subscriptions` where `period_end > now()`, properly detecting Pro/Duo.

---

### D. Settings UI Cleanup & Baymax Theme Fidelity
- **Tabs Consolidated (9 Tabs):** Removed redundant `Partner` tab from Settings.
- **Gender Toggle:** Renamed from ambiguous *"Partner Is"* to **"Your gender: [ He | She ]"**.
- **Presence Toggle:** Moved *"Notify when partner comes online"* directly into the Account tab.
- **De-clutter:** Removed custom backend dropdown and cloud files dropdown from Account tab.

---

## 3. SQL Migrations & Database Commands

Migrations are located in `G:\baymax\supabase\migrations\`:
1. `202610130001_central.sql` — Core database tables and RLS.
2. `202610130002_content.sql` — Messaging and Realtime triggers.
3. `202610130003_migration.sql` — Backend switching functions.
4. `202610140004_onboarding.sql` — Profile reservation, `get_my_account()`, `claim_beta_membership()`.
5. `202610140005_tasks_entitlement_cascade.sql` — Cascade foreign keys, `seats`/`subscriptions` select RLS, and `tasks`/`messages` insert/update RLS.
6. `202610140006_duo_seats_revocation.sql` — Partner seat revocation on unpairing and `revoke_partner_seat()`.

---

## 4. Verification & Testing Status

Every test in the repository is passing:
- **Unit Tests:** `npm test` -> **55 / 55 tests pass** (0 failures).
- **Regression Tests:** `node tests/regressions.cjs` -> **46 / 46 tests pass** (0 failures).
- **Account Suite:** `node --test tests/account.cjs` -> **7 / 7 tests pass** (0 failures).
- **Frontend & TypeScript:** `npm run build` -> 0 TypeScript errors, both `dist/` and `productivity/dist/` build cleanly.
- **Windows Installer:** `release\Baymax-Setup-1.0.1-x64.exe` (SHA256: `6444c6f41ff805bde94d46114a7052a11b20b372eaa6b5b073d6846fc7e776f9`).
