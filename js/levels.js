// Level registry: builders + themes + jumpZones. Pure logic (Rapier +
// data), no three.js — headless checks and AI rivals drive off this file.
//
// jumpZones are z-ranges where a jump is REQUIRED to progress: the
// reachability bot jumps inside them, and autopilots read them too. Keep
// them in sync when editing layout. Worst-hero rules still apply:
// bare gaps ≤ 3m (Faris full-hold clears ≈4.3m), step-ups ≤ 0.7m
// (Sahm tops out ≈1.66m), wide gaps need a crossing within reach.

const GROUND_HALF = 1;

// ---------------------------------------------------------------- builders

function kit(R, world, c) {
  const ground = (z0, z1, top = 0, x0 = -4.5, x1 = 4.5, shoulder = 4.5) => {
    const sx0 = x0 - shoulder, sx1 = x1 + shoulder;
    const b = world.createRigidBody(R.RigidBodyDesc.fixed()
      .setTranslation(0, top - GROUND_HALF, (z0 + z1) / 2));
    world.createCollider(R.ColliderDesc.cuboid((sx1 - sx0) / 2, GROUND_HALF,
      (z1 - z0) / 2), b);
    c.segs.push({ x0, x1, z0, z1, top });
    if (shoulder > 0) {
      c.shoulders.push({ x0: sx0, x1: x0, z0, z1, top },
        { x0: x1, x1: sx1, z0, z1, top });
    }
  };
  const step = (x0, x1, z0, z1, top) => {
    const b = world.createRigidBody(R.RigidBodyDesc.fixed()
      .setTranslation((x0 + x1) / 2, top - GROUND_HALF, (z0 + z1) / 2));
    world.createCollider(R.ColliderDesc.cuboid((x1 - x0) / 2, GROUND_HALF,
      (z1 - z0) / 2), b);
    c.steps.push({ x0, x1, z0, z1, top });
  };
  const coinRow = (z0, z1, n, y = 0.9, x = 0) => {
    for (let i = 0; i < n; i++) {
      const z = z0 + (z1 - z0) * (n === 1 ? 0.5 : i / (n - 1));
      c.coins.push({ x, y, z, taken: false });
    }
  };
  // scenery: solid, so a knocked-off-path hero thuds into it, but always
  // planted clear of every running lane (keep |x| ≥ ~5.5 on the shoulders)
  const decor = (kind, x, z) => {
    const size = DECOR_KINDS[kind];
    const b = world.createRigidBody(R.RigidBodyDesc.fixed()
      .setTranslation(x, size.h, z));
    world.createCollider(R.ColliderDesc.cuboid(size.r, size.h, size.r), b);
    c.decor.push({ kind, x, z });
  };
  return { ground, step, coinRow, decor };
}

const DECOR_KINDS = {
  palm: { r: 0.28, h: 0.9 },   // trunk
  rock: { r: 0.5, h: 0.42 },
};

export function makeHammer(R, world, z, omega, phase = 0) {
  const body = world.createRigidBody(
    R.RigidBodyDesc.kinematicPositionBased().setTranslation(0, 0, z));
  world.createCollider(
    R.ColliderDesc.cuboid(3.1, 0.27, 0.27)
      .setTranslation(1.55, 0.55, 0), body);
  return { body, z, omega, phase };
}

export function makePillar(R, world, z, o = {}) {
  const y0 = o.y0 ?? 0.55, amp = o.amp ?? 0.45, omega = o.omega ?? 2.0;
  const phase = o.phase ?? 0, half = o.half ?? 0.9;
  const body = world.createRigidBody(
    R.RigidBodyDesc.kinematicPositionBased().setTranslation(o.x ?? 0.4, y0, z));
  world.createCollider(R.ColliderDesc.cuboid(half, 0.3, half), body);
  return { body, z, phase, y0, amp, omega, x: o.x ?? 0.4, half };
}

