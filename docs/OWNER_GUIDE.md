# Baymax account and membership setup

Updated 14 October 2026. Desktop code and migrations are implemented locally. A packaged EXE does not deploy a Supabase schema or enable Google/Razorpay in their dashboards. The current public project configuration is preserved in `electron/cloud-config.json`; no server secret belongs there.

## First: enable Google and apply the database

1. Use a dedicated central Supabase project, separate from the old open private couple-testing database. Back up an existing central project before migrating.
2. Run **all of `electron/supabase-cloud.sql`** in the Supabase SQL Editor as owner, or apply the four ordered files in `supabase/migrations`. The bundle is equivalent to those four files. It intentionally refuses a project containing `mochi_messages`.
3. Enable Google in Supabase Authentication. Store the Google client ID/secret in that dashboard and add the project OAuth callback in Google Cloud. Enable only the intended login providers.
4. In Supabase's allowed redirect URLs, allow the desktop callback `http://127.0.0.1:42837/auth/callback**`. Keep the loopback host, port and path exact; the suffix allows the randomly generated state query. Baymax itself checks the exact host/path, a cryptographically random state, a five-minute expiry and single-use PKCE code exchange.
5. `electron/cloud-config.json` takes the central Supabase URL/public anon or publishable key and the **public** Razorpay key ID. Its `planIds` are optional public hints; the server owns actual billing mappings. Environment overrides: `BAYMAX_CENTRAL_URL`, `BAYMAX_CENTRAL_PUBLIC_KEY`, `BAYMAX_RAZORPAY_KEY_ID`. Existing per-installation `cloud-config.json` in Baymax's app-data directory overrides the bundled file. Service-role, Google and Razorpay secrets stay on the server.

Username reservation now uses authenticated PostgREST `profiles` upsert directly, with `user_id` taken from the verified session. No Edge Function is needed for login, username creation, membership display or beta activation. RLS confines profile writes to the owner; unique/reserved-name constraints and the username-immutability trigger apply at the database. Usernames are 3–24 lowercase ASCII letters, digits or underscores.

## Beta: blank Razorpay key

With a blank desktop `razorpayKeyId`, choosing Pro/Duo calls authenticated SQL `claim_beta_membership`. It grants a **server-owned 365-day membership** without collecting money. Expiry is fixed at the first claim; repeated clicks do not extend it. Pro can become Duo while retaining that expiry. Duo can reserve the second seat, or assign it to a registered username. A partner invitation still requires acceptance before sharing data/PC access. An existing unrelated membership or an already assigned second seat is never overwritten.

The migration explicitly enables beta grants in the private server table. Removing a public key from a modified production desktop must not grant access after beta ends. **Before enabling real payments**, run:

```sql
update baymax_private.beta_settings set enabled = false where singleton;
```

Previously granted beta memberships retain their existing expiry. To end one deliberately, revoke that subscription/seats in the owner dashboard. Desktop users cannot write subscriptions or seats directly. Owner comp functions remain available:

```sql
select public.grant_free_membership('friend_username', 'pro', 365);
select public.grant_free_duo('first_username', 'partner_username', 365);
select public.revoke_free_membership('friend_username');
```

Those functions are owner/service-only, not desktop-callable. They refuse overlapping active seats.

## Cloud, partners and real payments

Deploy `account`, `content`, `billing` and `razorpay-webhook` from `supabase/functions`, using the central project's reference. With the Supabase CLI linked to this root:

```powershell
supabase functions deploy account --project-ref YOUR_CENTRAL_REFERENCE
supabase functions deploy content --project-ref YOUR_CENTRAL_REFERENCE
supabase functions deploy billing --project-ref YOUR_CENTRAL_REFERENCE
supabase functions deploy razorpay-webhook --project-ref YOUR_CENTRAL_REFERENCE
```

The supplied config disables gateway JWT verification because handlers verify the Google session themselves; the webhook verifies the raw Razorpay HMAC instead. Do not remove those handler checks. Use an asymmetric Supabase signing key for custom-project JWKS verification.

