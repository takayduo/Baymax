# Baymax release status

Updated **14 October 2026**. Working project: **G:\baymax**, based on Mochi-Ultra; the original projects and LOVE backup remain preserved. This is a local Windows private beta, not a published paid service. The installer has been rebuilt; it has not been installed, uploaded or published by this task.

## Current installer

[Baymax-Setup-1.0.1-x64.exe](release/Baymax-Setup-1.0.1-x64.exe) — **275.4 MiB**, Windows x64, **unsigned**.

SHA256: `c39f2b7a77c6c15384d5ea15480613bde4e985feb22be1c9a1d977d910e2dce9`

[Checksum file](release/SHA256SUMS.txt) · [Build log](audit/windows-package-fourteen.log) · [Artifact/resource verification](audit/release-verification.json) · [Two-PC testing checklist](docs/COUPLE_TESTING.md)

Both frontends were rebuilt, including the Productivity Focus overlay, and the Python engine was repackaged. The packaged EXE passed 11 checks using a disposable profile with external Python/Node removed from PATH. Its engine imports 22 actions, 20 companions and three wardrobe accessories. Byte comparisons verified 116 current build resources in the package, including both renderer bundles, native integration modules, engine prompt and action sources.

Exit the old Baymax/Mochi instance from its tray before installing this version on each PC. Use the Setup EXE for distribution; copying only `win-unpacked/Baymax.exe` omits required resources. A website can offer this installer for download; it does not turn the desktop app into a web app. Only distribute the installer, checksum and public release notes, not the working directory, backups or audit profiles.

## Changes in this build

1. **Remote viewer:** removed the toolbar and cursor-mode toggle. Controlling uses the requested transparent PNG cursor on the page, viewport and video. F11 remains available; closing the window or ending access in the PC tab ends the session. This existing beta feature is outside the public launch scope.
2. **Partner composer:** removed the input/textarea border, outline and shadow, including keyboard focus; the surrounding dark compose bar remains.
3. **SQL clipboard:** Settings uses a bounded native Electron clipboard-write IPC, so the custom app protocol does not need clipboard-read permission.
4. **Repeated notifications:** duplicate incoming message IDs return before UI events and notifications. Outbox cloud retries skip messages already broadcast live.
5. **Tasks:** refreshed segmented controls, rows, checkboxes, time labels, empty state and add bar. Removed header presence and user/heart emojis. Shared tasks remain visible in the appropriate filter.
6. **Partner voice calls:** added direct WebRTC audio, ringing/accept/decline, simultaneous-call handling, separate call mute, filters/noise gate/compressor, live companion speaking indicators and full/compact call cards. The persistent call survives view changes and idle collapse. AI input/output is locked during ringing and calls, then restored on hangup. See [VOICE_CALLS.md](docs/VOICE_CALLS.md).
7. **AI chat:** removed the user switcher and provider/voice chips from the header.
8. **Quick settings:** removed the Claude Code badge.
9. **Music repeat:** Off / Playlist / Song cycles beside Next, persists locally and travels with P2P playback state. Manual Next still advances with Repeat Song enabled.
10. **Duplicate sent bubbles:** sender responses and IPC echoes merge by message ID; rendered history is deduplicated and reading older messages does not continually jump to the bottom.
11. **Live voices:** fixed the runner callback argument mismatch. Selecting a voice saves it and reconnects the Live session without restarting Baymax. All 30 choices have independent Play/Stop sample buttons; previewing does not select the voice. All 30 Google sample URLs returned HTTP 200 during verification.
12. **Quit/leave cleanup:** sends music leave/status and call hangup before disconnecting Supabase. Remaining peers clear the session while local music continues; heartbeat handling covers lost connections.
13. **Focus warning:** uses four seconds, clears after successful repeat blocks and non-privilege failures, has a zero-countdown safety clear, responds to stopping Focus, and includes Dismiss.
14. **Music first play:** extraction jobs queue behind three active jobs; HTTPS M4A/MP4A is preferred. Resolving/loading retries twice with fresh stream URLs, without forcing a manual track switch.

The repository uses Canvas companion rendering rather than the hypothetical SVG API named in the request. Call avatars reuse the existing selected companion, colours, cheeks/freckles, scarf/bow/sparkle and music headphones. No additional hat/eyewear wardrobe was invented.

## Preserved owner changes and earlier work

- Repeat remains inside `.music-mini` directly after Next. Music retains `botX: 59`, `botY: 104` and 78px left card padding.
- Tasks retains zero companion diameter and no agent layout. Zero-diameter views hide the canvas immediately instead of shrinking it into a dot. Expanded opacity follows the layout's diameter.
- Native collapsed state stays synchronized at startup and on transitions; Partner chat can receive focus. Desktop notifications are gated on collapse.
- Chat broadcasts before cloud storage. Cloud message upserts do not write the nonexistent `sender_role` column.
- The 20-companion wardrobe, Puff default, whole-body cursor tracking, breathing, thinking animation, projected decorations/headphones, music bob and spinning dizzy eyes remain.
- Local playlists and the offline-mergeable Our playlist remain. No audio is stored in Supabase; ongoing Listen Together playback controls travel over WebRTC. See [MUSIC.md](docs/MUSIC.md).
- AI commands still operate the built-in music player, task roles, partner messages, focus, navigation and emotes through bounded handlers. Tasks default to the current user unless a partner is explicitly named.
- Engine process ownership/termination, PTT helper recovery/key-picker cleanup, fresh-settings microphone synchronization, check-ins OFF by default, saved interests and click-to-interrupt speech cancellation remain. See [PUSH_TO_TALK.md](docs/PUSH_TO_TALK.md) and [PROACTIVE_SPEECH.md](docs/PROACTIVE_SPEECH.md).
- Embedded settings, compact Home/PC cards, private credentials/user data, original history and existing productivity fixes remain. Previous investigations are in [AUDIT.md](AUDIT.md) and [REPAIR_STATUS.md](REPAIR_STATUS.md).