// --- damaging hazards --------------------------------------------------------
// A swinging wrecking ball on a rope, sweeping across the lane (Stumble
// pivot push). Knockback-only (no collider): it hurts + staggers rather
// than walling the path — the same sensor model as Stumble's swinging
// hammers, so the auto-run bot can pass and the hit reads as a shove.
export function makePendulum(R, world, z, o = {}) {
  const L = o.len ?? 2.7, pivY = o.pivY ?? 3.5;
  const ampA = o.ampA ?? 1.0;               // peak swing angle (rad)
  const omega = o.omega ?? 2.2, phase = o.phase ?? 0, r = o.r ?? 0.62;
  const body = world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased()
    .setTranslation(0, pivY - L, z));
  return { kind: 'pendulum', body, z, L, pivY, ampA, omega, phase, r };
}

// A heavy log rolling side-to-side across the lane (Crash jungle rollers /
// Stumble Jungle Roll). Knockback-only volume.
export function makeRoller(R, world, z, o = {}) {
  const amp = o.amp ?? 3.4, omega = o.omega ?? 1.5, phase = o.phase ?? 0;
  const r = o.r ?? 0.9;
  const body = world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased()
    .setTranslation(0, r, z));
  return { kind: 'roller', body, z, amp, omega, phase, r };
}

// A block punching side-to-side on a rail — too tall to jump, must be
// timed (Stumble moving blocks). Knockback-only volume.
export function makePiston(R, world, z, o = {}) {
  const amp = o.amp ?? 3.6, omega = o.omega ?? 1.35, phase = o.phase ?? 0;
  const hy = o.hy ?? 1.4;
  const body = world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased()
    .setTranslation(0, hy, z));
  return { kind: 'piston', body, z, amp, omega, phase, hy };
}

// --- beneficial / zone props -------------------------------------------------
export function makeBounce(R, world, x, z, o = {}) {
  return { x, z, r: o.r ?? 0.95, up: o.up ?? 15.5 };
}
export function makeWind(R, world, z0, z1, o = {}) {
  return { z0, z1, dir: o.dir ?? 1, force: o.force ?? 4.2 };
}
// A bridge slab that gives way ~0.6s after you step on it (Crash drop
// platforms / Stumble Honey Drop). FIXED collider — the character
// controller treats flush kinematic seams as walls, so it must share the
// ground's body type. When it goes, the body is removed and the mesh
// falls away in the renderer (c.fallT drives the animation).
export function makeCrumble(R, world, z0, z1, o = {}) {
  const top = o.top ?? 0, x0 = o.x0 ?? -4.5, x1 = o.x1 ?? 4.5;
  const body = world.createRigidBody(R.RigidBodyDesc.fixed()
    .setTranslation((x0 + x1) / 2, top - 1, (z0 + z1) / 2));
  world.createCollider(R.ColliderDesc.cuboid((x1 - x0) / 2, 1, (z1 - z0) / 2),
    body);
  return { body, x0, x1, z0, z1, top, timer: 0, gone: false, removed: false,
    fallT: 0 };
}

function newCourse(theme) {
  return {
    theme,
    segs: [], steps: [], shoulders: [], coins: [], hammers: [], pillars: [],
    pendulums: [], rollers: [], pistons: [], crumbles: [], bounces: [],
    winds: [],
    checkpoints: [], decor: [], jumpZones: [],
    narrows: [],        // [z0, z1, maxLaneRadius] — AI lane clamps
    finishZ: 0, spawn: { x: 0, y: 1.6, z: -3 }, coinTotal: 0,
  };
}

// ------------------------------------------------------- STAGE 1: SHORE

const THEME_SHORE = {
  sky: 0x9ad8f5, sand: 0xe7d29a, sandDark: 0xd3ba7e, rock: 0xa9a294,
  wood: 0x8a5a33, sea: 0x2f8fd0, sun: 0xfff2d8, hemiGround: 0x8a7a55,
};

