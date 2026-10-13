# Music in Baymax

Home has Previous, Play/Pause, Next and a three-dot Music button. Play starts the selected playlist without opening Music. In Music, **Repeat** sits immediately beside Next and cycles **Off → Playlist → Song**. Off advances in order and stops at the end; Playlist wraps to the first song; Song repeats the current song. Manual Next still advances when Song is selected. The mode is saved locally and shared with playback controls while listening together. Music also supports search, track selection, seek, volume, creating/renaming playlists and moving/removing songs.

**Our playlist** is shared with your partner. Both people can add, remove and reorder songs. A copy stays on each PC; edits sync when both PCs connect to the same Supabase project/channel, including after offline edits. No audio or playlist table is stored in Supabase: playlist metadata uses Realtime messages. If the other PC is offline, it receives edits the next time both PCs are connected. Internet is required to stream songs; listening alone does not require an online partner.

Local playlists live in the existing user data directory's `CoucouCreator/playlists.json`. Shared edits live beside it in `shared-playlist-<project-and-channel-hash>.json`, including song ID, title, artist, duration, added-by role, ordering and deletion records. Song-level logical revisions merge unrelated additions, keep removals from being resurrected by an old copy, and deterministically resolve concurrent edits to the same song. Project/channel changes select a different shared file. Corrupt files are reported and preserved. Do not copy these files while the app is saving them.

There are up to 50 playlists including Our playlist and 200 visible songs per playlist. Concurrent offline additions can exceed the shared display limit; all records stay on disk and the first 200 in merged order are visible. Removing songs reveals the remainder. Shared history retains up to 5,000 song IDs/tombstones before requiring a new channel. Wall-clock differences between the PCs do not decide whose edit wins.

When your partner is online and playing, Home and Music show a song badge and Join. Joining adopts the host's current queue into Our playlist without deleting existing shared songs. Either person can play/pause, skip, seek, pick a track, and edit the shared playlist while joined. Leave/disconnect preserves local playback. Each PC resolves its own stream URL.

Supabase carries the status badge, handshake and shared-library edits. Ordered WebRTC data channels carry ongoing playback controls, queue snapshots and clock probes. Larger queues use bounded chunks. Host ordering resolves simultaneous playback controls, and timestamp correction compensates for drift. Buffering, hardware and networks mean sample-perfect synchronization is not guaranteed.

Direct WebRTC uses STUN; no TURN relay is configured. Some networks need TURN, so connection failure reports an error and leaves playback local. Automated checks cover real local peers, not two-PC WAN performance.

Leaving or quitting sends a session-scoped leave signal and clears the playing badge before disconnecting. The remaining partner returns to local playback. A lost connection is also detected through the peer heartbeat; an abrupt crash cannot send a final message.

Companion settings includes **Show headphones when playing music**, on by default. All 20 companions use the accent colour. Playback starts a 1.8-second bob, then settles with headphones retained until pause/stop. Headband, earcups and wardrobe decorations follow yaw/pitch with projected depth and inherit body tilt. Three quick companion clicks show spinning spiral eyes for 3.4 seconds.

AI voice and text can play a named song, pause/resume/skip, set volume, add the current song or search result to Our playlist, join the partner or leave. Controls use the built-in player and wait for confirmation. Failures are reported rather than claimed as successful.

The installer bundles yt-dlp and its JavaScript support; Electron supplies the runtime. No external Python/Node is needed for music. Extraction jobs queue behind a maximum of three active jobs. HTTPS M4A/MP4A audio is preferred, and a failed first play retries twice with fresh stream URLs. Streaming services may change requirements and need an extractor update. References: [yt-dlp](https://github.com/yt-dlp/yt-dlp#usage-and-options), [RTCDataChannel](https://developer.mozilla.org/en-US/docs/Web/API/RTCDataChannel).

Launch plan: solo music is Free, and Listen Together requires Pro/Duo. The current private beta has no activated billing or entitlement enforcement. See [LAUNCH_PLAN.md](LAUNCH_PLAN.md).

Verification: `node --test tests/music.cjs`, `scripts/music-smoke.ps1`, `scripts/settings-smoke.ps1`, `scripts/wardrobe-smoke.ps1`. After packaging, `node tests/packaged-smoke.cjs --live-music` checks real search and muted HTML5 playback with external Python/Node absent from PATH.