Cloud files use the private `baymax-files` bucket created by migration 2. Messages, tasks, private signaling and files require accepted pair membership and server-verified eligibility. Pro + Pro and Duo's two seats qualify. Expiry/revocation denies new Cloud operations; desktop cached paid access lasts at most 72 hours and never beyond the subscription end. Raw productivity records and music playlists stay local.

Set Supabase server secrets `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` and `RAZORPAY_WEBHOOK_SECRET`. Create provider plans and populate `billing_plans` with your approved plan IDs, exact minor-unit INR amounts, period, total count, tax handling and terms URL; enable only verified rows. Codes are `pro_monthly`, `pro_annual`, `duo_monthly`, `duo_annual`. The desktop's ₹199/₹349 monthly defaults are display defaults, not authority to change provider prices. The billing API validates the provider plan and shows actual configured amounts.

Set the same public Razorpay key ID in desktop configuration. Plan selection opens an isolated Razorpay checkout window with no Baymax preload or Node access. Payment success in a browser never grants access: signed webhook processing fetches/reconciles the provider subscription and paid invoice, deduplicates events and updates server seats. Test success, failures, duplicate/out-of-order events, cancellation and refunds using Razorpay test mode before live keys. Configure subscription/payment/refund/dispute events supported by the webhook handler.

## Personal Supabase database

Settings → Database & sync offers **Baymax Cloud Database** and **Personal Supabase Database**. Free can use a personal project; paid users may choose either. Enter the personal project URL and public anon key. Do not enter a database password or service-role key.

Copy `supabase/custom/config.toml`, `functions` and `migrations` into the `supabase` subfolder of a separate CLI project for the personal database. Apply its SQL template and deploy `custom-adapter`. It verifies central JWTs against the pinned central JWKS and confirms accepted membership before every operation. Its service-role credential is supplied only by its own server runtime.

Click **Prepare connection** in Baymax. Setup details are copied to the clipboard for the host. Set the returned backend ID, owner ID, challenge and central URL as the adapter's corresponding `BAYMAX_*` secrets, plus `BAYMAX_CENTRAL_PUBLIC_KEY`. Click **Verify setup**. Invite/accept your partner using the Account page. A URL/key alone does not authenticate somebody to another Supabase project.

For an existing pair, choose a destination and request a switch. Both partners consent. Copying temporarily freezes shared writes; chunked transfer verifies each row/count before commit. Resume interrupted copies, cancel before commit, or request a verified reverse migration afterward. Download Cloud files separately before switching; only messages/tasks migrate. Original storage is retained. Personal-project administrators can read their database contents; this is not end-to-end encryption.

## Desktop behavior and checks

- First-run welcome uses newly written wave/glide/point choreography and the selected wardrobe appearance. Google → username → three plans. Reduced-motion mode skips the glide. “Explore Baymax” and the six navigation tabs remain usable throughout.
- Account, Plans & Membership, Database & sync and Applications are separate settings pages. No raw public billing keys or price-code fields are exposed in normal settings.
- Free keeps Groq chat with BYOK, local tasks and solo music after identity setup. PC Control, Gemini Live, productivity and Listen Together show upgrade prompts. Remote access still needs an explicit request/accept and can be disconnected; payment never consents to screen capture.
- Native app-launch shortcuts remain independent of remote access licensing. The change does not enable the older autonomous AI computer-control tools.
- The installer remains unsigned unless a signing certificate is supplied. Test two real Windows PCs and real Google login before distributing publicly. Local tests use isolated fixtures and cannot establish that dashboard credentials/functions are deployed correctly.

Validation commands: `npm run build`, `npm run test:cloud`, `python -m unittest discover -v -s tests -p "test_*.py"`, `scripts/settings-smoke.ps1`, and Electron `tests/onboarding-smoke.cjs`. Windows sandbox restrictions can require elevated test execution for loopback callbacks, asyncio and temporary files. `npm run package:win` packages the Windows installer; `node tests/packaged-smoke.cjs` and `node tests/verify-package.cjs` verify the result.
