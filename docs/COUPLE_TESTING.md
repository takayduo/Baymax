# Two-PC testing checklist

Use this before the public launch plan. For a failure, note the PC, exact action, expected result and actual result; include a screenshot if useful. Keep API and database keys out of screenshots.

## Install and connect

1. Quit the previous Baymax/Mochi instance from its tray on both PCs. Install the new `Baymax-Setup-1.0.1-x64.exe` on Windows x64. This private test build is unsigned; existing user data is retained.
2. Set names and opposite **Me / Her** roles in Settings → Partner. Keep these roles consistent across restarts.
3. In Settings → Database & sync, use the same Supabase **Project URL, anon public key and pair channel** on both PCs. No account email/password is needed.
4. Copy **1-Click SQL Setup**, run it once in that project's SQL Editor, and enable Realtime public access in the dashboard. Save & Connect on both PCs. Verify green **Connected to live partner channel** and ready message/task storage.
5. This is the open project mode you selected: anyone with the URL/key can access the data. Use a dedicated testing project. This code update did not change a hosted database automatically.

## Companion and voice

- Change companions, colours and accessories. Move the cursor left/right/up/down: headphones and decorations should follow the face.
- Click three times quickly. Spirals spin for about 3.4 seconds, then restore normal eyes.
- Leave Unprompted AI Check-ins OFF: no unsolicited talking. Enter interests, optionally test check-ins ON, then turn them OFF again.
- With push-to-talk OFF, ask a question and expect one response/voice. Click mid-answer: it should stay stopped until your next prompt.
- Enable PTT, choose a key, speak while holding it and release once: expect one response. Change/cancel the picker, leave Settings, then disable PTT and verify continuous input returns.
- In Settings → AI, preview several Live voices using their individual Play buttons. Preview must not select a voice, and only one sample plays at once. Select a different voice while Gemini is running; the session reconnects with that voice without relaunching Baymax. Repeat in both directions.

## Partner chat and voice calls

- Send one message each way, then reconnect/restart. Expect one bubble and at most one notification per new message. Reopening history must not repeat notifications; desktop toasts appear only when Baymax is collapsed.
- Copy the SQL setup from Settings on each PC. It should reach the clipboard on the first click.
- Call from A while B is collapsed. B should wake to the incoming call card and ring. Test Decline, Cancel, and leaving it unanswered for 30 seconds before accepting a fresh call.
- On a connected call, confirm each tile shows that person's selected companion, colour and accessories. Speak alternately: only the speaking tile should glow/bob. Change wardrobe during the call and verify the other PC updates.
- Mute the call microphone, toggle the top-bar AI microphone, and speak. The call must remain muted and AI must not respond. Unmute using the call button. End the call and verify the normal AI microphone setting returns.
- Click Chat to shrink the call into the header, send messages, and click the compact header to expand it. Leave Baymax idle while working in another app; the call must continue after collapse. Hover to reopen directly into the retained call view.
- Click Call simultaneously on both PCs. Expect one connection, not duplicate ringing or audio. Quit one app normally: the other call should end promptly. Repeat by disconnecting the network; allow about 12–14 seconds for heartbeat detection.
- Test on the two networks you intend to use. No TURN relay is configured; some NAT/firewall combinations cannot connect directly. Check real microphone clarity, noise gate sensitivity, echo and output device on both PCs.

## Shared music

- Select **Our playlist** on both PCs. Add different songs from each, reorder one and remove another. Both lists should converge. Restart and verify the songs and added-by role remain saved.
- Take one PC offline, edit on both independently, reconnect both: additions merge, removed songs stay removed, and ordering converges.
- Play directly from Home and verify sequential advancement. Initial bob stops within two seconds, headphones stay until pause. The Wardrobe toggle hides headphones during playback.
- In Music, Repeat is beside Next. Test Off at the last song, Playlist wrapping to the first song, and Song replaying the current song. Manual Next should still advance. Restart to check that the repeat preference remains saved.
- Start a song while another search is in progress. It should queue extraction and play, with automatic retries for transient loading failures. A persistent error should appear rather than spin forever.
- During final packaging validation, YouTube search worked but stream resolution hit HTTP 429 / a bot sign-in challenge on the build network. Confirm playback on your intended networks; a provider restriction is not fixed by repeatedly changing tracks. No account cookies were used or included in the installer.
- Play on PC A and Join from PC B's song badge. Try Play/Pause, Previous/Next, Seek and picking a track from both sides. Add/reorder/remove songs while joined.
- Leave from each side in separate runs, then disconnect a PC mid-song. Local playback should continue. Repeat on different networks if possible; record persistent audible delay. Networks requiring TURN cannot join in this build.
- Quit Baymax normally on one PC during Listen Together. The remaining PC should clear the shared-session label and partner song badge while its music continues locally.

## AI and partner features

Try with Gemini Live, then Groq text/voice, using your own keys:

- “Play Die With A Smile”, “Pause music”, “Next song”, “Set music volume to 30 percent”.
- “Add this song to our playlist”, “Join my partner's music” while the partner is playing.
- “Add a test task for her”, “List her tasks”, “Complete [exact title] for her”, “Delete [exact title] for her”.
- “Send my partner: testing Baymax together”, “Read recent partner messages”.
- “Start a five-minute Pomodoro”, then “Stop focus”. Avoid blocking an app needed for the test.
- “Open music/tasks/partner chat/file share/productivity/settings”, “Look dizzy”, “Celebrate”.

Verify messages/tasks arrive after the other PC reconnects. Remote access must still ask the receiving person to accept; declining must never start capture.

Tasks should have no floating companion over the rows. Music should keep its companion at the left of the player card. For Focus, reopen a blocked test app twice within 30 seconds: the four-second warning must clear after closure, and Dismiss or stopping Focus must also clear it.

The existing PC tab is retained for private beta testing only; PC control is outside the planned public launch. If testing it, the remote viewer has no top toolbar, uses a transparent local cursor while controlling, and supports F11. End access from the PC tab or viewer window close.

Live AI accounts, physical audio, WAN sync and clean-machine install/update/uninstall are acceptance tests. Automated checks do not replace them. Launch identity, cloud entitlements and payments remain a later phase.
