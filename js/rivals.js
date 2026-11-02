// AI rivals: real Player instances on the same physics world, driven by a
// pure-logic autopilot (no three.js — headless can race them). Each rival
// is a solid kinematic capsule, so shoving each other is emergent chaos,
// exactly like the intended Stumble-Guys feel. The autopilot jumps in the
// same course.jumpZones the reachability bot uses, with per-rival jitter;
// netcode seam: all state is (inputs → determinate sim), so feeding
// recorded flag streams could replay a race later.

import { Player, CHARACTERS } from './hero.js';
import {
  windAt, hazardTouch, CRATES, wetAt, PAC,
  pacCellAt, pacCenter, pacNeighbours, pacDistField,
} from './levels.js';

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
    this.actT = 0;             // grab cooldown (crates)
    this.holdT = 0;            // frames spent carrying someone
    this.blockT = 0;
    this.cp = { ...spawn };   // last checkpoint passed
    this.seed = idx * 2.4 + 0.7;
    // Ghost Maze (mode 'pac'): personal munch counter + walk memory
    this.eaten = 0;
    this.graceT = 0;         // post-warp mercy (a spirit gets no second bite)
    this.pacState = null;    // built lazily on the first pac tick
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
    // The jitter may only ADD trigger chances — checking the raw z too keeps
    // a slow rival from being nudged out of a zone it is standing in (that
    // parked komo against a bin forever).
    const zj = q.z + Math.sin(this.seed * 3) * 0.25;
    let jump = this.hold === 0 && p.grounded &&
      course.jumpZones.some(([a, b]) =>
        (zj > a && zj < b) || (q.z > a && q.z < b));
    if (jump) this.hold = 32;

    // stuck behind the hero, a rival or street furniture? vault it for real
    if (p.grounded && p.speed2D < p.def.speed * 0.4) {
      if (++this.blockT > 12) {
        this.blockT = 0;
        this.hold = 32;
        if (p.grounded) jump = true;   // holding the button alone never jumps
        x = q.x >= 0 ? -1 : 1;
      }
    } else this.blockT = 0;

    p.step({ x, jump, jumpHeld: this.hold > 0, spin: false,
      windX: live ? windAt(course, q) : 0,
      wet: wetAt(course, q) });
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
  stepCrates(course, frame, targets = []) {
    const p = this.player;
    if (this.out) return { out: true };
    const q = p.pos;
    if (q.y < CRATES.drown) {
      this.out = true;
      // park the body under the sea so the rival visibly leaves the game
      p.body.setNextKinematicTranslation({ x: q.x, y: -40, z: q.z });
      return { out: true };
    }
    // being carried: mash to break free (roughly one press every 9 frames)
    if (p.carrier) {
      if (frame % 9 === 0) p.struggle();
      return { out: false };
    }
    // carrying someone: hold on for a beat, then hurl them
    if (p.carry) {
      this.holdT += 1;
      if (this.holdT > 100) { p.throwCarried(); this.holdT = 0; }
    } else this.holdT = 0;
    // aggression: grab a neighbour when off cooldown (players included)
    this.actT = Math.max(0, this.actT - 1);
    if (this.actT === 0 && !p.carry) {
      for (const t of targets) {
        if (!t || t === p || t.carrier || t.carry || t.dead) continue;
        const b = t.pos;
        if (Math.hypot(b.x - q.x, b.z - q.z) < 1.0
          && Math.abs(b.y - q.y) < 1.1) {
          p.grab(t);
          this.actT = 150;
          this.holdT = 0;
          break;
        }
      }
    }
    const h = crateHop(course, q, p.grounded, frame);
    if (h.jump) this.hold = 26;
    p.step({ x: h.x, z: h.z, jump: h.jump, jumpHeld: this.hold > 0,
      spin: false });
    if (this.hold > 0) this.hold--;
    return { out: false };
  }

  // Ghost Maze tick: munch when hungry, flee a hunting spirit, chase down a
  // frightened one, otherwise stroll back to the pad. Same commit-to-a-leg
  // discipline as the ghosts so nobody buzz-saws at a junction. ctx:
  // { ghosts: [...], fright: bool, hungry: bool }. The game owns dot
  // bookkeeping (r.eaten), catches and the power window.
  stepPac(course, frame, ctx) {
    const p = this.player;
    if (p.carrier) return;               // nothing to grab here — ride along
    const q = p.pos;
    const s = this.pacState || (this.pacState = {
      cur: null, prev: null, want: '', goalId: '', homeCell: null,
      legFrom: null, legTo: null,
    });
    const c = pacCellAt(course, q.x, q.z);
    if (!s.cur) s.cur = [c.i, c.j];
    else if (c.i !== s.cur[0] || c.j !== s.cur[1]) {
      s.prev = s.cur;
      s.cur = [c.i, c.j];
    }
    // ---- live wants: flee > hunt > munch > home ---------------------------
    let threat = null, td = 1e9;          // a rested/frightened spirit is not scary
    let pray = null, hd = 1e9;            // ...but a frightened one is dinner
    for (const g of ctx.ghosts) {
      if (g.poofT > 0) continue;
      const gp = g.pos;
      if (Math.abs(gp.y - q.y) > 2) continue;     // resting/parked: not on the board
      const d = Math.hypot(gp.x - q.x, gp.z - q.z);
      if (g.fright) { if (d < hd) { hd = d; pray = g; } }
      else if (d < td) { td = d; threat = g; }
    }
    let want = 'home', goalId = '', gcell = null;
    if (threat && td < RUNNER_SCARED_M + (s.want === 'flee' ? 2.5 : 0)) {
      want = 'flee'; goalId = threat.id;
    } else if (pray) {
      want = 'hunt'; goalId = pray.id;
    } else if (ctx.hungry) {
      gcell = pacDotCell(course, c.i, c.j);
      if (gcell) { want = 'munch'; goalId = `${gcell[0]},${gcell[1]}`; }
    }
    if (want === 'home') {
      if (!s.homeCell) {
        const h = pacCellAt(course, p.spawn.x, p.spawn.z);
        s.homeCell = [h.i, h.j];
      }
      goalId = 'home';
    }
    // ---- leg: re-plan on a new want or when the current cell arrives ------
    const sameWant = s.want === want && s.goalId === goalId;
    const arrived = s.legTo && c.i === s.legTo[0] && c.j === s.legTo[1];
    if (!sameWant || !s.legTo || arrived) {
      let gc = gcell;
      if (want === 'flee' || want === 'hunt') {
        const t = (want === 'flee' ? threat : pray);
        if (t) {
          const tc = pacCellAt(course, t.pos.x, t.pos.z);
          gc = [tc.i, tc.j];
        }
      } else if (want === 'home') gc = s.homeCell;
      const ai = s.cur[0], aj = s.cur[1];
      const f = (arrived && s.legFrom) ? s.legFrom : s.prev;
      const fi = f ? f[0] : null, fj = f ? f[1] : null;
      let nx = null;
      if (gc && !(ai === gc[0] && aj === gc[1])) {
        nx = want === 'flee'
          ? pacLegAway(course, ai, aj, fi, fj, pacDistField(course, gc[0], gc[1]))
          : pacLegTo(course, ai, aj, fi, fj, gc[0], gc[1]);
      }
      s.want = want; s.goalId = goalId;
      s.legFrom = [ai, aj];
      s.legTo = nx;
    }
    const u = s.legTo ? pacAim(q, course, s.legTo) : { x: 0, z: 0 };
    p.step({ x: u.x, z: u.z });
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

// ---- Ghost Maze brains (mode 'pac') ---------------------------------------
// Both sides walk the classic arcade discipline: commit to ONE leg across a
// cell at a time, pick the next cell that minimises straight-line distance to
// the want (no reversing unless cornered), flee by BFS-fleeING instead — run
// away needs true corridor distances. No RNG anywhere, ties fall on array /
// index order, so headless replays match frame for frame.

const GHOST_LEAD = 4;          // ambusher looks this many cells ahead
const COWARD_SCARED_M = 7;     // the coward bolts under this threat range (m)
const RUNNER_SCARED_M = 5.5;   // AI runners dodge a spirit this close (m)

// Original spirits with the famous four TEMPERAMENTS — mechanics homage only,
// names/colors/shapes are ours. speedMul stays under 1: corridors are the
// difficulty, straight-line outrunning is not their job.
export const GHOST_DEFS = [
  { id: 'rook', role: 'chaser', speedMul: 0.88, color: 0xe8544f },
  { id: 'mira', role: 'ambusher', speedMul: 0.90, color: 0xf2a7c3 },
  { id: 'sabra', role: 'flanker', speedMul: 0.86, color: 0x59c8e8 },
  { id: 'nunoo', role: 'coward', speedMul: 0.84, color: 0xf6c445 },
];

// walk up to n cells from (i,j) along a runner's velocity — the ambusher
// cuts off where you were HEADING, not where you are
function pacAheadCell(course, i, j, vx, vz, n) {
  const rows = course.pac.rows;
  const open = (a, b) => rows[a] !== undefined && rows[a][b] !== '#';
  const dx = Math.abs(vx) >= Math.abs(vz) ? Math.sign(vx) : 0;
  const dz = dx === 0 ? Math.sign(vz) : 0;
  let bi = i, bj = j;
  for (let k = 0; k < n; k++) {
    const a = bi + dz, b = bj + dx;
    if (!open(a, b)) break;
    bi = a; bj = b;
  }
  return [bi, bj];
}

// the cell opposite the maze centre (mirror personality); when that is a
// wall, spiral outward to the nearest open one
function pacMirrorOpen(course, i, j) {
  const rows = course.pac.rows;
  const mi = rows.length - 1 - i, mj = rows[0].length - 1 - j;
  if (rows[mi][mj] !== '#') return [mi, mj];
  for (let r = 1; r < 9; r++) {
    for (let di = -r; di <= r; di++) {
      for (let dj = -r; dj <= r; dj++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
        const a = mi + di, b = mj + dj;
        if (rows[a] !== undefined && rows[a][b] !== '#') return [a, b];
      }
    }
  }
  return [mi, mj];
}

// the cell of the nearest uneaten dot (ties: earlier in the list)
function pacDotCell(course, i, j) {
  let bd = 1e18, bi = -1, bj = -1;
  for (const d of course.pac.dots) {
    if (d.taken) continue;
    const dd = (d.i - i) * (d.i - i) + (d.j - j) * (d.j - j);
    if (dd < bd) { bd = dd; bi = d.i; bj = d.j; }
  }
  return bi >= 0 ? [bi, bj] : null;
}

// next cell of a leg from (ci,cj), not back into (fi,fj), strafe-hugging
// toward goal (ti,tj) — straight-line greedy like the arcade ghosts
function pacLegTo(course, ci, cj, fi, fj, ti, tj) {
  const ns = pacNeighbours(course, ci, cj);
  if (!ns.length) return [ci, cj];
  const keep = ns.filter(([a, b]) => !(a === fi && b === fj));
  const pool = (fi === null || keep.length) ? keep : ns;
  let best = pool[0], bd = Infinity;
  for (const [a, b] of pool) {
    const d = (a - ti) * (a - ti) + (b - tj) * (b - tj);
    if (d < bd) { bd = d; best = [a, b]; }
  }
  return best;
}

// same leg rule but following a BFS field AWAY from a threat (maximise)
function pacLegAway(course, ci, cj, fi, fj, dist) {
  const ns = pacNeighbours(course, ci, cj);
  if (!ns.length) return [ci, cj];
  const keep = ns.filter(([a, b]) => !(a === fi && b === fj));
  const pool = (fi === null || keep.length) ? keep : ns;
  let best = pool[0], bv = -Infinity;
  for (const [a, b] of pool) {
    const v = dist[a][b];
    if (v > bv) { bv = v; best = [a, b]; }
  }
  return best;
}

// unit drive toward a cell centre — free-mode flags scale it by speed·0.82
function pacAim(q, course, cell) {
  const ct = pacCenter(course, cell[0], cell[1]);
  const dx = ct.x - q.x, dz = ct.z - q.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.12) return { x: 0, z: 0 };
  return { x: dx / d, z: dz / d };
}

