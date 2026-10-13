# Companion replacement and Avatar Lab review

Reviewed 10 October 2026. Reference: [smontlouis/bible-strong-avatar-lab](https://github.com/smontlouis/bible-strong-avatar-lab/tree/79fe9ba06e4874b11394b8e8a3f2c493c9d197ba), commit `79fe9ba06e4874b11394b8e8a3f2c493c9d197ba`.

## Can it replace Baymax's character?

Yes, with an integration layer. The repository does more than expressions: it has expression timelines, hold/transition durations, looping, play-once and ping-pong modes, blinking and ambient movement. Its framework-free SVG runtime can run inside Electron. It does not contain Baymax's file suction, chewing choreography, floating three-dot thought bubble, greeting layout, task-state wiring or Windows integration. Those effects would still have to be connected or implemented separately.

Baymax already owns that behaviour in its canvas animation engines. Replacing those engines with the upstream runtime would create extra work and risk changing the compact interaction style. This change therefore keeps Baymax's existing behaviour and supplies an original catalog and renderer. No upstream character, generated engine, source code or runtime dependency was copied into the shipped application.

## Scope of the repository scan

The read-only reference checkout is in `audit/avatar-lab-reference`, excluded from Git and release packaging. A full tracked-file inventory and automated text scan covers **181 files: 176 text files, 45,628 text lines, and five binary images**. The [manifest](../audit/avatar-lab-manifest.json) records each file's path, byte size, SHA-256 and scan counts. This includes hidden repository metadata files, the lockfile and generated code. It is a static integration review, not a vulnerability certification or an upstream test run.

| Area | What was checked | Implication for Baymax |
| --- | --- | --- |
| Studio, avatar geometry, rendering and animation | 92 files under `src/`; document model, geometry/body surfaces, expression/animation data, playback, render/export interfaces, persistence and test coverage | An authoring tool with real animation, but a different body/rendering model from Baymax |
| Runtime packages | 36 files under `packages/`, including core, React and DOM runtime | `avatar-web` can work without React; embedding the entire Studio is unnecessary |
| Export and examples | 13 example files plus exporter and generated-engine paths | Runtime `.avatar.json` is distinct from a Studio project backup; exported data is not itself a self-contained animation player |
| Documents and build | README, context, six documents, package manifests, scripts, lockfile and workflow files | Pre-release formats, Node 22.12+ and pnpm 10.34; a package integration would need version pinning and migration planning |
| Public assets and legacy | Nine public files, two standalone legacy prototypes | These are reference artwork/prototypes, not Baymax-ready replacement animation packs |

Specific findings:

- The runtime schema is version 1 and includes explicit body, colors, expression and animation collections. The Studio stores a version 2 document and uses copy-on-write behaviour libraries. Baymax settings should not be mixed with these formats without an importer.
- The parser limits runtime definitions to 256 KiB, restricts nesting, rejects duplicate JSON members and validates definitions. This is useful defensive work, but does not validate arbitrary Baymax extension code.
- The web renderer uses SVG, `requestAnimationFrame`, a playback controller and reduced-motion detection. Baymax uses Canvas 2D in three separate rendering paths; this difference explains why a direct asset swap would be incomplete.
- No eating, chewing, suction, mouth or thought-bubble implementation was found in the full tracked text scan. The runtime paints body parts and eyes. A semantic `thinking` expression is different from Baymax's floating three-dot status indicator.
- The Studio stores projects in localStorage and generates exports locally. It supplies no Baymax account, partner synchronization or paid-avatar backend. Vercel Analytics and Speed Insights are in the Studio entry point, not required for Baymax's implementation.
- The root and all three runtime package manifests declare **AGPL-3.0-only**. See the upstream [license](https://github.com/smontlouis/bible-strong-avatar-lab/blob/79fe9ba06e4874b11394b8e8a3f2c493c9d197ba/LICENSE) and [README license section](https://github.com/smontlouis/bible-strong-avatar-lab/tree/79fe9ba06e4874b11394b8e8a3f2c493c9d197ba#license). This is not a permissively licensed drop-in dependency. Commercial use is not inherently prohibited, but distributing a derivative/runtime integration can carry source-sharing obligations. Using independently authored Baymax artwork and renderer avoids adding that runtime dependency; this does not certify the licensing of every pre-existing Baymax asset.

## What is implemented in Baymax

**Settings → All settings → Companion → Wardrobe** offers twenty original companions, with the ten minimalist designs first:

| Companion | Character |
| --- | --- |
| Puff (default) | Smooth sphere |
| Pebble | Rounded cushion |
| Mallow | Marshmallow pill |
| Drop | Plump droplet |
| Tama | Cozy egg |
| Neko | Minimal cat |
| Kuma | Minimal bear |
| Usagi | Minimal bunny |
| Kumo | Puffy cloud |
| Hoshi | Rounded cushion star |
| Sprout | Garden sprite |
| Fenn | Twilight fox |
| Miso | Cloud lynx |
| Nori | Lagoon axolotl |
| Pip | Pebble penguin |
| Luma | Moon moth |
| Ember | Hearth wisp |
| Atlas | Pocket crystal |
| Orbit | Starlight traveller |
| Tide | Sky manta |

The first ten use one smooth silhouette, no face patch or inner lines, and plain markings by default. All bodies use soft radial highlights and bottom shading. Custom dark colours switch the eyes to a light ink so expressions remain visible. The original ten retain their accent details. Customize opens an inline editor with a live portrait preview, body/accent colour pickers, six quick swatches including pink, three accessories (scarf, bow, star pins), and plain/cheek/freckle details. **Save & use** persists the selection. Cancel leaves the active companion unchanged; reset restores that character's defaults in the draft. Styles are remembered separately for each character. Failed saves preserve the draft and leave the active character unchanged.

The same selection and colours drive the main companion, integration mini avatars, launch greeting, file upload/eating scene, Productivity branding, notification/native window/tray icons and the optional Qt voice HUD. The three-dot thinking bubble floats gently; existing blink, gaze, wave, sleep, emotional reactions and activity-state transitions remain connected. Cursor yaw and pitch shift and tilt the whole desktop body; lighting, cheeks and accessories follow with softer parallax. Idle state breathes and floats continuously. Pixel-centroid tests verify that the silhouette itself moves, and rendered frames verify changing light and idle motion. The file clipping target now shares its mouth geometry with the renderer. The HUD retains gaze and speaking-mouth input and reloads wardrobe preferences without restarting voice.

The old white body constructors, bundled icon artwork, human HUD mesh renderer and its mesh assets have been replaced or removed from the working application. Requested project backups and Git history are preserved. Static installer/desktop shortcut artwork uses the new default Puff; running app icons follow the user's selection. Windows controls its own shortcut icon cache.

Implementation map:

- `public/companions/catalog.json` and `accessories.json`: shared original vector definitions, bundled for Electron and Python.
- `src/companion/`: preference normalization, canvas renderer, native icon export and shared mouth geometry.
- `src/settings/wardrobe.ts`: compact selector and draft-based customization.
- `src/mochi/engine.ts`, `greeting.ts`, `minibots.ts`, `src/upload/canvas.ts`: existing animation paths connected to the shared appearance.
- `engine/core/avatar.py`: matching Qt SVG portrait with animated eyes, voice mouth and thought dots.
- `electron/companion.js` and main-process handlers: validated preferences and bounded PNG icon updates.

## Verification and boundaries

The dedicated renderer check covers twenty unique portraits, all **220 avatar/activity combinations**, twenty mini avatars, twenty greetings and **120 upload frames**, with a check that the animated thinking dots appear and change between frames. Production UI tests cover selection, per-character customization, retained drafts, save failure/retry and the prior compact Home/Chat/PC layouts. Python tests exercise all twenty HUD silhouettes, live preference refresh, malformed values and speaking-only mouth movement. The final release status records packaging and executable validation separately.

This wardrobe is local to the PC. It does not add paid avatar purchases, cloud wardrobe sync, Avatar Lab JSON imports or a full animation editor. Live AI services, microphone hardware and partner/cloud behaviour still require their existing account and device tests. Automated software rendering does not replace acceptance testing on the user's display/GPU.

Preview: [all twenty companions](../audit/wardrobe-gallery.png). Release and installer details: [release status](../RELEASE_STATUS.md).