export function buildShore(R, world) {
  const c = newCourse(THEME_SHORE);
  const { ground, step, coinRow, decor } = kit(R, world, c);

  ground(-18, 16);                     // menu pedestal at z=-14
  coinRow(4, 10, 4);
  coinRow(16.4, 18.6, 3, 1.3);         // arc over the gap
  ground(19, 40);
  coinRow(22, 26, 3);
  step(-2.2, 2.2, 30.5, 33.5, 0.7);
  step(-2.2, 2.2, 33.5, 36.5, 1.4);
  coinRow(31.5, 35.5, 3, 2.4);
  ground(40, 52);                      // hammer arena
  c.hammers.push(makeHammer(R, world, 46, 1.5));
  coinRow(41.5, 44.5, 2, 0.9, 3);
  // 2.5m gap with a bobbing pillar: its far edge overlaps the landing
  // ground, and the top stays ≤0.65m so it's a hop-able prop, never a wall
  c.pillars.push(makePillar(R, world, 53.3,
    { y0: 0.3, amp: 0.3, omega: 1.6, phase: 0, half: 1.2, x: 0.3 }));
  coinRow(51.4, 53.6, 3, 1.9);
  ground(54.5, 88);
  coinRow(60, 64, 3);
  coinRow(70, 78, 5, 0.9, -2.4);
  coinRow(70, 78, 5, 0.9, 2.4);

  // gentle new-toys intro: one pendulum to time on the wide ground, and a
  // bonus bounce pad (off to the side) that launches you to a high coin arc
  c.pendulums.push(makePendulum(R, world, 24, { omega: 2.0 }));
  c.bounces.push(makeBounce(R, world, 3.2, 62, { up: 14 }));
  coinRow(62, 63.5, 2, 3.0, 3.2);

  c.checkpoints.push({ z: 28, x: 0, y: 1.6 }, { z: 66, x: 0, y: 1.6 });
  c.jumpZones.push([14.6, 15.4], [29.3, 30.3], [32.3, 33.3], [51.0, 51.8]);
  c.narrows.push([50.2, 55.6, 0.9]);
  c.finishZ = 88.5;
  c.spawn = { x: 0, y: 1.6, z: -3 };
  c.coinTotal = c.coins.length;

  for (let z = 2; z < 86; z += 9.3) {
    decor('palm', z % 2 < 1 ? -6.4 : 6.4, z);
  }
  decor('rock', 5.6, 12); decor('rock', -5.8, 63);
  return c;
}

// ------------------------------------------------- STAGE 2: SUNSET RIDGE

const THEME_RIDGE = {
  sky: 0xf0985a, sand: 0xe0a06a, sandDark: 0xc2854f, rock: 0x9c6b4a,
  wood: 0x7a4a2c, sea: 0x2a6ea0, sun: 0xffd9a8, hemiGround: 0x6a4a3a,
};

