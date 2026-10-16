# Baymax release status

**17 October 2026 — partner connection recovery (source update):** account and pair sockets now renew auth and reconnect automatically; recent partner database messages protect presence, and cloud Offline notices no longer terminate a healthy P2P music session. Verification and limits are recorded in [connection recovery notes](docs/REALTIME_RECOVERY.md). The final source checks cover **77 tests**, both TypeScript projects and frontend builds; the isolated Electron music smoke covers **9 checks**, including real local WebRTC controls after an Offline notice. Installer packaging was not run for this update. Installer hashes and package claims in the older sections below are historical evidence, not verification of this source update.

Updated **15 October 2026**. Desktop: **G:\baymax**. Owner console: **G:\puff-admin**, live at **https://puff-admin.pages.dev**. Private beta; two-PC and paid-service acceptance remain.

**Later 15 October source update — original sounds:** all 28 inherited companion/UI recordings have been replaced in source with the newly synthesized Puff Soft v1 pack. Artwork and sound triggers are unchanged. See [creation notes](docs/SOUND_ASSETS.md) and [listening preview](docs/sounds-preview.html). Installer packaging was explicitly skipped: the installer described below is the **earlier artifact and still contains the inherited sounds**. Its earlier freshness result does not apply to the current source; rebuild and reverify before distributing the replacement pack.

Sound update verification: **59 tests** and both frontend builds passed ([build log](audit/original-sounds-build.log)); **12 real Chromium audio/preview checks** passed ([result](audit/sound-smoke/result.json)). The generator reproduces all 28 WAVs from sample-free recipes, and their hashes differ from every inherited recording.

## Verified installer

[Baymax-Setup-1.0.1-x64.exe](release/Baymax-Setup-1.0.1-x64.exe) — **286,034,455 bytes / 272.8 MiB**, Windows x64, **unsigned**.

SHA256: `39a663ba4e79e1f3273dcc89a3e0ac32ceea75f4f08d939648a53a789ddee52e`

[Checksum](release/SHA256SUMS.txt) · [Resource verification](audit/release-verification.json) · [Packaged checks](audit/packaged-smoke-results.json) · [Two-PC checklist](docs/COUPLE_TESTING.md).

The owner's artifact matches this hash. Windows Authenticode reports **NotSigned**; the earlier claim that it was signed was incorrect. A checksum does not establish publisher identity. This continuation verified the existing artifact rather than rebuilding it: new changes affect the separate admin site, documentation and tests only.

The executable boots with an isolated disposable profile and no external Python/Node on PATH; its engine discovers 22 actions. All 121 checked resources match current renderer, Electron/native modules, engine prompt/actions and built engine executable. This does not replace clean-machine install/update/uninstall testing.

Quit old tray instances before installing on both PCs. Distribute the Setup EXE and checksum, not a standalone `win-unpacked/Baymax.exe` or source/audit folders. This is a desktop download, not a browser conversion.

## Current fixes and deployment

- Central account/content use authenticated PostgREST RPCs and private Realtime channels, with no central Edge Functions. Account snapshots do not invent fallback entitlements; client plan flags cannot grant database privileges.
- Server-authorized pair publishing and rotating topics protect future traffic after revocation. Tasks use authenticated actor IDs/revisions; failed writes remain pending. Tombstones, pagination and immediate chat delivery remain.
- Duo is limited to the purchaser plus one assigned recipient. Invitations require acceptance. Ending/revoking the gift frees that seat without cancelling another person's separate subscription.
- The admin includes people/email search, plan grants/durations/lifetime, seat inspection, force-unpair, device heartbeats, audit, beta controls, announcements and emergency Cloud pause. Provider mandate cancellation/refunds are separate from access revocation.
- The deployed update rejects missing secrets, binds session hashes to the session secret, preserves Workers-compatible manual redirects and maps database errors without raw credentials.
- Dashboard tests now use the actual admin project and observable UI conditions instead of a fragile 230ms delay; stale success output is cleared before each run.

