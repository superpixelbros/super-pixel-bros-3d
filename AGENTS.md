# AGENTS.md — Working on Super Pixel Bros 3D

Guidance for AI coding agents (and humans) working in this repository.
Sibling of the 2D `Mario2d` project — read its `AGENTS.md` for the family
history; everything specific to 3D lives here.

## What this is

A Crash-Bandicoot-style 3D platformer with Stumble-Guys-style hazard chaos,
for the browser. Vanilla JS (ES modules) + three.js + Rapier physics.
**No build step, no bundler, no framework — and no asset files**: every
model is procedural geometry (boxes/cylinders/lathe), UI is DOM panels over
the 3D canvas. Same five heroes, same EN/AR bilingual layer, same "install
as PWA, works offline" promise as the 2D game.

## Bending the rules (agreed with Amjad, 2026-10)

The 2D project banned frameworks and binary assets. For the 3D sibling the
user explicitly relaxed both, within these limits:

- **Libraries allowed, vendored**: `vendor/three.module.js` +
  `vendor/three.core.js` (three r186, MIT — the `.core` file is a hard
  dependency of the module build in modern three) and `vendor/rapier.mjs`
  (rapier3d-compat 0.21, Apache-2.0 — self-contained, WASM embedded as
  base64, works in Node too). They are checked in and served like first-
  party code; re-vendor = update files + bump `VERSION` in `sw.js`.
  Keep runtime deps to these two — no React, no game engines, no npm at
  play time.
- **glTF/textures allowed but code-first**: heroes and course stay
  procedural; downloaded CC0 models/textures only when they clearly win —
  track provenance in a license manifest the day one is added. Never
  touch Nintendo/Crash/Sony IP — original characters and layouts only.

## Run / verify

```bash
python3 tools/serve.py 8001          # no-store dev server (copied from 2D)

for f in js/*.js sw.js; do node --input-type=module --check < "$f"; done
node tools/headless.mjs
```

`headless.mjs` is the seed of the test suite: i18n key parity, the Input
edge-trigger contract, full Rapier-physics runs (auto-run, jump arc, coins,
checkpoints, fall-respawn, finish), **per-hero × per-level full clears** —
every hero must CLEAR every level death-free via a bot that jumps inside
`course.jumpZones` — a rivals race check (autopilot must progress + finish),
and the adventure-map logic. Run it after ANY edit to `levels.js`,
`hero.js`, `game.js` or `rivals.js`.

## Architecture

| File | Responsibility |
|---|---|
| `js/main.js` | boot, state routing (`title/select/map/play/pause/clear/victory`), fixed 60 Hz loop, key routing, progress persistence, resize, SW registration (never on localhost) |
| `js/game.js` | the run + adventure flow: owns Rapier `World`, course, player, rivals; map cursor/walk logic; coin/checkpoint/respawn/finish/placement rules; `sfx()` no-op hook injected by main. **No DOM, no three** |
| `js/hero.js` | `CHARACTERS` stat table + `Player`: kinematic capsule + Rapier character controller, auto-run, coyote/buffer/jump-cut, spin, `jumped`/`landed` event flags. `HERO_RADIUS`/`HERO_HALF` are the size source of truth. **No three** |
| `js/levels.js` | level registry `LEVELS = [{id, nameKey, build, theme}]` + shared kit (ground/step/coin, hammer, pillar) + `courseStep()`. Sunny Shore + Sunset Ridge. **No three** |
| `js/rivals.js` | 3 autopiloted `Player` instances (custom stat defs, lanes, jitter, vault-if-blocked, checkpoint respawn); `placement()` for the HUD. Solid kinematic capsules — shoving works. Netcode seam: inputs → determinate sim. **No three** |
| `js/audio.js` | WebAudio synth: SFX (jump/land/spin/coin/checkpoint/fall/clear/trophy/menu) + one original chiptune loop per stage, ducked on pause; `pixelbros3d_mute`; unlock on first gesture |
| `js/phys.js` | Rapier init + world factory; `STEP = 1/60` |
| `js/renderer.js` | three.js scene: lights/shadows/fog/sea, per-level THEMES applied by `buildCourse`, course meshes, hero rig, rival meshes (`setRivals`), map diorama, follow/menu/map cameras |
| `js/models.js` | procedural hero builder (boxes), `style` variants cap/keffiyeh/fletch |
| `js/ui.js` | DOM screens (title/select/HUD+place/pause/clear/map/victory) with `data-key` re-render on language change |
| `js/i18n.js` | en/ar tables, `t()`, `L` toggle, `<html lang/dir>`; `pixelbros3d_lang` |
| `js/input.js` | keyboard + virtual keys, edge triggers, `endFrame()` — ported 1:1 from 2D |
| `js/view.js` | viewport metrics: dpr cap 2, portrait/coarse flags |
| `sw.js` | versioned precache incl. `vendor/` — bump `VERSION` on ANY change |
| `manifest.webmanifest` | standalone, landscape, relative scope |

