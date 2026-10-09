# Baymax repair status — 9 October 2026

For the latest compact UI, embedded settings, Windows packaging and validation results, see [RELEASE_STATUS.md](RELEASE_STATUS.md). The evidence below records the earlier repair pass.

The working copy is **G:\baymax**, based on the version from **G:\Mochi-Ultra**. The original projects were not edited. The LOVE backup remains at **G:\baymax\_backups\LOVE-2026-10-08**. These fixes are local; no release was published and the old running app was not replaced.

## Main results

- Apps now combines real executable shortcuts, resolved updater shortcuts, registered Store apps and observed foreground applications. The scan starts automatically and can also be refreshed from Apps. Exact process names can be added manually for apps without registrations.
- The recorded scan contained **138 registrations**, consolidated into **133 catalog entries: 93 visible applications and 40 hidden utilities**. Examples include Antigravity, Antigravity IDE, Discord, Chrome, OBS, WhatsApp, Word and Excel. The five unwanted names reported by the user are absent from the visible catalog. These are catalog counts from this machine's recorded scan, not a guarantee that every installed or portable program is discoverable. [Catalog evidence](audit/catalog-summary.json)
- Scale/Scale Host, uninstall commands and the specified Windows utilities no longer crowd the default library. Hide/Restore is available. Hiding an app preserves its real usage history.
- Foreground time uses precise elapsed intervals, counts the previous foreground app, handles chunked helper output, splits midnight correctly, and stops accruing through idle, lock, suspend and long sampling gaps. Separate Electron apps and Antigravity can be tracked.
- Overview and Insights use the same selected period and seconds-based totals. Weekly data survives live daily updates. Both show the full recorded app list, including neutral apps; an empty day clears stale data. Scanning the catalog does not create usage.
- Focus expiry, Pomodoro transitions and history are controlled by the backend, including when the Productivity screen is closed. Sample focus records are no longer seeded in normal use.

## Original audit findings and repairs

The original numbered findings are retained in [AUDIT.md](AUDIT.md) as a historical baseline. Its old line numbers refer to the code before repairs.

| Audit items | Current implementation |
|---|---|
| 1–4: missing apps, utility cache, ignored apps and identity collisions | New catalog/discovery and migration; path/AppID identities, aliases, source and launch information; resolved Discord shortcut deduplication; manual process support. |
| 5–8: timing, helper output, idle and tracker failures | Monotonic timing, previous-interval attribution, JSON serialization and UTF-8 buffering, idle/lock/suspend resets, heartbeat/restart and visible health. |
| 9–12: date ranges, stale usage, rounding and incomplete reports | Current-day/calendar-week queries share raw seconds; authoritative empty results; asynchronous period guards; complete app lists. |
| 13–15: focus ownership, history and fabricated sessions | Backend deadlines and exactly-once records, real elapsed durations, break phase support, no production demo sessions. |
| 16–20: conflicting Python/Electron state, duplicate actions, success claims, role assignment and confirmation | Authenticated loopback RPC gives Electron one data owner; typed chat runs once and serially; duplicate tags are deduplicated; actual failures propagate; bounded requests and cancellation; absolute roles; request-ID confirmation with reject/expiry. Legacy action text remains explicitly unverified internally. |
| 21: voice warning/type failures | Correct voice method and message types; both frontend type checks are mandatory. |
| 22: remote input without acceptance | Authenticated peer/session checks, nonce, timestamp, role, consent and expiry; no injector auto-start on input; End/expiry revoke the local session and stop the viewer/host UI. |
| 23: unrestricted cloud access | Auth sign-in, pair membership, private Realtime and scoped SQL policies prepared. **The deployed database still requires the setup below.** |
| 24: unsafe embedded renderer | Web security enabled, Node unavailable in subframes, opaque sandbox, scoped RPC and source/origin validation, restricted asset protocol and IPC senders. |
| 25: shell-based app commands | Exact catalog/path resolution; argument arrays with no shell; ambiguous names fail; closing targets verified executable paths and preserves normal save prompts. |
| 26: public uploads and plaintext credentials | New Drive uploads retain private folder/account permissions and stream data; OAuth uses state/PKCE; OS-backed secret storage and redacted renderer settings; per-account token cache. Existing public links are not retroactively revoked. |
| 27–28: missed chat and lost/deleted tasks | Stable pagination, batch history refresh, durable message outbox and delivery labels; versioned task merges and deletion tombstones; concurrent sign-in attempts cannot replace the latest connection. |
| 29–30: unsafe updates and stale builds | Dirty-install protection; pinned staged updates, dependency/build checks and rollback helper; both frontends built together; lockfiles retained; setup failures abort; launcher rebuilds; Settings displays build time and local-change status. |

