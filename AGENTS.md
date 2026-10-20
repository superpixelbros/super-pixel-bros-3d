# AGENTS.md — Working on Super Pixel Bros 3D

Guidance for AI coding agents (and humans) working in this repository.
Sibling of the 2D `Mario2d` project — read its `AGENTS.md` for the family
history; everything specific to 3D lives here.

## What this is

A Crash-Bandicoot-style 3D platformer with Stumble-Guys-style hazard chaos,
for the browser. Vanilla JS (ES modules) + three.js + Rapier physics.
**No build step, no bundler, no framework — and no asset files**: every
model is procedural geometry (boxes/cylinders/lathe), UI is DOM panels over
the 3D canvas. Same heroes (now nine), same EN/AR bilingual layer, same
"install as PWA, works offline" promise as the 2D game.

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
`course.jumpZones` (bots run with `game.hazardsOff` + `game.gatesOff`:
they prove platforming GEOMETRY and pace, not hazard timing or race
results), a roster fair band
(slowest ≤ 1.40× fastest clear time), scenery solidity, the damage model
(`hurt()` hearts/invuln/knockback + live pendulum hit + crumble→fall→
respawn), time-limit calibration (limit ≥ 1.6× slowest bot) + DQ + retry
reset, a rivals race check (autopilot must progress + finish; a second race
runs LIVE on Ridge so the canyon gates, portcullis queue and Needle are
stress-tested against soft-locks), **placement-gate outcomes** (forced
finishing places: shore 4th → LOST, 3rd → clear; ridge must win), the
**survival arena** (free-control movement, monotonic ring, wave escalation,
out-of-ring → over, 90s → win), and the adventure-map logic (incl.
fresh-run cursor = stage 1, unlocks kept, always-open arena node). Run it
after ANY edit to `levels.js`, `hero.js`, `game.js` or `rivals.js`.

## Architecture

| File | Responsibility |
|---|---|
| `js/main.js` | boot, state routing (`title/select/map/play/pause/clear/dq/lost/over/win/victory`), fixed 60 Hz loop, key routing (incl. the survival throttle axis), progress + arena-best persistence, resize, SW registration (never on localhost) |
| `js/game.js` | the run + adventure flow: owns Rapier `World`, course, player, rivals; map cursor/walk logic (gated stages + the always-open arena node); coin/checkpoint/respawn/finish/placement rules; time-limit DQ (`state === 'dq'`, tick sfx) and placement gates (`passPlace` → `state === 'lost'`); applies hazards/wind/bounce to the hero (and crumble removal); **survival mode** (`stepSurvival`: `arenaStep` waves, shrinking ring, knockback-only hits, `over`/`win` endings); `hazardsOff`/`gatesOff` flags for geometry-only bots; `sfx()` no-op hook injected by main. **No DOM, no three** |
| `js/hero.js` | `CHARACTERS` stat table + `Player`: kinematic capsule + Rapier character controller, auto-run, coyote/buffer/jump-cut, spin, `jumped`/`landed` event flags, damage model (`hurt()` → hearts, `stun` lockout, knockback, 1.2s invuln, `dead` at 0; `respawn()` = full heal + 0.5s grace; falls are always instant deaths). **`free = true` switches to two-axis control** (flags.z drives forward/back, friction brakes both axes — the survival arena; race paths never set it). `speed`/`jump`/`hp`/`steer`/`airCtrl`/`floaty` define each hero. `HERO_RADIUS`/`HERO_HALF` are the size source of truth. **No three** |
| `js/levels.js` | level registry `LEVELS = [{id, nameKey, build, theme, timeLimit, passPlace, mode?}]` + shared kit: ground/step/coin/**decor** (solid trunks & rocks, always ≥1m off-lane)/**wall** (real blocking collider — chicanes, gate frames); hazards: hammer (physical turnstile, `len` scales reach), pendulum/roller/piston (**knockback sensors — no collider**; rollers sweep x or z via `ax`), gates (**portcullis**: kinematic collider that slams/lifts on a cycle), crumble (fixed slab removed on give-way), bounce pad + wind zones (pure zones); `courseStep()` animates everything, `hazardTouch()` returns a knock vector, `windAt()` lateral push. Sunny Shore (gentle) → Sunset Ridge v2 (**canyon weave** of alternating walls, **portcullis** queue-gate, **the Needle** single-file throat + double pendulum, piston, crosswind ledge, crumble crossing, pillars) → **Bumper Arena** (`mode:'survival'`: disc floor, `ARENA` constants, `arenaStep()` with wave-gated hazards + ramping tempo + own phase accumulators). **No three** |
| `js/rivals.js` | 3 autopiloted `Player` instances (speed = chosen hero's speed × {1.10, 0.98, 0.87} + their own jump copy, lanes, jitter, vault-if-blocked, checkpoint respawn); `placement()` for the HUD. Solid kinematic capsules — shoving works; they eat hazard knockback too (hp 99 = stumble, never die). Netcode seam: inputs → determinate sim. **No three** |
| `js/audio.js` | WebAudio synth: SFX (jump/land/spin/coin/checkpoint/fall/clear/trophy/menu/hit/die/bounce/tick/gameover) + one original chiptune loop per stage, ducked on pause; `pixelbros3d_mute`; unlock on first gesture |
| `js/phys.js` | Rapier init + world factory; `STEP = 1/60` |
| `js/renderer.js` | three.js scene: lights/shadows/fog/sea, per-level THEMES applied by `buildCourse`, course meshes incl. walls/portcullis gates/arena disc + closing ring (parked hazards stay hidden), hero rig, rival meshes (`setRivals`), map diorama (grows with `LEVELS`, arena island gets a ring stage), follow/menu/map/tower cameras — all run-world states keep the hero posed + camera live (terminal cards never freeze the scene) |
| `js/models.js` | procedural hero builder (boxes), `style` variants cap/keffiyeh/fletch |
| `js/ui.js` | DOM screens (title/select/HUD+place+hearts+countdown / survival HUD (wave + survive-countdown)/pause/clear/**dq**/**lost**/**over**/**win**/map/victory) with `data-key` re-render on language change; timer turns gold <25% and pulses red <10% of the limit; 1st place makes the clear trophy glow gold |
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
- **Kinematic-seam freeze (real bug this project ate):** the character
  controller will NOT walk across a flush seam from a *fixed* collider
  onto a *kinematic* one at the same height — small moves compute to zero
  movement and the hero grinds to a halt (only a shove of ~0.5 m frees
  it). Fixed→fixed seams are fine, and jumping *onto* a kinematic top is
  fine — it's walking across the seam edge-on that dies. So: any walkable
  surface that must share a seam with the ground (crumble slabs!) is
  `RigidBodyDesc.fixed()` — remove the body when it gives way (safe
  between `world.step()` calls) and animate the mesh separately.
