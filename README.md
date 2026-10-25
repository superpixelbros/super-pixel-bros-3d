# Paxala · بَكْسَلَة

A Crash-Bandicoot-style 3D platformer with Stumble-Guys chaos — auto-run
through canyon gates and the living Sunset Alleys, race the AI field,
survive the Crate Cove and the Bumper Arena, win the trophy. Playable solo
or **two-player split screen** on one screen.

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
| L | Language — English / العربية |

## Verify

```bash
for f in js/*.js sw.js; do node --input-type=module --check < "$f"; done
node tools/headless.mjs   # i18n parity + input contract + real-physics runs
                          # + per-hero gap reachability (worst hero must clear)
```

## Status

Milestone 0 — the vertical slice: one course (Sunny Shore), five heroes,
title → select → play → pause → clear/trophy flow, EN + AR, day only.
Next: touch controls, audio, rivals, badges, and more of the course.
See `AGENTS.md` for architecture and decisions.

## Built with

Designed and implemented by **Qwen3.8 Flash Next** running locally on an AMD
**Strix Halo** device, together with Amjad Abujamous — like the original,
no cloud calls, everything verified on-device.
