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
  return { ground, step, coinRow };
}

function makeHammer(R, world, z, omega, phase = 0) {
  const body = world.createRigidBody(
    R.RigidBodyDesc.kinematicPositionBased().setTranslation(0, 0, z));
  world.createCollider(
    R.ColliderDesc.cuboid(3.1, 0.27, 0.27)
      .setTranslation(1.55, 0.55, 0), body);
  return { body, z, omega, phase };
}

function makePillar(R, world, z, o = {}) {
  const y0 = o.y0 ?? 0.55, amp = o.amp ?? 0.45, omega = o.omega ?? 2.0;
  const phase = o.phase ?? 0, half = o.half ?? 0.9;
  const body = world.createRigidBody(
    R.RigidBodyDesc.kinematicPositionBased().setTranslation(o.x ?? 0.4, y0, z));
  world.createCollider(R.ColliderDesc.cuboid(half, 0.3, half), body);
  return { body, z, phase, y0, amp, omega, x: o.x ?? 0.4, half };
}

function newCourse(theme) {
  return {
    theme,
    segs: [], steps: [], shoulders: [], coins: [], hammers: [], pillars: [],
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
  const { ground, step, coinRow } = kit(R, world, c);

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

  c.checkpoints.push({ z: 28, x: 0, y: 1.6 }, { z: 66, x: 0, y: 1.6 });
  c.jumpZones.push([14.6, 15.4], [29.3, 30.3], [32.3, 33.3], [51.0, 51.8]);
  c.narrows.push([50.2, 55.6, 0.9]);
  c.finishZ = 88.5;
  c.spawn = { x: 0, y: 1.6, z: -3 };
  c.coinTotal = c.coins.length;

  for (let z = 2; z < 86; z += 9.3) {
    c.decor.push({ kind: 'palm', x: z % 2 < 1 ? -6.4 : 6.4, z });
  }
  c.decor.push({ kind: 'rock', x: 5.6, z: 12 }, { kind: 'rock', x: -5.8, z: 63 });
  return c;
}

// ------------------------------------------------- STAGE 2: SUNSET RIDGE

const THEME_RIDGE = {
  sky: 0xf0985a, sand: 0xe0a06a, sandDark: 0xc2854f, rock: 0x9c6b4a,
  wood: 0x7a4a2c, sea: 0x2a6ea0, sun: 0xffd9a8, hemiGround: 0x6a4a3a,
};

export function buildRidge(R, world) {
  const c = newCourse(THEME_RIDGE);
  const { ground, step, coinRow } = kit(R, world, c);

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
  ground(61.2, 72);
  coinRow(64, 68, 3);
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

  c.checkpoints.push({ z: 52, x: 0, y: 1.6 }, { z: 68, x: 0, y: 1.6 });
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
    c.decor.push({ kind: 'palm', x: (z / 14.5 | 0) % 2 ? 6.6 : -6.6, z });
  }
  c.decor.push({ kind: 'rock', x: 5.8, z: 20 }, { kind: 'rock', x: -6, z: 66 },
    { kind: 'rock', x: 6, z: 80 });
  return c;
}

// ---------------------------------------------------------------- shared

// advance kinematic hazards; call before world.step() each tick
export function courseStep(R, course, frame) {
  const t = frame / 60;
  for (const h of course.hammers) {
    const a = t * h.omega + h.phase;
    h.body.setNextKinematicRotation(
      { x: 0, y: Math.sin(a / 2), z: 0, w: Math.cos(a / 2) });
  }
  for (const p of course.pillars) {
    const y = p.y0 + Math.sin(t * p.omega + p.phase) * p.amp;
    p.body.setNextKinematicTranslation({ x: p.x, y, z: p.z });
  }
}

export const LEVELS = [
  { id: 'shore', nameKey: 'level.beach', build: buildShore, theme: THEME_SHORE },
  { id: 'ridge', nameKey: 'level.ridge', build: buildRidge, theme: THEME_RIDGE },
];