- Knockback hazards (pendulum/roller/piston) are **sensors by design**:
  no collider, damage+knock via `hazardTouch()` per frame — Stumble-Guys
  style shoves. Solid colliders on sweep hazards would wall the auto-run
  path and the reachability bot; only the hammer turnstile keeps a real
  collider (it sweeps, so there is always a gap to run through).
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
- **Design for the worst hero**: Faris (6.6 m/s, jump 10.2) full-holds a
  bare gap of ≈5m (keep ≤3m anyway for margin), Sahm's low jump (8.6)
  tops out ≈1.6m — step-ups ≤ 0.7m, everything wider needs a crossing
  within reach. Headless enforces: **every hero × every level must fully
  clear, death-free** (bots run `hazardsOff` — geometry & pace only).
- **Balance law (headless-enforced)**: clear-time spread across the whole
  roster per level ≤ **1.40×** (speeds live at 6.6–8.4 m/s — bold but
  bounded; every distinction has a cost: Bolt understeers in air, Sahm
  has brake-slip + 1 heart, Faris trades speed for 3 hearts + sharp
  cuts). Race fairness comes from RIVALS SCALING to your pick
  (`speedMul` ratios), not from identical stats.
- **Ways to lose**: four terminal run states — **time limit** (out of
  time → `dq` → DISQUALIFIED card), **placement gate** (`lost` card):
  every race `LEVELS` entry has `passPlace`, the worst place that still
  advances — Shore top-3 of 4, Ridge **must win**. Finish worse →
  `state='lost'`, card shows place + the broken rule, ENTER retries the
  stage (clock+hearts reset), Q main menu; the frontier only advances
  through gates, so the trophy is truly a 1st-place trophy. Falls stay
  time punishments. Bots skip both race rules via
  `game.gatesOff` (+ `hazardsOff`) — geometry tests ≠ race tests.
  Limits stay generous: headless asserts `timeLimit ≥ 1.6× slowest bot
  clear` (Shore 45s, Ridge 90s). Survival mode ends differently:
  **`over`** (the ring swallows you — splash card with survive-time +
  best) and **`win`** (90s alive — LAST STANDING card).
- **Hazard placement law**: hazards must always have a safe moment (they
  oscillate) and never require stopping inside a hazard; place knockback
  hazards on wide ground/shoulders, never where a hit drops you into an
  unavoidable death loop; keep ≥2m buffer after mandatory landings;
  crosswind force ≤ ~2.5 so lean-in works; a crumble crossing must be
  crossable at a run (give-way ≈0.6s) and the nearest checkpoint must sit
  *before* it. Telegraph visually — swinging rope, cracked slab, steel
  block.
