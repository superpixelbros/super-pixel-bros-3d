# Paxala · بَكْسَلَة

A Crash-Bandicoot-style 3D platformer with Stumble-Guys chaos — auto-run
through canyon gates and the living Sunset Alleys, race the AI field,
survive the Crate Cove, out-last the Bumper Arena and devour the Ghost
Maze, win the trophy. Playable solo or **two-player split screen** on one
screen.

Vanilla JavaScript (ES modules) + [three.js](https://threejs.org) for
rendering + [Rapier](https://rapier.rs) for physics, loaded from `vendor/`
(checked in, MIT/Apache). **No build step, no bundler, no asset files** —
every model is boxes-and-cylinders assembled in code, UI is crisp DOM panels
over the live 3D scene. Same family rules as the 2D game.

**Repo:** <https://github.com/superpixelbros/super-pixel-bros-3d>

## Run it

```bash
cd Mario3d
python3 tools/serve.py 8001     # no-store dev server (same tool as 2D)
```

open <http://localhost:8001>. First load takes a moment: Rapier's WASM is
~4MB and still unminified — shipping tweaks are on the roadmap.

## Controls

| Key | Action |
|---|---|
| ← → / A D | Steer (the hero auto-runs forward, Crash-style) |
| Space / ↑ / W | Jump — hold for height, tap for a hop |
| ↓ / S / Shift | Spin-attack |
| Enter | Confirm |
| Esc | Pause / resume |
| R | Retry • Q (paused) → title |
| C (hold) | Ghost Maze — pull out to the whole-board view |
| L | Language — English / العربية |

## Verify

```bash
for f in js/*.js sw.js; do node --input-type=module --check < "$f"; done
node tools/headless.mjs   # i18n parity + input contract + real-physics runs
                          # + per-hero gap reachability (worst hero must clear)
```

## Status

Five stages on the adventure map: **Daybreak Ridge** and **Sunset Alleys**
(auto-run races), **Crate Cove** (last one dry), plus two always-open
challenges beside the frontier — the **Bumper Arena** (survive 60s) and the
**Ghost Maze** (eat every dot while four spirits hunt you; power orbs flip
the food chain). Ten heroes, local split-screen 2P, punch/carry/throw, EN +
AR full translation, procedural everything. See `AGENTS.md` for architecture
and decisions.

## Built with

Designed and implemented by **Qwen3.8 Flash Next** running locally on an AMD
**Strix Halo** device, together with Amjad Abujamous — like the original,
no cloud calls, everything verified on-device.
