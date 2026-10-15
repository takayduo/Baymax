# Original companion sounds

On 15 October 2026, all 28 inherited companion/UI WAV recordings were replaced with the **Puff Soft v1** pack. The owner confirmed the companion artwork is original; no artwork, animation timing or sound-event mapping was changed.

Open [the labelled listening preview](sounds-preview.html) in a browser. It plays each effect individually or all 28 in order, using the app's default 12% preview volume and 0–20% range. Keep this file alongside the repository's `public/sounds` folder. It also works when the repository is served over local HTTP. Escape or Stop ends the preview.

For a convenient local preview, run `node scripts/preview-sounds.cjs` and open the loopback URL it prints. That server exposes only these sound files and their preview/documentation, not the rest of the project. Ctrl+C closes it.

## How they are made

`scripts/generate-sounds.cjs` synthesizes the sounds from independently authored recipes in `scripts/sounds/recipes.cjs`. It uses sinusoidal oscillators, gently moving pitches, low-level harmonics, seeded filtered noise, smooth envelopes and conservative peak normalization. No downloaded recordings, original app samples, sampled voices, external synthesis libraries or copied melodies are inputs. The generator runs entirely offline using Node's built-in modules.

All WAVs are 48 kHz, mono, signed 16-bit PCM, between 80ms and 1.28s long. Peak levels stay below 0.5 full scale before the app's existing master volume. Effects remain distinct while sharing a warm, restrained sound palette.

`public/sounds/manifest.json` records descriptions, format, duration and SHA256 for every replacement. `scripts/sounds/replaced-hashes.json` records the old file hashes solely to verify replacement; it contains no recordings. Rerunning the generator reproduces the assets and manifest byte for byte in the tested Node environment. Tiny numerical differences on other runtimes/platforms must be reviewed rather than silently updating hashes.

The manifest documents newly synthesized provenance, not a blanket legal clearance or a guarantee of copyright eligibility. Existing third-party code notices remain applicable. The separate non-commercial license in `engine/LICENSE` is unchanged and is not resolved by replacing audio assets.

## Generate and verify

```powershell
node scripts/generate-sounds.cjs
node scripts/generate-sounds.cjs --check
node --test tests/sounds.cjs
npm run build
# Real Chromium decoding, playback/volume/mute and idle recovery:
node_modules/.bin/electron.cmd tests/sound-smoke.cjs
```

The generator also creates `audit/sound-preview/all-sounds.wav` and a timestamp cue sheet for convenient offline review. The preview page is generated from `scripts/sounds/preview-template.html`; edit the template rather than the generated HTML.

The audio smoke test uses synthetic app audio only, with the output device muted while WebAudio samples are measured. It does not record the microphone or access AI keys, partner calls, music libraries or accounts. Human listening on the intended speakers/headphones is still useful for subjective comfort.

15 October verification: both frontends built successfully with **59 regression/account/SQL/asset tests** passing. The Chromium/WebAudio smoke test passed **12 checks**, including decoding every WAV, real gain scaling, mute/re-enable, idle suspension/recovery and preview sequencing. Details are in `audit/original-sounds-build.log` and `audit/sound-smoke/result.json`.

## Distribution

Vite copies the replacement files into `dist/sounds` during the regular build. The existing Windows package configuration includes that output; package freshness checks verify the sounds again on the next installer build. No installer was rebuilt for this change. Existing installers still contain the old sounds and should not be represented as containing this replacement pack.