Additional corrections: atomic schedule/chat writes report errors; malformed saved data is preserved instead of overwritten; new installations have no fabricated tasks; corrupt Productivity data stops initialization; disk-write problems appear in tracker health. New installs use a separate folder rather than overwriting an existing installation.

## Verification

| Check | Result / evidence |
|---|---|
| JavaScript regression suite | **20 passing**, covering timing, identities, focus, remote consent, app resolution, persistence, task merge, secrets, RPC, OAuth, updater protection and connection races. [Log](audit/final-node-tests.txt) |
| Python regression suite | **4 passing**, including refused/expired confirmations, action failures and environment configuration. [Log](audit/final-python-tests.txt) |
| Production build | Both frontend TypeScript checks and both Vite builds passed. [Log](audit/final-build.txt) |
| Source syntax | 22 active Electron JS/CJS files, 6 PowerShell scripts and 56 Python files passed. [JS/PowerShell](audit/final-source-syntax.json), [Python](audit/final-python-syntax.json) |
| Hidden Electron integration | **7 checks passed**, with the actual embedded page, preloads and built UI, an isolated test profile and fixture backend data. Tests covered all-app reporting, weekly stability, empty-day reset, hidden-app restoration and the frame security boundary. No renderer console errors. [Results](audit/electron-smoke-results.json) |
| Actual Windows foreground helper | Chrome activity was recorded with no parse errors. Test persistence was memory-only and idle state was mocked active. [Results](audit/tracker-smoke-results.json) |

The UI integration test uses controlled data; it does not substitute for a full two-PC, live-account acceptance test. Live Gemini/voice responses, Google uploads/OAuth sign-in, partner messaging, remote input injection, real app termination and update folder swaps were not exercised. Large-bundle and mixed-import build warnings remain as performance follow-up work. Tests cannot establish that the whole application is bug-free.

## Use the repaired copy

1. Exit the old Mochi/Baymax instance from its tray menu so its single-instance lock does not redirect the new launch to the old code.
2. Run **G:\baymax\Launch Baymax.bat**. This rebuilds both frontends and refuses to launch after a failed build. For dependency setup on a fresh machine, run `setup.bat`.
3. Open Productivity → Apps. Automatic discovery populates the catalog; use **Scan All Apps** to refresh, or **Show hidden apps and utilities** to restore an entry. Portable apps can appear when used or be added by their exact process name.
4. Use two apps in turn, then compare Overview and Insights for the same period. Old incorrectly rounded historical totals are retained; precise tracking starts with the repaired version. Missing past usage cannot be reconstructed.

Existing saved credentials migrate to Windows-backed encryption when the repaired app starts. This migration has not been run against your live profile. Keep the original profile if you need to return to the older app, since the older code cannot read the new encrypted secret format.

## Cloud setup still required

The secure local implementation cannot change the deployed Supabase project by itself. In Settings → Live PC-to-PC Sync, copy **1-Click SQL Setup** and review/run it in the intended project's SQL editor. It includes the table definitions and [policy migration](electron/supabase-policy.sql).

Create one Supabase Auth user for each person. As the project administrator, insert their actual Auth UUIDs and the chosen channel in `public.baymax_pairs`. Disable Realtime **Allow public access**, and inspect/remove any other old unrestricted policies on these tables. Sign in with the appropriate account in Settings on each PC. Both PCs need the repaired version. The endpoint test checks project reachability; the private-channel status reports actual sign-in/subscription state.

For private Drive sharing, the intended partner must have access to the chosen folder/files. New code does not turn uploads into anyone-with-link files. Existing public links require separate review if you want to revoke them.

## Developer continuation

Active backend: `electron/productivity`; embedded frontend: `productivity/src`; assistant: `engine`, with shared app/task/chat/focus operations routed through Electron RPC. The older `productivity/electron` tree is retained as copied upstream reference and is **not** Baymax's active backend; its standalone launcher is outside this repair validation. Use the root launcher/build commands.

Useful commands from G:\baymax:

```powershell
npm run build
python -m unittest discover -s tests -p test_engine.py -v
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/smoke-test.ps1
node tests/tracker-smoke.cjs
```

No changes were committed or pushed. Updates deliberately refuse the current modified working tree; publish/review the repaired source and lockfiles before distributing it through the remote installer/updater. The updater refuses upstream revisions without the new validation scripts.
