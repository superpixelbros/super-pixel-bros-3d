// AI rivals: real Player instances on the same physics world, driven by a
// pure-logic autopilot (no three.js — headless can race them). Each rival
// is a solid kinematic capsule, so shoving each other is emergent chaos,
// exactly like the intended Stumble-Guys feel. The autopilot jumps in the
// same course.jumpZones the reachability bot uses, with per-rival jitter;
// netcode seam: all state is (inputs → determinate sim), so feeding
// recorded flag streams could replay a race later.

import { Player, CHARACTERS } from './hero.js';

// Speeds sit between the heroes' range so every hero can win with a clean
// run; jump stats stay in the proven-clearable envelope.
export const RIVAL_DEFS = [
  { id: 'dune', color: 0x8a4fd9, style: 'cap',
    speed: 7.6, jump: 10.9, lane: -1.5, jitter: 0.9 },
  { id: 'zara', color: 0xf07f2f, style: 'keffiyeh',
    speed: 6.3, jump: 11.4, lane: 1.5, jitter: 0.6 },
  { id: 'komo', color: 0x2fb3a6, style: 'fletch',
    speed: 5.6, jump: 10.4, lane: 2.4, jitter: 1.3 },
];

const LANE_CLAMP = 2.3;   // never hug the edge of a narrow ledge

export class Rival {
  constructor(R, world, rd, spawn, idx) {
    this.rd = rd;
    this.id = rd.id;
    const def = {
      speed: rd.speed, accel: 40, friction: 55, jump: rd.jump,
      hp: 99, color: rd.color, style: rd.style,
    };
    this.player = new Player(R, world, def,
      { x: rd.lane, y: spawn.y, z: spawn.z });
    this.finished = false;
    this.finishT = 0;
    this.hold = 0;
    this.blockT = 0;
    this.cp = { ...spawn };   // last checkpoint passed
    this.seed = idx * 2.4 + 0.7;
  }

  get pos() { return this.player.pos; }

  step(course, frame, timeSec) {
    const p = this.player;
    if (this.finished) return;
    const q = p.pos;

    // wander around the assigned lane; course.narrows pull everyone toward
    // the middle where the floor is thin (pillar crossings)
    const wob = Math.sin(frame * 0.013 + this.seed) * this.rd.jitter * 0.5;
    let lim = LANE_CLAMP;
    for (const [z0, z1, r] of course.narrows) {
      if (q.z > z0 && q.z < z1) lim = Math.min(lim, r);
    }
    const target = Math.max(-lim, Math.min(lim, this.rd.lane * (lim / LANE_CLAMP) + wob));
    let x = 0;
    if (q.x > target + 0.45) x = -1;
    else if (q.x < target - 0.45) x = 1;

    // zone jumps with a per-rival timing offset so they don't move in sync
    const zj = q.z + Math.sin(this.seed * 3) * 0.25;
    const jump = p.grounded &&
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

    p.step({ x, jump, jumpHeld: this.hold > 0, spin: false });
    if (this.hold > 0) this.hold--;

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
}

export function makeRivals(R, world, course) {
  return RIVAL_DEFS.map((rd, i) => new Rival(R, world, rd, course.spawn, i));
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