export class Ghost {
  constructor(R, world, gd, deploy, idx, heroDef) {
    this.gd = gd;
    this.id = gd.id;
    const def = {
      speed: heroDef.speed * gd.speedMul, accel: 46, friction: 58,
      jump: heroDef.jump, hp: 99, color: gd.color, style: 'cap',
    };
    this.player = new Player(R, world, def,
      { x: deploy.x, y: 1.6, z: deploy.z });
    this.player.free = true;
    this.home = { ...deploy };   // redeploy pad (the pen has no door)
    this.from = null;            // leg memory: cell walked out of / walking to
    this.to = null;
    this.stunT = 0;              // spirit-shove stagger frames left
    this.poofT = 0;              // >0: resting off-stage after a powered chomp
    this.fright = false;         // last drive mode (renderer tint/blink)
    this.drive = 1;              // last speed scale handed to the rig
  }

  get pos() { return this.player.pos; }

  // a powered runner touched us: poof out, redeploy from the pad later
  poof() {
    this.poofT = PAC.poofF;
    this.stunT = 0;
    this.from = this.to = null;
  }

  // ACTION shove. hero.js does the physics tumble; stunT keeps the brain
  // offline a beat longer, and zero drive lets friction sell the stagger.
  stunSpirit(dirX, dirZ) {
    this.stunT = PAC.stunF;
    this.player.shove(dirX * 4.6, dirZ * 4.6, 2.8);
  }

