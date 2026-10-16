# Partner connection recovery

Source update: 17 October 2026. This change targets the false Offline status and Listen Together teardown after long sessions. It keeps the existing authenticated PostgREST RPCs, private topic names, message outbox, pairing rules and user-facing controls.

## What was failing

REST success does not establish that the private WebSocket is subscribed. Previously, a channel error only changed the status text; there was no application-owned resubscription. Presence also depended solely on presence packets even when recent partner messages were available from REST. Finally, an Offline notice immediately ended a healthy music data channel.

The installed Supabase SDK already calls the `accessToken` callback during heartbeats. An explicit `setAuth(token)` does not disable that callback. The failure is therefore broader than a single missing initial auth refresh: recovery must also replace an expired or stalled subscription. See the [Supabase setAuth documentation](https://supabase.com/docs/reference/javascript/setauth).

## Implementation

- `electron/account.js`: refreshes sessions within two minutes of expiry, coalesces concurrent refreshes, persists the rotated session and emits an internal `token-refreshed` event. No token is included in renderer account snapshots. A maintenance call runs even when account snapshot requests fail. Generation checks reject results from a replaced login.
- `electron/realtimeChannel.js`: owns one private subscription and is used for both account and pair topics. It explicitly applies fresh auth, checks it every 15 seconds, uses 15-second socket heartbeats and detects missing acknowledgements after 60 seconds. Every retry creates a fresh client, authenticates it before subscribing, invalidates old callbacks and disposes the previous socket.
- Recovery begins after roughly 2 seconds, then backs off through 4, 8, 16 and 30 seconds, with up to 499 ms jitter. Repeated outages remain capped at that delay. A stalled join has a 12-second watchdog. A gap in the maintenance timer triggers immediate sleep/wake recovery; a recovered REST connection or token refresh accelerates a pending retry. These are retry delays, not a promise that an unavailable server will reconnect within that time.
- `electron/cloudTransport.js`: keeps REST catch-up running while the socket reconnects. Socket replacement does not clear partner presence. Valid partner traffic refreshes the existing 60-second liveness window. A partner-authored database message younger than two minutes extends liveness based on its creation time; rereading old history and saving our own messages do not. HTTP server time compensates for local clock skew. Explicit offline signals suppress older message evidence. Only state transitions emit presence updates.
- `src/music/peer.ts` and `src/music/player.ts`: an Offline notice does not close an open data channel with a recent peer heartbeat. The existing 12-second peer timeout, explicit Leave, pair changes and entitlement revocation still end the session. Local playback continues according to the existing behavior.

Logout, account replacement, changed/revoked pairs and loss of Cloud eligibility cancel channel recovery. Old channel callbacks and late task/message reads cannot affect a replacement connection. No control signals are queued or replayed by this recovery layer.

## Verification

- `npm test` passed the initial 74-test suite. The final `npm run build` runs both TypeScript projects, the expanded **77-test** regression/account/SQL suite, and both production frontend builds. See `audit/realtime-recovery-build-20261017.log`.
- `tests/realtime-recovery.cjs` includes 24 simulated hours of JWT rotations on both private topics, channel errors/timeouts/closures, heartbeat failure, stalled joins, sleep/wake, bounded backoff, stale callbacks, concurrent refreshes, revocation, recent partner messages and clock skew. Time and servers are simulated; this is not a live 24-hour Supabase soak test.
- `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/music-smoke.ps1` passed **9 checks** in isolated Electron, including real local RTCDataChannels. Repeated cloud Offline notices left the session connected and subsequent seek/control synchronization worked. Results: `audit/music-smoke-results.json`. Media resolution/audio are fixtures; these checks do not validate live YouTube availability or two remote PCs.

No production database migration or Edge Function deployment is needed. No installer was rebuilt in this pass: distribute a newly packaged build to **both PCs** to test these changes. The existing installer does not contain this update.

For two-PC acceptance, keep a session running across at least two token expirations, then test a brief Wi-Fi interruption and sleep/wake. Confirm presence and signaling recover without restarting, chat catch-up remains intact, and Leave/unpair still close the shared session. Genuine network outages, revoked sessions and unavailable servers cannot provide uninterrupted connectivity; a lost P2P session may require Join again after the connection recovers.
