# Baymax launch plan

Updated 9 October 2026. Decisions from the owner: India first, international expansion later; the existing **Groq** integration for free chat; **bring your own API keys on every plan**. This is an implementation and launch plan. The central account service, Google account onboarding, billing and paid entitlements described here are **not deployed or activated in the current desktop build**.

## Product and pricing structure

| Capability | Free | Pro — pay for yourself | Duo — pay for both |
|---|---|---|---|
| Google account and unique username | Required | Required | Required for both people |
| Groq chat using the user's key | Yes | Yes | Yes, separate keys |
| Task manager | Yes, local-first | Yes | Yes |
| Partner messages and shared tasks | Own Supabase project | Baymax Cloud or own project | Baymax Cloud or own project |
| Gemini Live, screen understanding | No | Yes | Yes for two assigned users |
| AI PC control and partner remote control | No | Yes, with permission | Yes, with permission |
| Productivity, tracking, Insights and focus management | No | Yes | Yes |
| Hosted content storage/sync | No | Yes | Yes for both seats |
| AI provider usage included | No | No | No |

The free central account/username registry is still a Baymax-hosted service. “No Baymax Cloud on Free” means **no hosted conversations, tasks, files or productivity data**, not “no server cost.” Authentication, invitations, abuse prevention, email delivery, backups and bandwidth cost money. Local tasks and Groq chat should work before the user sets up partner sync. Do not force a database tutorial before the user can try these local features.

Choose INR monthly and annual prices only after measuring hosting, payment charges, support and refunds. Do not carry forward the illustrative $3.99/$6.99 prices as a pricing decision. Display the total payable amount, taxes, renewal date, cancellation terms, and that AI charges belong to the API provider. Avoid “unlimited AI” claims. Free refers to Baymax's feature fee, not a guarantee of free Groq usage.

## Onboarding

1. Download and launch the signed Windows installer.
2. Continue with Google in the system browser. Use Supabase Auth, PKCE, state validation, a narrowly allowed callback, single-use codes, and an expiring login attempt. Store refresh tokens with Windows DPAPI. Never put a Google client secret or a Supabase service-role key in the EXE.
3. Reserve a username transactionally: lowercase, 3–24 ASCII letters/numbers/underscores, a database unique constraint, reserved-name list, and a rate limit. Store the stable Auth UUID as identity; never use a mutable username as a foreign key.
4. Show **Free**, **Pro — just me**, and **Duo — both of us**, with an equally clear “Continue free” action.
5. Free enters the app and can later choose “Connect your database” for partner features. A verified paid checkout provisions Cloud automatically.
6. Request microphone, screen capture, PC control and optional Google Drive access when those features are used. Signing into Baymax does not grant Drive access or paid Gemini usage.

