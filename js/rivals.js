// AI rivals: real Player instances on the same physics world, driven by a
// pure-logic autopilot (no three.js — headless can race them). Each rival
// is a solid kinematic capsule, so shoving each other is emergent chaos,
// exactly like the intended Stumble-Guys feel. The autopilot jumps in the
// same course.jumpZones the reachability bot uses, with per-rival jitter;
// netcode seam: all state is (inputs → determinate sim), so feeding
// recorded flag streams could replay a race later.

import { Player, CHARACTERS } from './hero.js';
import { windAt, hazardTouch, CRATES } from './levels.js';

// Rival speed is a RATIO of the player's chosen hero (plus their own jump
// copy) — every race is close no matter who you pick; personality comes
// from lane, wander and jump-timing offsets.
export const RIVAL_DEFS = [
  { id: 'dune', color: 0x8a4fd9, style: 'cap',
    speedMul: 1.10, lane: -1.5, jitter: 0.9 },
  { id: 'zara', color: 0xf07f2f, style: 'keffiyeh',
    speedMul: 0.98, lane: 1.5, jitter: 0.6 },
  { id: 'komo', color: 0x2fb3a6, style: 'fletch',
    speedMul: 0.87, lane: 2.4, jitter: 1.3 },
];

const LANE_CLAMP = 2.3;   // never hug the edge of a narrow ledge

export class Rival {
  constructor(R, world, rd, spawn, idx, heroDef) {
    this.rd = rd;
    this.id = rd.id;
    const def = {
      speed: heroDef.speed * rd.speedMul, accel: 40, friction: 55,
      jump: heroDef.jump, hp: 99, color: rd.color, style: rd.style,
    };
    this.player = new Player(R, world, def,
      { x: rd.lane, y: spawn.y, z: spawn.z });
    this.finished = false;
    this.finishT = 0;
    this.out = false;          // crates mode: true once in the water
    this.hold = 0;
    this.blockT = 0;
    this.cp = { ...spawn };   // last checkpoint passed
    this.seed = idx * 2.4 + 0.7;
  }

  get pos() { return this.player.pos; }

  step(course, frame, timeSec, live = true) {
    const p = this.player;
    if (this.finished) return;
    const q = p.pos;

    // wander around the assigned lane; course.narrows pull everyone toward
    // the middle where the floor is thin — and, since a narrow may carry a
    // centerX (gated chicanes / the Needle), into the GAP itself
    const wob = Math.sin(frame * 0.013 + this.seed) * this.rd.jitter * 0.5;
    let lim = LANE_CLAMP, cx = 0;
    for (const [z0, z1, r, nx = 0] of course.narrows) {
      if (q.z > z0 && q.z < z1 && r < lim) { lim = r; cx = nx; }
    }
    const target = cx + Math.max(-lim,
      Math.min(lim, this.rd.lane * (lim / LANE_CLAMP) + wob));
    let x = 0;
    if (q.x > target + 0.45) x = -1;
    else if (q.x < target - 0.45) x = 1;

    // zone jumps with a per-rival timing offset so they don't move in sync.
    // Edge-only (hold === 0): the hero jump latch needs a release to re-arm.
    const zj = q.z + Math.sin(this.seed * 3) * 0.25;
    const jump = this.hold === 0 && p.grounded &&
      course.jumpZones.some(([a, b]) => zj > a && zj < b);
    if (jump) this.hold = 32;

    // stuck behind the hero or another rival? vault or shove sideways
    if (p.grounded && p.speed2D < p.def.speed * 0.4) {
      if (++this.blockT > 12) {
        this.blockT = 0;
        this.hold = 32;
        x = q.x >= 0 ? -1 : 1;
      }
    } else this.blockT = 0;

    p.step({ x, jump, jumpHeld: this.hold > 0, spin: false,
      windX: live ? windAt(course, q) : 0 });
    if (this.hold > 0) this.hold--;
    // hazards knock rivals too (hp 99 → they stumble but never die): chaos
    if (live) {
      const k = hazardTouch(course, q);
      if (k) p.hurt(k.kx, k.kz);
    }

    // checkpoint respawn, same rules as the hero
    for (const cp of course.checkpoints) {
      if (q.z > cp.z && this.cp.z < cp.z) {
        this.cp = { x: cp.x + this.rd.lane * 0.4, y: cp.y, z: cp.z };
        p.spawn = this.cp;
      }
    }
    if (q.y < -12) p.respawn();
    if (q.z >= course.finishZ) {
      this.finished = true;
      this.finishT = timeSec;
      p.autoRun = false;
    }
  }

  // Crate Cove tick: read the shared hop brain, drive the free-control rig,
  // and report elimination the moment the runner dips into the sea. The
  // caller (game.stepCrates) owns the world.step and win/lose bookkeeping.
  stepCrates(course, frame) {
    const p = this.player;
    if (this.out) return { out: true };
    const q = p.pos;
    if (q.y < CRATES.drown) {
      this.out = true;
      // park the body under the sea so the rival visibly leaves the game
      p.body.setNextKinematicTranslation({ x: q.x, y: -40, z: q.z });
      return { out: true };
    }
    const h = crateHop(course, q, p.grounded, frame);
    if (h.jump) this.hold = 26;
    p.step({ x: h.x, z: h.z, jump: h.jump, jumpHeld: this.hold > 0,
      spin: false });
    if (this.hold > 0) this.hold--;
    return { out: false };
  }
}