  // runners: every runner's Player (humans first — ties favour them).
  // fright: the shared power window is open (game.js owns the timer).
  step(course, frame, runners, fright) {
    const p = this.player;
    if (this.poofT > 0) {
      this.poofT -= 1;
      if (this.poofT === 0) {                     // redeploy!
        p.body.setNextKinematicTranslation(
          { x: this.home.x, y: 1.6, z: this.home.z });
        p.vx = p.vy = p.vz = 0;
      } else {                                    // rest off-stage
        p.body.setNextKinematicTranslation(
          { x: this.home.x, y: -40, z: this.home.z });
      }
      return;
    }
    if (this.stunT > 0) {
      this.stunT -= 1;
      p.step({ x: 0, z: 0 });
      this.drive = 0;
      return;
    }
    const q = p.pos;
    const c = pacCellAt(course, q.x, q.z);
    // nearest runner (straight line; ties → lowest index = human first)
    let th = null, td = 1e9;
    for (const r of runners) {
      const d = Math.hypot(r.pos.x - q.x, r.pos.z - q.z);
      if (d < td) { td = d; th = r; }
    }
    // commit to a leg: fresh pick on spawn and again when the target cell is
    // reached — mid-leg steering keeps aiming at it, so junctions stay calm
    if (!this.to || (c.i === this.to[0] && c.j === this.to[1])) {
      const av = this.to && this.from ? this.from : null;
      let nx = [c.i, c.j];
      if (th) {
        const t = pacCellAt(course, th.pos.x, th.pos.z);
        if (fright || (this.gd.role === 'coward' && !fright
          && td < COWARD_SCARED_M)) {
          nx = pacLegAway(course, c.i, c.j, av?.[0] ?? null, av?.[1] ?? null,
            pacDistField(course, t.i, t.j));
        } else {
          let T;
          if (this.gd.role === 'ambusher') {
            T = pacAheadCell(course, t.i, t.j, th.vx, th.vz, GHOST_LEAD);
          } else if (this.gd.role === 'flanker') {
            T = pacMirrorOpen(course, t.i, t.j);
          } else if (this.gd.role === 'coward') {
            T = pacDotCell(course, c.i, c.j) || [t.i, t.j];
          } else {                                // chaser — point blank duty
            T = [t.i, t.j];
          }
          nx = (T[0] === c.i && T[1] === c.j)
            ? [c.i, c.j]      // standing on the prey: loiter, never orbit away
            : pacLegTo(course, c.i, c.j, av?.[0] ?? null, av?.[1] ?? null,
              T[0], T[1]);
        }
      }
      this.from = [c.i, c.j];
      this.to = nx;
    }
    this.fright = fright;
    const u = pacAim(q, course, this.to);
    // a frightened spirit crawls at PAC.frightSlow of the HERO's pace —
    // dividing by its own ratio makes the achieved speed match exactly
    this.drive = fright ? PAC.frightSlow / this.gd.speedMul : 1;
    p.step({ x: u.x * this.drive, z: u.z * this.drive });
  }
}

export function makeGhosts(R, world, course, heroDef) {
  return GHOST_DEFS.map((gd, i) => new Ghost(R, world, gd,
    course.pac.deploy[i % course.pac.deploy.length], i, heroDef));
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