## Verification

| Check | Result / evidence |
|---|---|
| TypeScript, main and Productivity | Pass: `npm run typecheck` |
| Production frontend builds and full Windows packaging | Pass: [build log](audit/windows-package-fourteen.log) |
| Node regression suite | **46 pass**, [log](audit/fourteen-node-final.log) |
| Music entry point requested by owner | **7 pass**, `node --test tests/music.test.cjs` (also included in the regression suite) |
| Python regression suite | **20 pass**, [log](audit/fourteen-python.log), including interruption, call lock and voice reconnect |
| Actual embedded settings/island renderer | **29 checks pass**, [results](audit/settings-smoke-results.json); includes native clipboard path, saved-layout invariants and incoming-call lock |
| Voice/UI/Focus integration | **9 grouped checks pass**, [results](audit/fourteen-smoke-results.json); two real local RTC peers, synthetic RTP audio, mute/appearance, glare, timeout/cleanup, persistent call UI, stream retry and actual React Focus overlay |
| Music integration | **8 grouped checks pass**, [results](audit/music-smoke-results.json); real local peers, local/shared playlists and companion behaviour |
| Remote viewer | **3 checks pass**, [results](audit/remote-viewer-smoke.json); toolbar absent, cursor rules on all four targets, F11 IPC |
| Voice sample availability | **30/30 HTTP 200**, [results](audit/voice-preview-availability.json); not a live Gemini conversation |
| Wake rendering | Five hide/wake cycles, **1,085 software-rendered frames**, peak near-white coverage **1.84%**, no white panel |
| Final packaged EXE | **11 checks pass**, [results](audit/packaged-smoke-results.json), isolated profile and no external Python/Node on PATH |
| Package freshness | **116 resource matches**, [verification](audit/release-verification.json) |
| Packaged live YouTube playback | **Blocked externally**: search succeeded, but resolving audio returned HTTP 429 and a sign-in/bot challenge. [Attempt](audit/packaged-live-attempt.json), [extractor diagnosis](audit/packaged-music-diagnostic.log). Live playback on this network is not verified. |

The settings test intentionally injects disk/task-save errors to verify draft retention. Those expected stderr messages are not application crashes. Its former hidden-canvas assertions were updated to check the selected wardrobe card and visible Home canvas, preserving the owner's immediate-hide behaviour. Local RTC tests use synthetic media; no partner account was called and no physical microphone was recorded by them.

Preview: [Partner chat, full/compact call and Tasks](audit/fourteen-ui.png) · [Music](audit/ui-music.png) · [Home](audit/ui-home.png).

## Remaining acceptance and launch boundaries

- Run the two-PC checklist with both partners, including physical audio, mic sensitivity/echo, idle call persistence, quitting, shared music and reconnects. Local synthetic peers do not prove WAN connectivity or human-perceived sync/voice quality. There is **no TURN relay**, so restrictive networks may fail direct connections.
- Music still depends on internet access and the upstream streaming service allowing extraction. The current network received a rate-limit/bot challenge. Retry during acceptance on the intended network; no account cookies were accessed or bundled. Automated retries do not bypass provider restrictions.
- Live Gemini/Groq conversations and actual acoustic voice switching were not tested using private API keys. Code-level runner/reconnect, PTT and interruption tests passed. Google OAuth/Drive and payments were not exercised.
- The installer is **unsigned**. Clean-machine install/update/uninstall and Windows GPU/display-scaling/multi-monitor acceptance remain; compiling and launching the unpacked app do not validate those lifecycle operations.
- Optional wake-word/Whisper/Kokoro model stacks are not bundled. Browser automation expects a supported installed browser; development tasks that install Python packages require a separate Python environment. The core packaged engine does not imply every model feature works offline.
- This beta retains the owner's expressly selected **open Supabase testing mode**, using URL + anon key + channel and Me/Her role IDs. It is not account authentication or private pair authorization. No hosted database was changed. Use the private test project; replace this mode before public release.
- [LAUNCH_PLAN.md](docs/LAUNCH_PLAN.md) remains the owner's plan: India first, Groq free chat, BYOK on all plans, solo music Free, Listen Together Pro/Duo, and PC control outside launch scope. Mandatory Google onboarding, central usernames, Cloud, billing, manual subscription grants and paid entitlements are **not deployed or activated**. They were not simulated through local premium flags in this build.
- The online dependency advisory audit remains incomplete from earlier work; this run did not claim a fresh advisory audit. Productivity still reports a large-bundle warning. Historical usage never recorded cannot be reconstructed. Tests do not establish that every possible bug is eliminated.

## Reproduce

```powershell
npm run typecheck
npm test
node --test tests/music.test.cjs
python -m unittest discover -s tests -p 'test_*.py'
npm run build
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/settings-smoke.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/fourteen-smoke.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/music-smoke.ps1
node_modules/.bin/electron.cmd tests/remote-viewer-smoke.cjs
npm run package:win
node tests/packaged-smoke.cjs
node tests/verify-package.cjs
# Optional external streaming check; may be blocked by the provider/network:
node tests/packaged-smoke.cjs --live-music
```

`npm run dist:win` is an alias for `npm run package:win`. Build/test profiles stay inside the workspace. No source changes were committed or pushed, and no installer or hosted service was published.
