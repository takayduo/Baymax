# Partner voice calls

Open Partner chat and use the phone button. Incoming calls wake the island, ring for up to 30 seconds, and require Accept. Decline or Cancel ends ringing. Connected calls show two customized companions, local speaking indicators, Mute, Chat and End call. Chat reduces the card to a compact header; clicking that header expands it. Calls continue across view changes and idle collapse. Reopening Baymax during a call returns to Partner chat.

The persistent `Calls` singleton in `src/call/player.ts` owns `VoiceCall` in `src/call/voiceCall.ts`. Views render its state without owning media. Microphone capture is requested on acceptance; the caller captures only after the partner accepts. Cancellation also disposes a microphone returned by a late permission request.

Supabase carries bounded ring/accept/offer/answer/decline/hangup messages and initial appearance metadata. Audio travels directly over WebRTC RTP, never through Supabase. The ordered `baymax-voice` data channel carries mute state, appearance changes, hangup and a two-second heartbeat. Audio levels are calculated locally from analysers, not broadcast. Direct connections use Google and Cloudflare STUN; there is no TURN relay or guaranteed connectivity through every network.

Capture requests browser echo cancellation, noise suppression, automatic gain control, mono audio and 48 kHz. The send chain is an 85 Hz high-pass filter, 3 kHz presence boost, 12 kHz low-pass filter, smoothed noise gate and compressor. The gate has a 180 ms hold, 8 ms opening and 80 ms closing time constants; hardware acceptance testing is still needed for soft voices and unusual microphones. This is a local filter pipeline, not a claim of Discord-equivalent audio quality.

The call microphone has its own mute state. While ringing or connected, the renderer, Electron bridge and Python response gate lock the AI microphone and speech output. Ending the call restores the configured AI microphone mode. Changing the top-bar AI microphone cannot unmute the call. Both raw and processed call tracks are disabled when muted and stopped on hangup.

Current wardrobe customizations supported by the application are shared: chosen avatar, body/accent colours, cheeks/freckles, scarf/bow/sparkle and music headphones. Canvas rendering uses the same companion drawing functions as the rest of Baymax. The project does not have the hypothetical SVG hat/eyewear system named in the feature request.

Call IDs resolve simultaneous dialing deterministically. Recent closed IDs suppress delayed ringing. Unanswered calls expire at 30 seconds; a missing heartbeat ends an established call after approximately 12–14 seconds. Normal application quit sends hangup before disconnecting the partner channel. Renderer crashes also release the native AI lock.

## Verification

`scripts/fourteen-smoke.ps1` exercises two actual local RTCPeerConnections with synthetic audio: RTP reception, meters, independent mute, appearance synchronization, simultaneous calls, timeouts, cancellation and cleanup. It also verifies full/compact UI persistence and the Focus overlay. `scripts/settings-smoke.ps1` exercises incoming-call events through the production preload and renderer. The synthetic media test does not establish physical microphone quality or connectivity between two PCs on different networks; use [COUPLE_TESTING.md](COUPLE_TESTING.md) for acceptance.

The current beta uses the owner's explicitly selected open Supabase testing project. Production authentication and protected pair signaling remain part of the [launch plan](LAUNCH_PLAN.md); no hosted service was provisioned by these desktop changes.