**The import boundary is the architecture**: `game.js`, `hero.js`,
`levels.js`, `rivals.js`, `phys.js`, `i18n.js`, `input.js` must never import
three.js or touch the DOM (i18n/audio guard `document`/`localStorage`
behind `typeof`), so they run under plain Node for headless checks.
`renderer.js`/`models.js`/`ui.js`/`main.js`/`audio.js` are the browser edge.

## Rapier gotchas (0.21 — the docs online are mostly older)

- The high-level `CharacterController` is gone. Use
  `world.createCharacterController(offset)` → `KinematicCharacterController`
  and per-call `ctrl.computeColliderMovement(collider, delta)` +
  `computedMovement()` / `computedGrounded()`, then move the body yourself
  via `setNextKinematicTranslation`.
- `ColliderDesc` chainable setter is `setTranslation(x, y, z)` (the
  non-chained `translation(x,y,z)` variant does not exist) — a real bug
  this project already ate.
- Tick order: kinematic hazards `setNext*` → hero controller query →
  `world.step()`. Queries see the *previous* step's poses: one frame of
  lag against the hammer, acceptable and deterministic.
- Character controller does **not** carry the player on horizontally moving
  platforms. That's why the wide gap uses a *bobbing vertical* pillar —
  vertical support works positionally. Think vertically when adding
  platforming hazards, or add explicit carry logic.
- `rapier.mjs` runs under Node with `await RAPIER.init()` — that's how the
  headless tests run real physics.

## Three.js gotchas (r186)

- No minified module build anymore (`three.module.min.js` is gone); vendor
  `three.module.js` **and** `three.core.js` (it re-exports from the core
  file — dropping it breaks every import).
- `canvas.width/height` are driven by `renderer.setSize(w, h, false)` — CSS
  owns display size; re-call after resize with fresh `view.dpr`.
- Changing the shadow-camera frustum requires
  `light.shadow.camera.updateProjectionMatrix()`.
- The import map in `index.html` maps bare `three` → `./vendor/three.module.js`.
  Any `import ... from 'three'` only works through it — keep the specifier
  bare in game code, never deep-import vendor paths outside it.
- Per-frame render-path exceptions are the worst kind: they silently skip
  `render()` AND `Input.endFrame()`, so the screen freezes, key edges leak,
  and the console storm reads as "lag" (this bit the run animation on day
  one — `poseWalk` got the group instead of the `heroParts` bundle). Keep
  renderer code defensive and test it with the headless harness when the
  logic is pure.

## Game-design rules (the family physics)

- Fixed 60 Hz everywhere; per-tick, deterministic, testable.
- Auto-run along **+Z** (Crash-style); steering is one axis, jump is hold-
  for-height with a −0.45× release cut, coyote 6f, buffer 7f.
- **Design for the worst hero**: Faris (4.8 m/s) full-hold clears a bare gap
  of ≈4.3m (≈4m of usable margin), Sahm's low jump tops out ≈1.6m — bare
  gaps ≤ 3m, step-ups ≤ 0.7m, everything wider needs a crossing within
  reach. Headless enforces: **every hero × every level must fully clear,
  death-free**.
