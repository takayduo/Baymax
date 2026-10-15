# Baymax owner operations

Updated 15 October 2026. The central desktop uses authenticated Supabase PostgREST RPCs and private WebSocket Realtime channels. **No central Supabase Edge Functions are required.** Optional real billing runs in Cloudflare Pages Functions. The older Edge Function source is legacy code; do not deploy it to repair the current central desktop.

## Owner console

Open **https://puff-admin.pages.dev** and enter your master admin key. Source: `G:\puff-admin`. Deployment, recovery and first-time setup instructions: `G:\puff-admin\HOSTING.md`.

- **People:** search usernames/emails; inspect membership, accepted partner and recent device heartbeats. A heartbeat means an installation was online, not that someone was at the PC.
- **Memberships:** grant Free, Pro or Duo for custom days or lifetime; revoke access; inspect, assign or unassign the second Duo seat. Changes require a reason and produce an audit record. Assignment invites the recipient; it does not bypass consent.
- **Connections:** inspect pairs, stored message/task counts and activity, or force unpair. Counts are not latency measurements; the dashboard does not show private message bodies.
- **Activity:** review actions and reasons. System controls also expose recent sign-ins and sign-out-all.
- **System controls:** enable/disable beta grants, publish an account-page announcement, or pause Cloud access. Emergency pause blocks new server content/signaling; updated clients close remote/music sessions on account refresh. It does not stop Windows processes or erase local data.

The 15 October session update requires a fresh dashboard sign-in. Sessions expire after 30 minutes idle or four hours total. Credentials belong in Cloudflare secrets, never browser code or Git. Rotate both master and session secrets after suspected compromise; rotating the session secret invalidates existing cookies.

Revoking Baymax access does **not** cancel a Razorpay mandate or issue a refund. Confirm financial cancellation/refunds through the provider. An active provider subscription can still renew after a local access revocation.

## Database and Google setup

Central project: `https://ycmmygwjsljixdfuyaau.supabase.co`. Keep it separate from legacy open personal testing databases. The owner reported applying migrations 007–010 on 15 October. Local PostgreSQL tests exercise the complete schema; this does not certify every policy in the hosted project.

For a **new empty central project**, apply `electron/supabase-cloud.sql`. For an **existing project**, back it up and apply only missing files from `supabase/migrations`, in filename order. Do not rerun old permission definitions over an upgraded database. The admin folder includes upgrades 007–010 in `database/` and the owner's combined `APPLY_TO_SUPABASE.sql`; routine website deployment does not require rerunning them.

Disable public Realtime channel access on the central project and check for extra permissive `realtime.messages` policies. Current channels are private: `baymax:user:<user UUID>` and `baymax:pair:<pair UUID>:<rotating token>`. SQL checks publications against the authenticated caller and current membership/entitlement. Revocation rotates topics so future traffic leaves previously subscribed channels. Upgrade both partners together; older public-topic builds do not interoperate.

Enable Google in Supabase Authentication, keeping its client secret there. Use the project callback shown by Supabase in Google Cloud. The desktop redirect allowlist is `http://127.0.0.1:42837/auth/callback**`; Baymax checks the exact host/path, random state, five-minute expiry and single-use PKCE exchange. Username reservation writes directly to `profiles` as the signed-in user; database constraints enforce ownership, format and uniqueness.

`electron/cloud-config.json` contains public configuration only. Per-installation app-data configuration overrides it. Environment overrides include `BAYMAX_CENTRAL_URL`, `BAYMAX_CENTRAL_PUBLIC_KEY` and `BAYMAX_RAZORPAY_KEY_ID`. Never bundle service-role, Google or Razorpay secrets in the desktop.

## Beta and paid access

With the public Razorpay key blank, the desktop requests `claim_beta_membership`: a **server-owned** 365-day grant, available only while the server beta switch is enabled. Repeated claims retain the original expiry. Editing a client plan flag cannot bypass database RLS. Disable beta in the owner console before real checkout launches; doing so does not revoke existing grants.

Pro covers one user. Duo covers the purchaser plus one recipient. Pair acceptance and remote request/accept remain separate consent steps. Ending a pair revokes its gifted seat and frees it for the purchaser, without cancelling a separately owned subscription. Cloud content and Listen Together require both users to qualify. Local entitlement caches last at most 72 hours and never beyond expiry; server content access is checked on each request.

For real payments, follow the admin hosting guide. Put provider secrets in **Cloudflare**, configure verified plan IDs/prices in `billing_plans`, and set the desktop's public `billingUrl` to `https://puff-admin.pages.dev` and its public Razorpay key ID. The billing API verifies the user's JWT; the webhook verifies raw HMAC and reconciles provider subscription/payment state. Checkout success alone never grants access. Only the three owner-console secrets were present in the verified production secret-name list; Razorpay is not activated or end-to-end tested.

Before accepting money, test success/failure, duplicate/out-of-order webhooks, cancellation, refunds and seat conflicts with Razorpay test plans. Show final prices, renewals and terms from approved server configuration. All AI tiers remain bring-your-own-key; Free uses the existing **Groq** chat provider.

## Personal databases and preserved features

Legacy open-project mode remains the owner's private testing option; a URL and anon key are not authentication. The older custom adapter and migration UI require a separate authenticated adapter deployment. Automatic personal-backend setup/switching is **not verified with the current direct central RPC implementation**. Do not promise a seamless switch or transfer partner data without consent.

Preserve consent-based PC Control, Listen Together, partner calls, shared tasks/chat, local music, productivity and Gemini/PTT. The owner's later instructions supersede the original launch-plan exclusion of PC Control.

## Verify and release

See [RELEASE_STATUS.md](../RELEASE_STATUS.md) for the current hash/checks and [COUPLE_TESTING.md](COUPLE_TESTING.md) for two-PC acceptance. The installer is **unsigned**; a checksum verifies file identity, not publisher identity.

```powershell
cd G:\baymax
npm test
npm run typecheck
node tests/packaged-smoke.cjs
node tests/verify-package.cjs
# Defaults to G:\puff-admin; BAYMAX_ADMIN_ROOT can override it.
node_modules/.bin/electron.cmd tests/admin-ui-smoke.cjs
```

Use `npm run package:win` after shipped app/assets change. Documentation, test-only changes and Cloudflare API updates do not require rebuilding the installer. Do not push repositories without explicit written owner permission.