export function buildRidge(R, world) {
  const c = newCourse(THEME_RIDGE);
  const { ground, step, coinRow, decor } = kit(R, world, c);

  ground(0, 14);
  coinRow(4, 9, 3);
  // gap1: 2.5m
  coinRow(13.6, 16.2, 3, 1.25);
  ground(16.5, 26);
  coinRow(19, 23, 3, 0.9, 2);
  // counter-phased hammer pair
  ground(26, 36);
  c.hammers.push(makeHammer(R, world, 29.5, 1.7, 0),
    makeHammer(R, world, 34, 1.7, Math.PI));
  // narrow ledge: NO shoulders — the void is the challenge
  ground(36, 44, 0, -3, 3, 0);
  coinRow(37.5, 42.5, 4, 0.9);
  // gap2: 3m
  coinRow(43.6, 46.8, 3, 1.25);
  ground(47, 56);
  coinRow(49, 53, 3, 0.9, -2);
  // bobbing twin-pillar crossing (tops stay ≤0.9m: always landable)
  // pillar edges OVERLAP each other and the landing ground: a mid-speed
  // hero whose arc falls short of p2 still lands — never in a seam
  c.pillars.push(
    makePillar(R, world, 57.6, { y0: 0.3, amp: 0.3, omega: 1.8, phase: 0, half: 1.1, x: 0.2 }),
    makePillar(R, world, 60.2, { y0: 0.3, amp: 0.3, omega: 1.8, phase: Math.PI, half: 1.1, x: -0.2 }));
  coinRow(57.0, 60.4, 3, 1.7);
  // mid-run roller (wide ground), then a CRUMBLE crossing: the cracked slab
  // over the void gives way 0.6s after you land — keep moving or drop
  c.rollers.push(makeRoller(R, world, 20, { amp: 3.2, omega: 1.7 }));
  ground(61.2, 66);
  c.crumbles.push(makeCrumble(R, world, 66, 68.6, { x0: -2.4, x1: 2.4 }));
  ground(68.6, 72);
  coinRow(63.5, 67, 3);
  // piston gauntlet on the wide ground past the checkpoint
  c.pistons.push(makePiston(R, world, 50, { amp: 3.4, omega: 1.6 }));
  // crosswind over the narrow ledge — lean into it or drift off
  c.winds.push(makeWind(R, world, 36.2, 43.8, { dir: 1, force: 2.2 }));
  // ridge staircase: two 0.7m plateaus
  ground(72, 76, 0.7);
  coinRow(73, 75, 2, 1.7);
  ground(76, 84, 1.4);
  coinRow(78, 82, 3, 2.4);
  // final run + sweep hammer
  ground(84, 96);
  c.hammers.push(makeHammer(R, world, 90, 1.9, 0));
  coinRow(85.5, 88, 2, 0.9, -2.4);
  coinRow(92, 94.5, 2, 0.9, 2.4);

  c.checkpoints.push({ z: 52, x: 0, y: 1.6 }, { z: 63, x: 0, y: 1.6 });
  c.jumpZones.push(
    [13.2, 14.0], [43.2, 44.0],
    [55.2, 56.1], [57.8, 58.7], [60.2, 61.1],
    [71.0, 72.0], [75.2, 76.0],
  );
  c.narrows.push([35.5, 44.2, 1.8], [55.0, 61.6, 0.9]);
  c.finishZ = 96.5;
  c.spawn = { x: 0, y: 1.6, z: 0 };
  c.coinTotal = c.coins.length;

  for (let z = 6; z < 92; z += 14.5) {
    decor('palm', (z / 14.5 | 0) % 2 ? 6.6 : -6.6, z);
  }
  decor('rock', 5.8, 20); decor('rock', -6, 66); decor('rock', 6, 80);
  return c;
}

// ---------------------------------------------------------------- shared

// advance kinematic hazards; call before world.step() each tick. Also
// re-derives each hazard's axis-aligned damage box (harm) and, for
// crumbles, the stand-on timer. Pass a hero (player or rival) to trigger
// crumbles; the reachability bot omits it.
export function courseStep(R, course, frame, hero = null) {
  const t = frame / 60;
  for (const h of course.hammers) {
    const a = t * h.omega + h.phase;
    h.body.setNextKinematicRotation(
      { x: 0, y: Math.sin(a / 2), z: 0, w: Math.cos(a / 2) });
    h.harm = a;
  }
  for (const p of course.pillars) {
    const y = p.y0 + Math.sin(t * p.omega + p.phase) * p.amp;
    p.body.setNextKinematicTranslation({ x: p.x, y, z: p.z });
  }
  for (const p of course.pendulums) {
    const th = p.ampA * Math.sin(t * p.omega + p.phase);
    p.bx = Math.sin(th) * p.L;
    p.by = p.pivY - Math.cos(th) * p.L;
    p.vel = Math.cos(t * p.omega + p.phase);
    p.body.setNextKinematicTranslation({ x: p.bx, y: p.by, z: p.z });
  }
  for (const r of course.rollers) {
    const s = t * r.omega + r.phase;
    r.bx = Math.sin(s) * r.amp;
    r.vel = Math.cos(s);
    r.body.setNextKinematicTranslation({ x: r.bx, y: r.r, z: r.z });
  }
  for (const p of course.pistons) {
    const s = t * p.omega + p.phase;
    p.bx = Math.sin(s) * p.amp;
    p.vel = Math.cos(s);
    p.body.setNextKinematicTranslation({ x: p.bx, y: p.hy, z: p.z });
  }
  for (const c of course.crumbles) {
    if (c.gone) { c.fallT++; continue; }     // body removed by game.step;
    const on = hero && hero.grounded        // fallT animates the mesh
      && hero.pos.x > c.x0 && hero.pos.x < c.x1
      && hero.pos.z > c.z0 && hero.pos.z < c.z1;
    if (on) {
      if (++c.timer > CRUMBLE_FRAMES) c.gone = true;
    } else if (c.timer > 0) c.timer = 0;           // grace: shake resets
  }
}

