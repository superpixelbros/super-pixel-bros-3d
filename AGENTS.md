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
edge-trigger contract, then full Rapier-physics runs — auto-run, jump arc,
coins, checkpoints, fall-respawn, finish — and per-hero reachability
(every hero must clear the first gap + both steps under its own jump
envelope). Extend it with every course/hero-stat change, like the 2D
project's `check-reachability.mjs`.

## Architecture

| File | Responsibility |
|---|---|
| `js/main.js` | boot, state machine (`title/select/play/pause/clear`), fixed 60 Hz loop, key routing, resize, SW registration (never on localhost) |
| `js/game.js` | the run: owns Rapier `World`, course, player; `start()` rebuilds everything per run; coin/checkpoint/respawn/finish rules. **No DOM, no three** |
| `js/hero.js` | `CHARACTERS` stat table + `Player`: kinematic capsule + Rapier character controller, auto-run, coyote/buffer/jump-cut, spin. **No three** |
| `js/course.js` | "Sunny Shore": static ground/steps, kinematic hammer + bobbing pillar, coin/checkpoint/decor data. **No three** |
| `js/phys.js` | Rapier init + world factory; `STEP = 1/60` |
| `js/renderer.js` | three.js scene: lights/shadows/fog/sea, course meshes rebuilt per run, hero rig, follow/menu cameras |
| `js/models.js` | procedural hero builder (boxes), `style` variants cap/keffiyeh/fletch |
| `js/ui.js` | DOM screens (title/select/HUD/pause/clear) with `data-key` re-render on language change |
| `js/i18n.js` | en/ar tables, `t()`, `L` toggle, `<html lang/dir>`; `pixelbros3d_lang` |
| `js/input.js` | keyboard + virtual keys, edge triggers, `endFrame()` — ported 1:1 from 2D |
| `js/view.js` | viewport metrics: dpr cap 2, portrait/coarse flags |
| `sw.js` | versioned precache incl. `vendor/` — bump `VERSION` on ANY change |
| `manifest.webmanifest` | standalone, landscape, relative scope |

**The import boundary is the architecture**: `game.js`, `hero.js`,
`course.js`, `phys.js`, `i18n.js`, `input.js` must never import three.js or
touch the DOM (i18n guards `document`/`localStorage` behind `typeof`), so
they run under plain Node for headless checks. `renderer.js`/`models.js`/
`ui.js`/`main.js` are the browser-only edge.

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
- **Design for the worst hero**: Faris (4.8 m/s) clears a bare gap of ≈3.4m
  at full hold, Sahm's low jump tops out ≈1.6m — bare gaps ≤ 3m, step-ups
  ≤ 0.7m, everything wider needs a bridge within reach (see course rules in
  `course.js`). Headless roster test enforces it.
- **Steering sign**: the follow camera faces +Z, which flips world X
  relative to the screen — keyboard→game steering is negated in `main.js`.
  If controls ever feel mirrored again, that line is the first suspect.
- Course height budget: no fall deeper than the respawn kill plane (−12).
- Units: metres; hero capsule = 0.35 radius + 0.35 half-height (1.4m tall),
  mesh origin at the feet, capsule center is `pos` (mesh at `pos.y − 0.7`).
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

1. **M0 vertical slice** ✅ this repo today: course, heroes, menus, i18n,
   headless checks.
2. Touch controls: virtual stick + jump/spin buttons feeding `Input.tap`,
   canvas hot spots on menu panels (port the 2D hot-spot pattern to DOM).
3. Audio: WebAudio synth SFX + music (port the 2D `audio.js` DNA).
4. AI rivals racing you + place HUD (the netcode seam).
5. Badges/relics: time trial tiers + all-coins challenge, shown on the
   clear screen; best times via localStorage.
6. Polish: particles, screen shake, death/hurt juice, PWA icons (extend
   `gen-icons.mjs` pattern), GitHub Pages deploy for the new
   `superpixelbros/super-pixel-bros-3d` repo (enabled — pending).
7. More levels.

## Ideas that fit

Spin-attack crate smashing, wall rails, checkpoints as totems, day→sunset
lighting per level, ghost replay of your best run (record `pos` per tick —
cheap and it's exactly the netcode seam), palm-top secret coins.