export function makeRivals(R, world, course, heroDef, pads = null, padOffset = 1) {
  return RIVAL_DEFS.map((rd, i) => {
    const pad = pads && pads[(i + padOffset) % pads.length];
    const spawn = pad ? { x: pad[0], y: 1.6, z: pad[1] } : course.spawn;
    return new Rival(R, world, rd, spawn, i, heroDef);
  });
}

// ---- Crate Cove autopilot (mode 'crates') --------------------------------
// Pure decision: given a runner's position + the deck schedule, what inputs
// keep them dry? Read the same sinkAt data the human reads with their eyes:
// stand centre on a safe deck; when it's telegraphing/gone, hop to the
// nearest deck that still has a future; bail sideways if a deck vanishes
// underfoot. Deterministic (no RNG) so headless races replay exactly.
export function crateHop(course, pos, grounded, frame) {
  const t = frame / 60;
  const alive = (k) => !k.sunk && t < k.sinkAt;
  const future = (k) => alive(k) && (k.sinkAt - t) > 6;
  // decks form a 3.9m grid — Chebyshev distance finds the one underfoot
  let here = null, best = 1e9;
  for (const k of course.crates) {
    const d = Math.max(Math.abs(pos.x - k.x), Math.abs(pos.z - k.z));
    if (d < best && d < CRATES.half + 0.7) { best = d; here = k; }
  }
  // mid-air over a gap: COMMIT. Steer at the nearest deck that isn't under
  // the water — re-targeting mid-flight is how bots land in the gap.
  if (!grounded) {
    let land = null, ld = 1e9;
    for (const k of course.crates) {
      if (k.sunk) continue;
      const d = Math.hypot(k.x - pos.x, k.z - pos.z);
      if (d < ld) { ld = d; land = k; }
    }
    if (land) {
      const dx = land.x - pos.x, dz = land.z - pos.z;
      const d = Math.hypot(dx, dz) || 1;
      return { x: d > 0.35 ? dx / d : 0, z: d > 0.35 ? dz / d : 0, jump: false };
    }
    return { x: 0, z: 0, jump: false };
  }
  // destination: the deck with the best LIFE-per-distance score — the
  // immortal showdown deck always wins, so the pack drifts toward it.
  // (Nearest-only targeting strands runners on decks that die next.)
  let dest = null, bd = -1e9;
  for (const k of course.crates) {
    if (!future(k)) continue;
    const d = Math.abs(k.x - pos.x) + Math.abs(k.z - pos.z);
    const life = Math.min(k.sinkAt, 90);
    const score = life - d * 0.6;
    if (score > bd) { bd = score; dest = k; }
  }
  if (!dest) dest = here;
  if (!dest) return { x: 0, z: 0, jump: false };
  // hop deck-to-deck: always leave via an ADJACENT deck (diagonal hops aim
  // through the corner water), preferring one with a real future; if every
  // neighbour is short-lived, take the best of them anyway; only when none
  // exists AND this deck is already going under, leap for the far target.
  let tgt = here;
  if (here && dest !== here) {
    const pick = (safeOnly) => {
      let bn = null, bnd = 1e9;
      for (const k of course.crates) {
        if (k === here || k.sunk) continue;
        if (safeOnly && !future(k)) continue;
        const ax = Math.abs(k.x - here.x), az = Math.abs(k.z - here.z);
        const adj = (ax > 2.6 && ax < 5.2 && az < 0.6) ||
                    (az > 2.6 && az < 5.2 && ax < 0.6);
        if (!adj) continue;
        const nd = Math.abs(k.x - dest.x) + Math.abs(k.z - dest.z);
        if (nd < bnd) { bnd = nd; bn = k; }
      }
      return bn;
    };
    tgt = pick(true) || pick(false) || here;
    // genuinely stranded: only leap for the far deck once ours is sinking
    if (tgt === here && t >= here.sinkAt) tgt = dest;
  }
  if (!tgt) return { x: 0, z: 0, jump: false };
  const wob = tgt === here ? 0 : Math.sin(frame * 0.02 + pos.z) * 0.12;
  const dx = tgt.x + wob - pos.x, dz = tgt.z - pos.z;
  const dist = Math.hypot(dx, dz);
  let x = 0, z = 0;
  if (dist > 0.35) { x = dx / dist; z = dz / dist; }
  // jump from near our deck's far edge (one 1.5m gap ahead) — by then we
  // are at full free-mode speed, so the arc lands on the far deck
  const jump = grounded && here && tgt !== here && dist < 3.0 && dist > 2.0;
  return { x, z, jump };
}

// 1..N — how many racers are strictly ahead of the hero right now
export function placement(game) {
  const hz = game.player.pos.z;
  let ahead = 0;
  for (const r of game.rivals) {
    if (r.finished || r.player.pos.z > hz) ahead++;
  }
  return ahead + 1;
}

export const FIELD_SIZE = RIVAL_DEFS.length + 1;