The owner reported applying hosted Supabase upgrades 007–010. Local PostgreSQL tests validate schema/permissions; live authenticated account/admin mutations have not been exercised in this continuation. Public-site security checks do not prove those workflows.

## Verification on 15 October

| Check | Result / evidence |
|---|---|
| Desktop regression/account/SQL suites | **57 passed** — [log](audit/owner-audit-node-20261015.log) |
| Both TypeScript projects | **Passed** — [log](audit/owner-typecheck-20261015.log) |
| Admin API/session/CSRF/errors | **7 passed**, `G:\puff-admin`: `npm run build` |
| Cloudflare Pages Functions compilation | **Passed** |
| Dashboard views, grant interaction, narrow layout | **10 fixture checks passed** — [result](audit/admin-ui/result.json) |
| Packaged desktop/engine | **11 passed** — [log](audit/owner-packaged-smoke-20261015.log) |
| Package freshness | **121 resources match** — [verification](audit/release-verification.json) |
| Live admin | **200** homepage, **401** unauthenticated session/data, **403** foreign-origin login — [result](audit/admin-live-20261015.json) |
| Windows signature | **NotSigned**; hash matches supplied artifact |

Cloudflare deployment **0323c6b1** ([deployment URL](https://0323c6b1.puff-admin.pages.dev)). Sign in at the permanent origin **https://puff-admin.pages.dev**; preview origins intentionally cannot establish owner sessions. The three owner-console secret names are present; no values were exposed. Existing sessions need to sign in again.

## Preserved features

Consent-based PC Control, partner calls, Listen Together, Gemini/proactive voice/PTT, event-driven task/chat delivery, local playlists, productivity and companion rendering remain intentional features. Check-ins default off; interests and click-to-interrupt remain. Free chat uses **Groq**, and all tiers use the user's own API keys. The owner's later requirements include paid PC Control, superseding the original launch-plan exclusion.

Repeat stays beside Next. Tasks immediately hides its companion; Music retains its left companion position/padding. Native collapsed state and Partner focus remain synchronized; desktop toasts only show while collapsed. Legacy messages omit `sender_role` and broadcast before persistence. Puff stays default in the 20-companion wardrobe, including custom colors/accessories, breathing/thinking and music headphones.

## Remaining acceptance and limits

- Test two real PCs: login, invitations, Duo assign/revoke, unpair/reconnect, remote consent, tasks/chat, physical mic/PTT, interruption and Listen Together. Local/synthetic checks do not prove WAN latency or acoustic quality. No TURN relay is configured for restrictive networks.
- Exercise live owner actions on staging accounts and confirm hosted RLS/private-only Realtime settings; extra hosted policies are outside local tests.
- Razorpay secrets were absent from the verified production secret-name list. Integration exists, but checkout/webhooks/refunds/renewals are not activated or exercised. A live admin site is not a live paid service.
- Installer remains unsigned. Clean-machine lifecycle, GPU/display scaling and multi-monitor acceptance remain.
- Streaming depends on upstream availability. An earlier YouTube attempt hit HTTP 429/bot verification; no new live playback claim is made. Physical Gemini/Groq conversations with private keys were not tested here.
- Legacy open personal-project mode remains private testing only, separate from protected central Cloud. Custom adapter setup/migration is not verified with the new direct central RPC implementation; automatic backend switching is not a completed launch feature.
- Optional wake-word/Whisper/Kokoro stacks are not bundled. No fresh dependency advisory or legal/asset-rights audit was completed here.

Operations: [OWNER_GUIDE.md](docs/OWNER_GUIDE.md), `G:\puff-admin\HOSTING.md`. Architecture: [HANDOFF_TO_CHATGPT.md](docs/HANDOFF_TO_CHATGPT.md). No Git commit/push was performed in this continuation; `G:\puff` was not overwritten.
