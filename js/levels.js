// Level registry: builders + themes + jumpZones. Pure logic (Rapier +
// data), no three.js — headless checks and AI rivals drive off this file.
//
// jumpZones are z-ranges where a jump is REQUIRED to progress: the
// reachability bot jumps inside them, and autopilots read them too. Keep
// them in sync when editing layout. Worst-hero rules still apply:
// bare gaps ≤ 3m (Faris full-hold clears ≈4.3m), step-ups ≤ 0.7m
// (Sahm tops out ≈1.66m), wide gaps need a crossing within reach. Walls
// and gates only ever narrow the road (never block the whole corridor),
// so the bot's lane-center steering (narrows[i][3]) always finds a way.

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
  // road-blocking wall: a real collider that forces runners through the
  // gaps. Pair two of them to carve a gate; leave shoulders off the ground
  // and the void does the rest of the policing.
  const wall = (x0, x1, z0, z1, h = 2.3, top = 0) => {
    const b = world.createRigidBody(R.RigidBodyDesc.fixed()
      .setTranslation((x0 + x1) / 2, top + h / 2, (z0 + z1) / 2));
    world.createCollider(R.ColliderDesc.cuboid((x1 - x0) / 2, h / 2,
      (z1 - z0) / 2), b);
    c.walls.push({ x0, x1, z0, z1, h, top });
  };
  return { ground, step, coinRow, decor, wall };
}

const DECOR_KINDS = {
  palm: { r: 0.28, h: 0.9 },   // trunk
  rock: { r: 0.5, h: 0.42 },
};

export function makeHammer(R, world, z, omega, phase = 0, len = 3.1) {
  const body = world.createRigidBody(
    R.RigidBodyDesc.kinematicPositionBased().setTranslation(0, 0, z));
  world.createCollider(
    R.ColliderDesc.cuboid(len, 0.27, 0.27)
      .setTranslation(len / 2, 0.55, 0), body);
  return { body, z, omega, phase, harm: 0, active: true };
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
  return { kind: 'pendulum', body, z, L, pivY, ampA, omega, phase, r,
    bx: 0, by: 0, vel: 0, active: true, startT: o.startT ?? 0, th: phase };
}

// A heavy log rolling side-to-side across the lane (Crash jungle rollers /
// Stumble Jungle Roll). Knockback-only volume. ax: 'z' sweeps it along the
// track instead (the arena uses both axes).
export function makeRoller(R, world, z, o = {}) {
  const amp = o.amp ?? 3.4, omega = o.omega ?? 1.5, phase = o.phase ?? 0;
  const r = o.r ?? 0.9;
  const body = world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased()
    .setTranslation(0, r, z));
  return { kind: 'roller', body, z, amp, omega, phase, r,
    bx: 0, bz: 0, vel: 0, ax: o.ax || 'x', active: true,
    startT: o.startT ?? 0, th: phase };
}

// A block punching side-to-side on a rail — too tall to jump, must be
// timed (Stumble moving blocks). Knockback-only volume.
export function makePiston(R, world, z, o = {}) {
  const amp = o.amp ?? 3.6, omega = o.omega ?? 1.35, phase = o.phase ?? 0;
  const hy = o.hy ?? 1.4;
  const body = world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased()
    .setTranslation(0, hy, z));
  return { kind: 'piston', body, z, amp, omega, phase, hy,
    bx: 0, vel: 0, active: true };
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
    walls: [], gates: [],       // blocking walls + portcullis gates
    boosts: [], curses: [],     // speed pickups {x, y, z, taken}
    narrows: [],        // [z0, z1, maxLaneRadius, centerX=0] — AI lane clamps
    finishZ: 0, ringR: 999,
    spawn: { x: 0, y: 1.6, z: -3 }, coinTotal: 0,
  };
}

// An iron portcullis over a one-lane slit: slams down and lifts on a
// cycle, so the pack queues at the gap and dives through when it rises.
// A REAL collider (kinematic) — unlike the sensor hazards, this physically
// blocks. Lift = max(0, sin)·(h+0.4): open ≈ 40% of each cycle.
export function makeGate(R, world, z, o = {}) {
  const cx = o.cx ?? 0, gw = o.gw ?? 1.3;
  const h = o.h ?? 2.6, period = o.period ?? 3.4, phase = o.phase ?? 0;
  const body = world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased()
    .setTranslation(cx, h / 2, z));
  world.createCollider(R.ColliderDesc.cuboid(gw / 2, h / 2, 0.28), body);
  return { body, z, cx, gw, h, period, phase, open: false, lift: 0 };
}