- **`jumpZones` are ground truth**: every z-range where a jump is required
  (gaps, pillar hops, step hops) must be listed in the level's
  `jumpZones.push(...)` — the reachability bot AND rival autopilots jump
  from them. If you add geometry, add the zone; if the headless roster test
  stalls at some z, you forgot or mistuned one. `narrows` ([z0, z1,
  maxLaneRadius]) tells rivals where the floor is thin (pillar crossings,
  ledge stretches) so their lanes converge — keep in sync too.
- **Crossing geometry**: make bobbing-pillar tops ≤ 0.9m so every hero (and
  rival) can land on them at any phase, and let pillar edges OVERLAP each
  other and the landing ground — seams between platforms are death traps
  for mid-speed heroes whose arc falls in them (this bit Shore's original
  pillar gap).
- **Steering sign**: the follow camera faces +Z, which flips world X
  relative to the screen — keyboard→game steering is negated in `main.js`.
  If controls ever feel mirrored again, that line is the first suspect.
- Course height budget: no fall deeper than the respawn kill plane (−12).
- Units: metres; hero capsule = `HERO_RADIUS` 0.315 + `HERO_HALF` 0.315
  (total 1.26m). Meshes build at 1.4m and the renderer scales `play:`/
  `map:` heroes (0.9× / 0.45×) so collider and mesh shrink together —
  feet offset derives from `HERO_HALF + HERO_RADIUS`, never hardcoded.
- **Adventure flow**: title → select → map (3D diorama, two islands, hero
  walks node-to-node, ◀ ▶ replay cleared stages) → run → clear → map →
  … → victory card. Frontier persists via `pixelbros3d_progress`.
- Controls: `L` language, `M` mute, `ESC` pause, `R` retry, `Q` title.
  Audio unlocks on first gesture; music ducks while paused.
- UI text goes through `t('key')` with entries in **both** en and ar
  tables; Arabic is real DOM so shaping/RTL are native — keep Latin key
  names (ENTER, WASD) inside translations; Western digits only.

## Decisions (don't re-litigate without Amjad)

- Genre blend: Crash-style linear auto-run course + Stumble-Guys hazards;
  AI rivals later (netcode seam: keep race-position logic out of input —
  a rival is just a scripted `Player`-like mover).
- three.js + Rapier over Babylon/Unity (control + footprint + references).
- Hybrid UI: live 3D stage, crisp DOM panels (Arabic/RTL/a11y stay free).
- One level ("Sunny Shore") → trophy; progression content comes as more
  levels, not more systems, until asked.
- Vendored libs + service-worker precache = offline PWA; SW never registers
  on localhost; `VERSION` bump per change, incl. `vendor/`.
- Commit/push only when the user asks.

## Roadmap (agreed order)

1. **M0 vertical slice** ✅: course, heroes, menus, i18n, headless checks.
2. Touch controls — **explicitly deferred** ("not for now"): virtual stick
   + jump/spin buttons feeding `Input.tap`, DOM hot-spot pattern from 2D.
3. Audio ✅: WebAudio synth SFX + per-stage chiptune, mute key, ducking.
4. AI rivals ✅: 3 autopiloted racers, solid contact, place HUD + finish
   place on the clear screen (netcode seam: flags in, determinate sim out).
5. Badges/relics: time trial tiers + all-coins challenge, shown on the
   clear screen; best times via localStorage.
6. Polish: particles, screen shake, death/hurt juice, PWA icons (extend
   `gen-icons.mjs` pattern), GitHub Pages deploy for the new
   `superpixelbros/super-pixel-bros-3d` repo (enabled — pending).
7. More levels (`LEVELS` entries + diorama nodes grow automatically).

## Ideas that fit

Spin-attack crate smashing, wall rails, checkpoints as totems, day→sunset
lighting per level, ghost replay of your best run (record `pos` per tick —
cheap and it's exactly the netcode seam), palm-top secret coins.
