# Baymax release status

Updated 10 October 2026. Working project: **G:\baymax**, based on Mochi-Ultra. The original projects and the LOVE backup remain preserved. This is a local Windows beta build, not a published paid service.

## Desktop changes

- Home has a **90px content card** (146px including navigation and outer spacing), a balanced two-by-two app grid, matching dark-glass New task/Chat buttons, and space between the task count and corner arrow. New installs start with configurable shortcuts rather than assuming Discord/OBS/Premiere are installed; existing configured paths are preserved.
- Chat keeps one dark input bar. Its textarea has no border, outline or shadow in either idle or focused state. Keyboard focus remains visible on the surrounding bar. Failed sends preserve the draft.
- PC access is a **90px horizontal card** with an icon and partner information on the left and Request Access on the right. Incoming requests temporarily expand for screen selection and explicit consent. Failed requests report an error, and undelivered requests release the pending session.
- Full settings now opens inside the expanded companion, with eight categories and scoped styling. There is one Live voice selector. Renaming the assistant updates authored UI labels and prompts without rewriting user messages or memories. Settings save partial changes and display failures rather than clearing an unsaved API key.
- Home, tasks, partner chat, navigation and Productivity share the dark styling. Productivity icons and fonts work without third-party font downloads. Task-save errors retain the draft; blank times no longer become invented deadlines.
- The transparent native window waits until ready before appearing. Mouse pass-through changes are coalesced, hover boundaries use hysteresis, and invisible embedded views stop painting. This addresses the identified wake/flicker paths.
- The packaged engine uses bundled Python and separate writable user data. Notification sounds and native icons are included. Packaged builds use manual installer updates rather than running the source-code Git updater.

Prior app-discovery, tracking, Insights, focus, credential, partner-sync and remote-consent repairs are documented in [REPAIR_STATUS.md](REPAIR_STATUS.md). The original findings remain in [AUDIT.md](AUDIT.md).

## Validation

| Check | Result / evidence |
|---|---|
| Both TypeScript frontends and production bundles | Pass, [build log](audit/ui-build.txt) |
| Node regression suite | 21 pass, including foreground accounting, catalog filtering, scoped asset loading and stable hover handling |
| Python regression suite | 4 pass; 58 engine Python files parse successfully |
| Built companion/settings UI | 15 checks pass, [results](audit/settings-smoke-results.json) |
| Embedded Productivity | 7 checks pass, [results](audit/electron-smoke-results.json) |
| Wake rendering | Five hide/wake cycles; 838 captured software-rendered frames; no white panel. Peak near-white coverage 1.86% of the frame, including text and mascot |
| Packaged executable | 6 checks pass, including actual EXE startup and embedded settings, [results](audit/packaged-smoke-results.json) |
| Bundled engine imports | 21 registered actions, no import failures; writable data separate from program resources |

The settings test deliberately simulates disk-save failures to verify draft retention; the corresponding expected IPC error lines in its stderr are not unexpected app crashes. An earlier test window used Electron's default opaque background and caught an initial white frame. The test now matches the production transparent window configuration and passes without ignoring initial frames.

Visual previews: [Home](audit/ui-home.png), [Chat](audit/ui-chat.png), [PC](audit/ui-pc.png), [incoming consent](audit/ui-pc-consent.png), [embedded settings](audit/settings-companion.png).

## Installation and distribution

**Installer:** [Baymax-Setup-1.0.0-x64.exe](release/Baymax-Setup-1.0.0-x64.exe), 274.4 MiB, Windows x64, NotSigned. [SHA256 checksum](release/SHA256SUMS.txt). The actual packaged app passed six startup/asset checks with a disposable profile and no external Python on PATH. Packaging completed successfully; [build log](audit/windows-package-final.log), [artifact verification](audit/release-verification.json). Exit an older Mochi/Baymax instance from its tray before launching this version. The installer is intended for Windows 10/11 x64 and includes the core Python engine; end users do not need to install Node.js or Python for the core app. For source development use `Launch Baymax.bat`.

Use the Setup EXE for distribution; copying only `win-unpacked/Baymax.exe` omits its required resources. A website can offer the EXE for download; this does not convert Windows desktop controls into browser functionality. Upload only the installer, checksum and public release notes, not this working directory or its backups/audit profiles.

## Remaining release boundaries

- The installer is **unsigned**. Obtain a signing certificate and verify install/update/uninstall on a clean Windows machine before a public paid launch. Building an installer is not the same as validating those lifecycle operations.
- The render test uses software composition. Actual idle/wake behaviour still needs acceptance testing on the user's GPU, display scaling and multi-monitor setup.
- Live Gemini/Groq calls, microphone/speaker hardware, Google OAuth/Drive, two-PC partner messaging/control and payment processing have not been exercised with live accounts in this verification run.
- Optional local wake-word/Whisper/Kokoro model stacks are not bundled. The core engine and supported desktop actions are packaged, but this is not a claim that every optional AI/model feature works offline. Browser automation expects an installed supported Chrome/Edge browser. Development tasks that install Python packages require a separate development Python environment.
- The existing Supabase pair/RLS migration still requires owner setup; no production database was modified. Mandatory Google account onboarding, central usernames, Baymax Cloud, subscription entitlements and paywalls are **planned, not implemented or enabled**. See [the launch plan](docs/LAUNCH_PLAN.md) for India-first Razorpay, future international expansion, Free/Pro/Duo, BYOK and custom Supabase architecture.
- The online dependency advisory audit is incomplete: automatic approval review rejected that audit attempt because it hit a usage limit. Local compilation, functional tests and packaging do not replace an advisory audit.
- Productivity still produces a large-bundle warning. Historical usage that was never recorded cannot be reconstructed. Existing historical data was preserved. Tests do not establish that every possible application bug has been eliminated.

## Reproduce

```powershell
npm run build
python -m unittest discover -s tests -p test_engine.py -v
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/settings-smoke.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/smoke-test.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/package-win.ps1
node tests/packaged-smoke.cjs
```

The Windows packaging helper verifies the official winCodeSign archive checksum and extracts only Windows tools to avoid unrelated macOS symlink privileges. This follows the publisher's [pinned tool metadata](https://github.com/develar/app-builder/blob/master/pkg/download/tool.go).

Builds and test profiles stay inside this workspace. No source changes were committed or pushed, and no installer was published.