Supabase documents Google provider setup and the PKCE code exchange. Configure the Google OAuth client secret only in the Supabase dashboard/server, with the project callback URL; the desktop receives a public project URL/key. [Google provider](https://supabase.com/docs/guides/auth/social-login/auth-google), [PKCE](https://supabase.com/docs/guides/auth/sessions/pkce-flow).

An existing signed-in user can keep local features available offline. Require an initial online login and periodic session renewal; do not erase data on a transient auth failure. Premium capability caches should have a bounded grace period rather than granting permanent access from a local boolean.

## Partner subscriptions and consent

**Pro:** each person owns their own subscription. Search an exact username, show that account's public display name, then send an invitation. Once accepted, create one relationship and configure the eligible shared backend. Billing and relationships are separate records.

**Duo:** the buyer selects an existing username before checkout. The server resolves it to an immutable user ID and attaches it to a checkout intent. A verified payment gives the purchaser a seat and assigns/reserves the second seat. Send the partner an invitation. Acceptance creates the relationship and provisions shared data. Paying for a person must not expose their messages, start monitoring them, grant remote control or pair them without their acceptance.

If the partner has no account, create a cryptographically random, single-use invitation with an expiry; store only its hash. An optional verified-email restriction can bind redemption. After Google signup, the recipient reviews and accepts it. Do not silently select an account merely because an email string matches an unverified form field. A short readable “VIP-8492” code is not adequate as the sole secret.

Rules to implement before launch:

- One active relationship per account for v1; invitations expire, can be declined, and respect blocks. Accepting concurrently must not create duplicate pairs.
- Pro + Pro can use Cloud. Duo's two assigned seats can use Cloud. Free + paid can use the custom database, or the paying user can upgrade to Duo. A single seat must not create an accidental unlimited free Cloud invitation route.
- An already subscribed partner sees the conflict before Duo checkout. Do not sell overlapping seats without explaining the overlap; don't silently cancel their personal subscription.
- Ending a relationship revokes shared access and pending remote sessions. It does not silently cancel a separately owned subscription. Seat reassignment needs a stated cooldown and confirmation; no transfer of the former partner's private data.
- Refunds, failed renewals and chargebacks change entitlements through backend events. Give a documented export/read-only window for hosted content after expiry; never silently switch to an empty database or delete shared content immediately.
- Each PC-control session requires a fresh approval on the controlled PC. A relationship or paid seat is not remote-control consent.

## Supabase architecture

Use a dedicated production Supabase project for Baymax and a separate staging project. Do not reuse a couple's private development database as the public service.

| Data | Central service | Customer's custom project |
|---|---|---|
| Google identity, username and preferences needed for login | Yes, all users | No duplicate public directory |
| Invitations, blocks, pair membership | Yes | Scoped membership claims/adapter state |
| Payment customer IDs, receipts, subscriptions, seats | Server-only | Never |
| Cloud messages, tasks, file metadata | Paid pairs only | Free/custom pairs only |
| AI API keys, OS credentials, screen recordings | Never by default | Never by default |
| Raw productivity history | Local by default | Only if an explicit future sync feature is enabled |

Suggested tables and invariants:

- `profiles(user_id primary key references auth.users, username unique, display_name, avatar_url, created_at)`: a separate private profile keeps email out of username lookup.
- `partner_invites(id, sender_id, recipient_id, token_hash, status, expires_at)` and `blocks(blocker_id, blocked_id)`: participants only, rate-limited creation.
- `pairs(id, status, backend_kind, backend_id)` plus `pair_members(pair_id, user_id)`: uniqueness/transactions enforce one current pair per person.
- `checkout_intents(id, purchaser_id, recipient_id, provider, plan_code, provider_checkout_id, status)`: created by the server before redirecting to checkout.
- `subscriptions(id, purchaser_id, provider_subscription_id unique, state, period_end)`; `seats(subscription_id, user_id, state)`; `payment_events(provider, event_id, received_at, processed_at)` with a unique provider/event pair. Server-only mutation.
- `custom_backends(id, owner_id, endpoint, public_key, template_version, status)`: public connection locator only, disclosed only to accepted pair members. No database password or service-role credential here.
- `messages(pair_id, id, sender_id, body, created_at)` and `tasks(pair_id, id, updated_by, revision, deleted_at, ...)`: UUIDs, pagination and idempotent writes; keep the existing outbox and deletion-tombstone behavior.

Enable Row Level Security on every exposed table. Policies must check `auth.uid()`, accepted pair membership and **current server-derived Cloud eligibility**. Never trust a client-sent plan, sender ID, role or partner name. Use private Realtime topics; authorize both subscription and delivery. Index pair/time pagination and membership lookups. Set attachment limits, quotas and retention; use private storage and short-lived signed URLs. Neither subscriptions nor seat grants can be written directly by desktop clients.

### Custom Supabase: the identity problem to solve

A URL and anon/public key identify a project; they do **not** authenticate the partner or make a token from the central Supabase project valid in a different project. The earlier “hand over the details and it works” proposal misses this trust boundary.

For a supportable free v1, provide a versioned template with tables and a small **Edge Function adapter** in the customer's project:

1. The host deploys the template into their own project, keeps the service-role key solely in that project's server-side environment, and enters the adapter endpoint/public project key in Baymax.
2. Validate schema version and ownership with a signed setup challenge. The host's authenticated central account is bound once to this backend. Never accept an unauthenticated request to reassign ownership.
3. The adapter verifies the central JWT's signature against pinned project JWKS, expected issuer/audience, expiry, and subject. It separately checks accepted pair membership and revocation against the central service or a short-lived, signed membership claim. Fail closed when validation fails; rotate keys safely.
4. An accepted invitation shares the backend locator with the partner. The adapter grants only the accepted pair's namespace. All reads and writes go through its scoped endpoints; service-role access must never become a generic SQL proxy.
5. Use cursor-based polling for this v1 adapter. Do not promise native cross-project Realtime unless a supported authentication integration has actually been implemented and tested.
6. Make clear that the host administers the database and can access its stored content. The partner must agree before sending data. If end-to-end encryption is desired, design key exchange/recovery separately; Supabase alone is not E2EE.

The existing app currently uses **separate Supabase Auth accounts in the same custom project**, with explicit `baymax_pairs` membership and private Realtime. Keep that functional until the adapter is ready; do not deploy the new registry SQL over the current project blindly.

Paid users may select “Use my database” in Settings. Run connection/schema/auth tests first, export a snapshot, reconcile pending writes and IDs, migrate with a checkpoint, and switch both accepted partners together. Preserve the old copy until verification passes. Provide an explicit rollback; never broadcast one partner's new backend configuration without the other's consent.

### Concrete owner setup

1. Create staging and production Supabase projects, choose the intended region, set budget alerts and a backup/restore policy, and keep owner access protected with MFA.
2. Create a Google Cloud project, configure the consent screen, authorized domain/privacy-policy links and Google client credentials. Enable Google in Supabase Auth with its callback URL. Test the exact desktop callback and abandoned/expired login flows.
3. Implement versioned registry/content migrations from the schema above, deploy them to staging, and verify RLS as unrelated user A, user B, accepted partner C, anonymous caller and expired subscriber. Service-role credentials stay in Edge Functions only.
4. Deploy server endpoints for username reservation/lookup, invite creation/acceptance/revocation, checkout creation, webhook handling, entitlement lookup, and data export/deletion. Apply authentication, rate limits and request-body validation to each.
5. Create Razorpay test plans for Pro and Duo. Put API secret and webhook secret in Supabase secrets; the public app contains only public configuration. Configure signed webhooks and monitor retry failures.
6. Build onboarding and an Account & plan settings page backed by these real endpoints. Enforce Gemini/PC/productivity capabilities in Electron IPC and the Python action dispatcher as well as the UI. Cloud access is always enforced on the server. A BYOK desktop client can be modified by its owner, so local checks alone cannot be unbreakable licensing.
7. Publish the custom-project template and its upgrades separately. Test two clean Windows accounts, invite rejection/expiry, two simultaneous invites, paid/free pairs, queued offline messages, duplicate/out-of-order webhooks, refunds, account deletion and database migration.
8. Only then change to live payment keys and enable mandatory account onboarding. The current beta remains usable without pretending that a local flag is a paid subscription.

## Payment provider recommendation

**Start with Razorpay Subscriptions for India**, subject to merchant onboarding and approval for the specific recurring methods you intend to offer. Razorpay currently lists cards, UPI, eMandate and international cards for Subscriptions. Confirm the enabled countries, currencies, international recurring support and fees with your merchant account before advertising them. [Razorpay Subscriptions](https://razorpay.com/subscriptions/), [integration docs](https://razorpay.com/docs/payments/subscriptions/).

For international expansion, compare Razorpay's approved international capabilities with **Paddle as merchant of record**. Paddle can handle transaction sales-tax calculation/collection/remittance in supported markets, which reduces operational work, but supplier verification, product eligibility, prohibited countries and Indian business obligations still apply. Its published standard Checkout price is currently 5% + $0.50 per transaction; low-price monthly plans need careful margin calculation. Do not treat a supported buyer country as automatic merchant approval. [Supported suppliers](https://www.paddle.com/help/start/intro-to-paddle/which-countries-are-supported-by-paddle), [supported sales markets](https://developer.paddle.com/concepts/sell/supported-countries-locales/), [pricing](https://www.paddle.com/pricing).

Stripe is not the default recommendation here because new Indian accounts are currently invite-only. [Stripe India availability](https://support.stripe.com/questions/stripe-accounts-are-invite-only-in-india?locale=en-GB).

Keep a small provider adapter, not two unrelated billing systems: `createCheckout`, `verifyWebhook`, `fetchSubscription`, `cancelAtPeriodEnd`. Store server-owned plan/price mappings. Verify the raw webhook signature, deduplicate the provider event ID, verify amount/currency/plan/customer, and process the subscription state transactionally. Reconcile with the provider when events arrive out of order. A checkout success screen, query string or desktop callback **must never grant Pro**. Return “Payment processing” until the backend confirms it. Preserve an audit trail; never store card numbers.

## India first and international release

Worldwide distribution is possible in principle, but this document is not legal clearance. Before accepting money, have an Indian accountant/lawyer confirm business registration/KYC, GST and export-of-services treatment, invoicing, refund/cancellation and recurring-payment terms. Review applicable privacy duties, breach response, deletion/export rights, cross-border processing and the obligations of each market you actively target. Restrict launch countries through checkout until reviewed.

India has published the DPDP Rules 2025 and an enforcement timeline; requirements have phased commencement, so check the provisions applicable on the actual launch date rather than assuming every rule is already effective. [MeitY rules and timeline](https://www.meity.gov.in/documents/act-and-policies/digital-personal-data-protection-rules-2025-gDOxUjMtQWa?pageTitle=Digit).

Also review the Baymax name/mascot and rights to all inherited artwork, sounds, code and fonts before commercial distribution. A repository's MIT label does not establish the rights to third-party branding/assets. Publish privacy, terms, cancellation/refund and support pages; explain what screen/PC access can do and collect permission at the point of use. Begin with an adult-only pilot if you are not implementing a minors/parental-consent flow.

## Release boundary

The EXE is a Windows desktop download, not a browser conversion. A website can host the installer, checksums, release notes and account/checkout portal. Browser visitors cannot run the same Windows process-control features inside a normal webpage.

Before a public paid launch: obtain code signing, validate a clean-machine install/update/uninstall, audit dependency/asset licenses, implement the real account and entitlement service, complete two-PC acceptance testing, and configure backups and incident alerts. Current build/test evidence and unresolved limits belong in `RELEASE_STATUS.md`; do not describe a local installer or mock checkout as a live commercial service.