- **`jumpZones` are ground truth**: every z-range where a jump is required
  (gaps, pillar hops, step hops) must be listed in the level's
  `jumpZones.push(...)` — the reachability bot AND rival autopilots jump
  from them. If you add geometry, add the zone; if the headless roster test
  stalls at some z, you forgot or mistuned one. `narrows` ([z0, z1,
  maxLaneRadius, centerX=0]) tells rivals where the floor is thin (pillar
  crossings, ledge stretches) — and `centerX` makes them a GATE: rivals
  steer into the gap center, so every wall-chicane or slit MUST carry one
  (the headless bot follows the same rule). **Lead trap (real bug this
  project ate):** a gated narrow's `z0` must start ~1.2m BEFORE the wall,
  or a rival resting against the wall face (capsule radius 0.315 short of
  it) sits outside the window and its lane target happily parks it there
  forever — soft-lock, zero steering, endless queue.
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
- **Adventure flow**: title → select → map (3D diorama, three islands —
  two race stages + the arena — hero walks node-to-node, ◀ ▶ replay
  cleared stages) → run → clear → map → … → victory card. Frontier
  persists via `pixelbros3d_progress` (unlocks survive a quit) but **a
  fresh run always opens the map on stage 1** (`enterMap(true)` from the
  select screen) — the player then roams freely up to the frontier.
- **Survival mode (`mode:'survival'` level, Bumper Arena)**: a pub
  challenge, NOT an adventure stop — `mapMove` lets the cursor skim past
  locked stages to reach it but never park on locked stages; clearing it
  never advances the frontier and `isLastStage()` only counts race
  levels. Free control (`player.free`): WASD/arrows drive both axes
  (Space is the only jump there — W/↑ belong to the throttle), no
  auto-run, no rivals, no hearts — hazard hits are pure knockback with
  30f mercy, the shrinking ring (`ARENA.ringR`, 10.6m→4.6m over 90s) is
  the kill plane, and waves every 15s un-park hazards that wait below
  the stage (y=−40, `active=false` — `hazardTouch` skips parked ones).
  `arenaStep` keeps per-hazard phase accumulators so the tempo ramp
  (→1.8×) never jumps a sine. Endings: `over` (splash) / `win` (90s =
  LAST STANDING); best time in `pixelbros3d_arena_best` (90 = full win),
  shown on the arena's map node. The arena camera is a fixed wide tower
  shot — fixed yaw keeps WASD screen-true.
- **Roster (9 heroes)**: the originals plus Dolar (7.4/10.6/2♥, silver
  hustler), Hero (7.0/11.2/2♥, indigo everyman), Scoozy (8.3/9.4/1♥,
  magenta, low-friction "on wheels") and Glorious (6.9/10.8/3♥, gold
  tank with the `crown` style). Adding a hero = one `CHARACTERS` entry
  + name/blurb in **both** i18n tables — select carousel, stat bars,
  rival speed-scaling and diorama colors all pick it up; keep the stat
  inside the fairness envelope (speed 6.6–8.4, jump 8.6–12.6, hp 1–3)
  or the fair-band test will say so.
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
- One hero, one course flow per run; progression = more levels in the
  `LEVELS` registry (now Shore + Ridge + the survival arena), not more
  systems, until asked.
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
5. **Fairness, Consequences, Chaos wave** ✅: solid scenery, hero rebalance
   (6.6–8.4 m/s spread + fair band), hearts + knockback + stun, hazard kit
   (pendulum/roller/piston/crumble/bounce/wind + hammer damage), rivals eat
   hazards too, per-stage time limit → DISQUALIFIED card with countdown
   HUD (gold <25%, red pulse <10% + tick), gold trophy glow for 1st,
   hazardified Ridge.
6. **Canyons, Gates & Bumper Rooms wave** ✅: Ridge v2 (canyon weave of
   alternating walls, portcullis queue-gate, the Needle single-file throat
   + double pendulum), placement gates everywhere (`passPlace`), the
   survival **Bumper Arena** (3rd map node, always open: free control,
   closing ring, 6 escalating waves, `over`/`win` endings, best time
   persisted), rivals stress-tested live on the new gauntlet.
7. Badges/relics: time trial tiers + all-coins challenge, shown on the
   clear screen; best times via localStorage.
8. Polish: particles, screen shake, death/hurt juice, PWA icons (extend
   `gen-icons.mjs` pattern), GitHub Pages deploy for the new
   `superpixelbros/super-pixel-bros-3d` repo (enabled — pending).
9. More levels (`LEVELS` entries + diorama nodes grow automatically) —
   stage 3 sketch: "Storm Foundry" (pistons + conveyors + boulder chase).

## Ideas that fit

Spin-attack crate smashing, wall rails, checkpoints as totems, day→sunset
lighting per level, ghost replay of your best run (record `pos` per tick —
cheap and it's exactly the netcode seam), palm-top secret coins.
