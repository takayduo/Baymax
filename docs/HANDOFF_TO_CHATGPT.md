# Baymax handoff

Updated 15 October 2026. Active desktop: `G:\baymax`. Clone: `G:\puff`. Owner console: `G:\puff-admin`, live at **https://puff-admin.pages.dev**. Preserve LOVE/Mochi source backups. Do not push Git without explicit written owner permission.

## Current architecture

- Electron/Vite/TypeScript desktop and native Python voice/action engine. Preserve remote consent, partner calls/music, proactive voice/PTT, task/chat delivery, companion rendering and shortcuts.
- Central account/content use authenticated Supabase PostgREST. **No central Edge Functions.** `get_my_account` supplies authoritative entitlement state, without assembling a guessed fallback after failure. Username reservation is a direct authenticated `profiles` upsert.
- Private account topic: `baymax:user:<user UUID>`. Pair topic: `baymax:pair:<pair UUID>:<channel_token>`. SQL `send_pair_signal` authorizes publications; clients cannot write arbitrary broadcasts. Membership/entitlement changes rotate topics. Clients refresh on account events with a polling fallback.
- Tasks use `save_my_task`, authenticated `updated_by`, revisions, tombstones and server broadcasts after writes. Equal content does not rebroadcast indefinitely. Chat preserves live-before-store delivery, idempotency and outbox retries. Failed saves remain pending. Reads paginate beyond 1,000 rows. Do not claim guaranteed sub-50ms WAN latency.
- Duo has one purchaser seat and one recipient. `assign_partner_seat` checks ownership/conflicts and invites rather than auto-pairing. End-pair/revoke frees the gift without cancelling a separately owned subscription. Gender is `userGender`, not a shared-task role slot.
- Native Duo dialogs, Enter-key username search and seat/revoke controls remain. Emergency Cloud pause and announcements are server-derived. Installation heartbeats feed the admin devices view.
- Central files use authenticated Storage plus reserve/remove RPCs. Local playlists, AI keys and raw productivity history are not uploaded by the dashboard.
- Optional billing runs on Cloudflare; public desktop config accepts `billingUrl`. No Razorpay secrets appeared in the verified production secret-name list; real payment operation remains unactivated.

## Database and deployment

Central Supabase: `https://ycmmygwjsljixdfuyaau.supabase.co`.

Migrations 001–006 are the previous schema/onboarding/seat fixes. Upgrades:

1. `202610140007_direct_authenticated_transport.sql`: private channels, actor-bound RPCs, RLS fixes, safe task/message writes and revocation.
2. `202610140008_owner_admin.sql`: service-only admin RPCs, audit, devices, controls and grants.
3. `202610140009_direct_files.sql`: private Storage authorization.
4. `202610140010_duo_assignment.sql`: purchaser-owned second-seat assignment.

The owner reported applying 007–010 to the hosted database. Local tests exercise the full schema, unrelated-user/anon denial, private topics, revocation and grants. Live authenticated mutations were not exercised in this continuation. Apply only missing migrations on upgrades; the complete `electron/supabase-cloud.sql` is for a new project. Preserve applied migration history; use a new migration for further database changes.

Admin: Cloudflare Pages Functions + D1 sessions + server-side Supabase RPCs. Its real D1 binding is in `G:\puff-admin\wrangler.toml`; do not overwrite it with the ignored `.admin-staging` preparation copy. Actual source is `G:\puff-admin`. Session hashes now use `SESSION_SECRET`; missing settings fail closed; errors are bounded and do not reflect raw credentials. Antigravity's manual-fetch redirect fix remains.

Production deployment **0323c6b1**, 15 October: homepage 200; unauthenticated session/data 401; foreign-origin login 403. Existing owner sessions need to sign in again. Instructions: `G:\puff-admin\HOSTING.md` and [OWNER_GUIDE.md](OWNER_GUIDE.md).

## Preserved desktop layout

- Repeat stays beside Next in `.music-mini`. Music retains `(botX,botY)=(59,104)` and 78px left padding.
- Tasks has no companion; its canvas hides immediately without shrinking to a dot. Expanded opacity follows diameter.
- Collapsed state syncs on startup/transitions; Partner chat receives focus. Desktop toasts show only while collapsed.
- Legacy message writes omit nonexistent `sender_role`; chat broadcasts before persistence.

## Artifact, verification and limits

Installer: `release\Baymax-Setup-1.0.1-x64.exe`, 286,034,455 bytes (272.8 MiB), **NotSigned**.

SHA256: `39a663ba4e79e1f3273dcc89a3e0ac32ceea75f4f08d939648a53a789ddee52e`.

15 October: 57 desktop tests, both TypeScript projects, 7 admin API tests, compiled Worker, 10 dashboard fixture checks, 11 packaged-app checks and 121 resource matches passed. The current installer was verified, not rebuilt in this continuation. See [RELEASE_STATUS.md](../RELEASE_STATUS.md) for evidence.

Do not claim a signed installer, live paid launch, tested physical microphones/WAN pairs or automatic personal-database migration. Two real-PC acceptance and live authenticated owner workflows remain. The custom adapter is separate from central no-Edge transport. Financial cancellation is separate from access revocation.

Antigravity's reported commits: Baymax `bcda54c`, clone `8e81f16`, admin `e5f84f9`. This continuation leaves changes uncommitted/unpushed, publishes the authorized Cloudflare update, and does not overwrite `G:\puff`.