const CRUMBLE_FRAMES = 36;   // ~0.6s standing before it drops (keep moving)

// The moment a hero overlaps a damaging hazard: returns a knockback vector
// {kx, kz} (m/s) or null. Invulnerability / hearts are the hero's concern.
// Boxes are one-frame-laggy vs the rendered pose (queries see the previous
// step) — the same determinism the hammer already lives with.
export function hazardTouch(course, pos) {
  const R_ = 0.32;                       // hero capsule radius
  // rotating hammer: the bar is a long slab sweeping in the X-Z plane. The
  // hero is hit when the bar's line passes through their capsule (perp
  // distance small) within the bar's reach along its length.
  for (const h of course.hammers) {
    const dx = pos.x, dz = pos.z - h.z, a = h.harm || 0;
    const ux = Math.cos(a), uz = -Math.sin(a);       // along the bar
    const nx = Math.sin(a), nz = Math.cos(a);        // bar normal
    const along = dx * ux + dz * uz;
    const perp = dx * nx + dz * nz;
    if (Math.abs(perp) < 0.27 + R_ && along > -1.6 && along < 4.7)
      return { kx: nx * Math.sign(perp || 1) * 6, kz: nz * Math.sign(perp || 1) * 6 };
  }
  for (const p of course.pendulums) {
    const dx = pos.x - p.bx, dy = pos.y - p.by, dz = pos.z - p.z;
    if (Math.hypot(dx, dy, dz) < p.r + R_)
      return { kx: Math.sign(p.vel) * 6.2, kz: -2.5 };
  }
  for (const r of course.rollers) {
    if (Math.abs(pos.x - r.bx) < 0.62 + R_ && Math.abs(pos.z - r.z) < r.r + R_)
      return { kx: Math.sign(r.vel) * 5.8, kz: -3 };
  }
  for (const p of course.pistons) {
    if (Math.abs(pos.x - p.bx) < 0.7 + R_ && Math.abs(pos.z - p.z) < 0.5 + R_)
      return { kx: Math.sign(p.vel) * 6.6, kz: -2 };
  }
  return null;
}

// wind push for a hero at pos (m/s² lateral), or 0
export function windAt(course, pos) {
  for (const w of course.winds) {
    if (pos.z > w.z0 && pos.z < w.z1) return w.dir * w.force;
  }
  return 0;
}

// timeLimit (s) is the disqualification budget — generous vs the bot clears
// (headless asserts ≥1.6× the slowest hero's clear) so it pressures pace
// without punishing learning the course.
export const LEVELS = [
  { id: 'shore', nameKey: 'level.beach', build: buildShore, theme: THEME_SHORE,
    timeLimit: 45 },
  { id: 'ridge', nameKey: 'level.ridge', build: buildRidge, theme: THEME_RIDGE,
    timeLimit: 70 },
];