// ------------------------------------------------------- STAGE 1: SHORE

const THEME_SHORE = {
  sky: 0x9ad8f5, sand: 0xe7d29a, sandDark: 0xd3ba7e, rock: 0xa9a294,
  wood: 0x8a5a33, sea: 0x2f8fd0, sun: 0xfff2d8, hemiGround: 0x8a7a55,
};

// Sunny Shore v2: still the friendliest stage, but it stopped pulling
// punches — a first chicane gate before the hammer arena teaches the wall
// line you'll need on the Ridge, and the long back stretch now pairs a
// slow roller with the pendulum. Boost rings and jinx orbs debut here too.
export function buildShore(R, world) {
  const c = newCourse(THEME_SHORE);
  const { ground, step, coinRow, decor, wall } = kit(R, world, c);

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
  // first chicane gate of the game: a generous 3.6m opening offset right
  // (the Ridge's canyon gates run a metre narrower), well before the
  // hammer — the weave lesson starts here. The narrows lead starts ~1.2m
  // ahead of the wall so queued runners steer early instead of parking on
  // the wall face (the lead trap).
  wall(-4.8, -0.9, 43.2, 44.0); wall(2.7, 4.8, 43.2, 44.0);
  c.narrows.push([42.0, 44.0, 1.8, 0.9]);
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
  // Shore v2 muscle: a slow roller sweeps the back straight while the
  // pendulum answers in counter-phase — a duet now, still gentle tempos.
  c.rollers.push(makeRoller(R, world, 68, { amp: 3.2, omega: 1.3 }));
  c.pendulums.push(makePendulum(R, world, 74, { omega: 1.7, phase: Math.PI }));

  // speed pickups: a free boost ring teaching the mechanic after the first
  // gap, a jinx orb lurking beside the pendulum for lane-grazers, and one
  // high up in the bounce-pad pocket for those who take the air route
  c.boosts.push({ x: 0, y: 1.5, z: 21, taken: false });
  c.curses.push({ x: 2.4, y: 1.4, z: 26.5, taken: false });
  c.boosts.push({ x: 3.2, y: 2.0, z: 66, taken: false });
  c.curses.push({ x: -2.2, y: 1.4, z: 71, taken: false });

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

// Sunset Ridge v2: the gauntlet learned to BEND. A canyon weave of
// alternating walls forces right-left-right chicanes over shoulder-less
// ground, a piston-slamming portcullis queues the pack at a one-lane slit,
// and THE NEEDLE — a single-file stone throat with wrecking balls dancing
// right behind it — decides who wears gold. passPlace stays 1: win it here.
export function buildRidge(R, world) {
  const c = newCourse(THEME_RIDGE);
  const { ground, coinRow, decor, wall } = kit(R, world, c);

  ground(0, 14);
  coinRow(4, 9, 3);
  // gap1: 2.5m
  coinRow(13.6, 16.2, 3, 1.25);
  ground(16.5, 24);
  c.rollers.push(makeRoller(R, world, 20, { amp: 3.2, omega: 1.7 }));
  coinRow(18, 22, 3, 0.9, 2);
  c.checkpoints.push({ z: 22, x: 0, y: 1.6 });

  // --- CANYON WEAVE: three alternating walls, NO shoulders (the void
  // polices the lanes), gaps alternate right/left. Gates ~3.2m wide —
  // tight enough that the pack strings out, forgiving enough that the
  // slowest tank can carve the crossing between walls.
  ground(24, 38, 0, -4.5, 4.5, 0);
  wall(-4.8, 0.3, 26.4, 27.4); wall(3.5, 5.2, 26.4, 27.4);   // gap right
  wall(-5.2, -3.5, 30.4, 31.4); wall(-0.3, 4.8, 30.4, 31.4); // gap left
  wall(-4.8, 0.3, 34.4, 35.4); wall(3.5, 5.2, 34.4, 35.4);   // gap right
  // NOTE: gated narrows start ~1.2m BEFORE the wall — autopilots steer
  // inside [z0,z1], and a hero touching the wall sits at wallZ−0.315, so
  // a too-late z0 lets rivals rest peacefully against the stones forever.
  c.narrows.push([24.9, 27.7, 1.3, 1.9], [28.9, 31.7, 1.3, -1.9],
    [32.9, 35.7, 1.3, 1.9]);
  coinRow(26.9, 26.9, 1, 0.9, 1.9);
  coinRow(30.9, 30.9, 1, 0.9, -1.9);
  coinRow(34.9, 34.9, 1, 0.9, 1.9);
  // gap out of the canyon: 2.5m
  coinRow(37.6, 40.2, 3, 1.25);

  // narrow ledge: NO shoulders — the void is the challenge, wind leans in
  ground(40.5, 47.5, 0, -3, 3, 0);
  c.winds.push(makeWind(R, world, 40.7, 47.3, { dir: 1, force: 2.2 }));
  c.narrows.push([40.3, 47.7, 1.8]);
  coinRow(41.5, 46.5, 3);
  // gap2: 3m
  coinRow(47.6, 50.8, 3, 1.25);
  ground(51, 57);
  c.pistons.push(makePiston(R, world, 54, { amp: 3.4, omega: 1.6 }));
  coinRow(52, 55, 3, 0.9, -2);
  // bobbing twin-pillar crossing (tops ≤0.9m; edges OVERLAP: never a seam)
  c.pillars.push(
    makePillar(R, world, 58.6, { y0: 0.3, amp: 0.3, omega: 1.8, phase: 0, half: 1.1, x: 0.2 }),
    makePillar(R, world, 61.2, { y0: 0.3, amp: 0.3, omega: 1.8, phase: Math.PI, half: 1.1, x: -0.2 }));
  coinRow(58, 61.4, 3, 1.7);
  ground(62.2, 66);
  c.crumbles.push(makeCrumble(R, world, 66, 68.6, { x0: -2.4, x1: 2.4 }));
  coinRow(63.5, 67, 3);
  c.checkpoints.push({ z: 52, x: 0, y: 1.6 }, { z: 63, x: 0, y: 1.6 });

  // --- PORTCULLIS: one-lane slit at x=-2, iron slams down on a 3.4s
  // cycle — the pack queues, times it, dives through together
  ground(68.6, 76);
  wall(-4.8, -2.65, 71, 72); wall(-1.35, 4.8, 71, 72);
  c.gates.push(makeGate(R, world, 71.5, { cx: -2, gw: 1.3, period: 3.4 }));
  c.narrows.push([69.9, 72.7, 0.55, -2]);
  coinRow(71.5, 71.5, 1, 0.9, -2);

  // ridge staircase: two 0.7m plateaus
  ground(76, 80, 0.7);
  coinRow(77, 79, 2, 1.7);
  ground(80, 84, 1.4);
  coinRow(81, 83, 2, 2.4);

  // --- THE NEEDLE: a 1.15m single-file throat, then a double pendulum
  // dancing out of it — no two racers exit the stones side by side
  ground(84, 100);
  wall(-4.8, -0.575, 86.5, 88.5); wall(0.575, 4.8, 86.5, 88.5);
  c.narrows.push([85.1, 88.7, 0.45, 0]);
  coinRow(87.5, 87.5, 1, 0.9, 0);
  c.pendulums.push(
    makePendulum(R, world, 90.8, { ampA: 1.05, omega: 2.3, phase: 0 }),
    makePendulum(R, world, 92.4, { ampA: 1.05, omega: 2.3, phase: Math.PI }));
  // final sweep hammer + run to the flag
  c.hammers.push(makeHammer(R, world, 95.5, 1.9, 0));
  coinRow(96.5, 98.5, 2, 0.9, 2.4);

  // speed pickups: a jinx squatting on the racing line out of the canyon,
  // another poisoning the portcullis queue — then the overtakes: a boost in
  // the open after the gate and one at the needle exit for the final sprint
  c.curses.push({ x: 0, y: 1.4, z: 41, taken: false });
  c.curses.push({ x: 1.2, y: 1.4, z: 66, taken: false });
  c.boosts.push({ x: -1.8, y: 1.5, z: 74, taken: false });
  c.boosts.push({ x: 0, y: 1.5, z: 93.6, taken: false });

  c.jumpZones.push(
    [13.2, 14.0], [37.7, 38.5], [47.2, 48.0],
    [56.2, 57.1], [58.8, 59.7], [61.2, 62.1],
    [75.2, 76.0], [79.2, 80.0],
  );
  c.finishZ = 99.5;
  c.spawn = { x: 0, y: 1.6, z: 0 };
  c.coinTotal = c.coins.length;

  for (let z = 6; z < 96; z += 14.5) {
    decor('palm', (z / 14.5 | 0) % 2 ? 6.6 : -6.6, z);
  }
  decor('rock', 5.8, 20); decor('rock', -6, 66); decor('rock', 6, 80);
  return c;
}

// ------------------------------------------------- STAGE 3: BUMPER ARENA

const THEME_ARENA = {
  sky: 0x8fd2e8, sand: 0xe8d9a8, sandDark: 0xc9b578, rock: 0x8b7d6a,
  wood: 0x8a5a33, sea: 0x1f7fbf, sun: 0xfff4d0, hemiGround: 0x6a7a6a,
};

// Survival, not a race: a candy platform over open water, a closing safety
// ring and waves of everything the hazard kit can throw. No rivals, no
// auto-run — free control (WASD), knockback without hearts: hits never kill,
// the WATER does. Outlive 90s of it and you are the Last Standing.
export function buildArena(R, world) {
  const c = newCourse(THEME_ARENA);
  c.isArena = true;

  // disc floor: one big cylinder collider, water far below the rim
  const b = world.createRigidBody(R.RigidBodyDesc.fixed()
    .setTranslation(0, -1, 0));
  world.createCollider(R.ColliderDesc.cylinder(1, ARENA.floorR), b);

  // waves (every 10s of the 60s run): two pendulums → log pair (x + z
  // sweepers) → center hammer → center pendulum → second hammer → z-log
  // duo. startT gates each group.
  c.pendulums.push(
    makePendulum(R, world, -4, { ampA: 1.15, omega: 1.9, phase: 0, startT: 0 }),
    makePendulum(R, world, 4, { ampA: 1.15, omega: 1.9, phase: Math.PI, startT: 0 }),
    makePendulum(R, world, 0, { ampA: 0.9, omega: 2.3, phase: 0.6, startT: 30 }),
  );
  c.rollers.push(
    makeRoller(R, world, 0, { amp: 5.2, omega: 1.2, ax: 'x', startT: 10 }),
    makeRoller(R, world, 0, { amp: 5.0, omega: 1.4, phase: Math.PI / 2, ax: 'z', startT: 10 }),
    makeRoller(R, world, 0, { amp: 4.2, omega: 1.6, phase: Math.PI, ax: 'z', startT: 50 }),
  );
  c.hammers.push(
    makeHammer(R, world, 0, 1.3, 0, 2.6),
    makeHammer(R, world, 0, 1.7, Math.PI / 2, 2.4),
  );
  c.hammers[0].startT = 20;
  c.hammers[1].startT = 40;

  c.spawn = { x: 0, y: 1.6, z: -7 };
  c.finishZ = Infinity;      // survival: there is no flag, only the clock
  c.coinTotal = 0;
  c.ringR = ARENA.startR;
  return c;
}

// ---------------------------------------------------------------- shared

// advance kinematic hazards; call before world.step() each tick. Also
// re-derives each hazard's axis-aligned damage box (harm) and, for
// crumbles, the stand-on timer. Pass a hero (player or rival) to trigger
// crumbles; the reachability bot omits it.
export function courseStep(R, course, frame, hero = null) {
  const t = frame / 60;
  // geometry-only probe (Game's hazardsOff passes hero = null): park every
  // MOVING hazard body below the world so bots measure the platform, not
  // the timing lottery. The hammer and portcullis are real colliders and
  // would otherwise body-check bots — or miss them — at random phases.
  if (!hero) {
    const park = (b) => {
      const p = b.translation();
      b.setNextKinematicTranslation({ x: p.x, y: -40, z: p.z });
    };
    for (const h of course.hammers) park(h.body);
    for (const p of course.pillars) park(p.body);
    for (const p of course.pendulums) park(p.body);
    for (const r of course.rollers) park(r.body);
    for (const p of course.pistons) park(p.body);
    for (const g of course.gates) park(g.body);
    return;
  }
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
  for (const g of course.gates) {
    const s = Math.sin((t / g.period) * Math.PI * 2 + g.phase);
    g.lift = Math.max(0, s) * (g.h + 0.4);
    g.open = g.lift > g.h * 0.55;
    g.body.setNextKinematicTranslation({ x: g.cx, y: g.h / 2 + g.lift, z: g.z });
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

// ---- survival arena ---------------------------------------------------------
// The ring closes linearly from startR to endR over `dur` seconds; outside
// it is water. Pure function so game + tests + renderer agree every frame.
export const ARENA = {
  dur: 60, waveLen: 10, waves: 6, startR: 10.6, endR: 4.6, floorR: 12,
  hearts: 4,          // flat heart pool for every hero — leaderboard fair
  ringR: (t) => ARENA.startR
    - (ARENA.startR - ARENA.endR) * Math.min(1, t / ARENA.dur),
};

// Kinematic motion for the arena with a rising tempo: hazards keep their own
// phase accumulator (a plain t·ω·ramp would jump the sine when the ramp
// changes), park OFF-STAGE (y=-40, bx=999) until their wave, and never
// respawn once live.
export function arenaStep(course, frame) {
  const dt = 1 / 60;
  const t = frame / 60;
  const m = 1 + Math.min(t / ARENA.dur, 1) * 0.8;    // tempo ramps to 1.8×
  course.wave = Math.min(ARENA.waves, 1 + Math.floor(t / ARENA.waveLen));
  const park = (b) => b.setNextKinematicTranslation({ x: 0, y: -40, z: 0 });
  for (const p of course.pendulums) {
    if (t < p.startT) { p.active = false; p.bx = 999; park(p.body); continue; }
    p.active = true;
    p.th += p.omega * m * dt;
    const th = p.ampA * Math.sin(p.th);
    p.bx = Math.sin(th) * p.L;
    p.by = p.pivY - Math.cos(th) * p.L;
    p.vel = Math.cos(p.th);
    p.body.setNextKinematicTranslation({ x: p.bx, y: p.by, z: p.z });
  }
  for (const r of course.rollers) {
    if (t < r.startT) { r.active = false; r.bx = 999; r.bz = 999; park(r.body); continue; }
    r.active = true;
    r.th += r.omega * m * dt;
    const s = Math.sin(r.th);
    r.vel = Math.cos(r.th);
    r.bx = r.ax === 'z' ? 0 : s * r.amp;
    r.bz = r.ax === 'z' ? s * r.amp : 0;
    r.body.setNextKinematicTranslation({
      x: r.bx, y: r.r, z: r.z + (r.bz === 999 ? 0 : r.bz),
    });
  }
  for (const h of course.hammers) {
    if (t < h.startT) { h.active = false; h.harm = 999; park(h.body); continue; }
    h.active = true;
    h.th += h.omega * m * dt;
    h.harm = h.th;
    h.body.setNextKinematicRotation({ x: 0, y: Math.sin(h.th / 2), z: 0,
      w: Math.cos(h.th / 2) });
    h.body.setNextKinematicTranslation({ x: 0, y: 0, z: h.z });
  }
}

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
    if (h.active === false) continue;
    const dx = pos.x, dz = pos.z - h.z, a = h.harm || 0;
    const ux = Math.cos(a), uz = -Math.sin(a);       // along the bar
    const nx = Math.sin(a), nz = Math.cos(a);        // bar normal
    const along = dx * ux + dz * uz;
    const perp = dx * nx + dz * nz;
    if (Math.abs(perp) < 0.27 + R_ && along > -1.6
      && along < (h.len ?? 3.1) * 1.5 + 0.05)
      return { kx: nx * Math.sign(perp || 1) * 6, kz: nz * Math.sign(perp || 1) * 6 };
  }
  for (const p of course.pendulums) {
    if (p.active === false) continue;
    const dx = pos.x - p.bx, dy = pos.y - p.by, dz = pos.z - p.z;
    if (Math.hypot(dx, dy, dz) < p.r + R_)
      return { kx: Math.sign(p.vel) * 6.2, kz: -2.5 };
  }
  for (const r of course.rollers) {
    if (r.active === false) continue;
    if (Math.abs(pos.x - r.bx) < 0.62 + R_
      && Math.abs(pos.z - r.z - (r.bz || 0)) < r.r + R_)
      return { kx: Math.sign(r.vel) * 5.8, kz: -3 };
  }
  for (const p of course.pistons) {
    if (p.active === false) continue;
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
// without punishing learning the course. mode 'survival' levels ignore the
// clock/flag: they END when the ring swallows you (over) or 90s pass (win).
export const LEVELS = [
  { id: 'shore', nameKey: 'level.beach', build: buildShore, theme: THEME_SHORE,
    timeLimit: 45, passPlace: 3 },
  { id: 'ridge', nameKey: 'level.ridge', build: buildRidge, theme: THEME_RIDGE,
    timeLimit: 90, passPlace: 1 },
  { id: 'arena', nameKey: 'level.arena', build: buildArena, theme: THEME_ARENA,
    mode: 'survival', passPlace: 99 },
];
