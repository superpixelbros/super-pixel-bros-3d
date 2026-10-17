// The course: one Crash-style corridor running along +Z — "Sunny Shore".
// Pure logic: builds Rapier colliders + data lists (coins, checkpoints,
// decor) that the renderer turns into meshes. Gaps respect the worst-hero
// rule: Faris (slowest) clears ≈3.6m, so bare gaps are ≤3m and anything
// wider is bridged by a bobbing pillar within reach.

const GROUND_HALF = 1;         // ground slabs are 2m thick
const SPAWN = { x: 0, y: 1.6, z: -3 };

export function buildCourse(R, world) {
  const c = {
    segs: [], steps: [], shoulders: [], coins: [], hammers: [], pillars: [],
    checkpoints: [
      { z: 28, x: 0, y: 1.6 },
      { z: 66, x: 0, y: 1.6 },
    ],
    decor: [],
    finishZ: 88.5,
    spawn: { ...SPAWN },
    coinTotal: 0,
  };

  const ground = (z0, z1, top = 0, x0 = -4.5, x1 = 4.5) => {
    // one solid slab wide enough to carry the shoulder terrain (palms/rocks)
    const sx0 = x0 - 4.5, sx1 = x1 + 4.5;
    const b = world.createRigidBody(R.RigidBodyDesc.fixed()
      .setTranslation(0, top - GROUND_HALF, (z0 + z1) / 2));
    world.createCollider(R.ColliderDesc.cuboid((sx1 - sx0) / 2, GROUND_HALF,
      (z1 - z0) / 2), b);
    c.segs.push({ x0, x1, z0, z1, top });
    c.shoulders.push({ x0: sx0, x1: x0, z0, z1, top }, { x0: x1, x1: sx1, z0, z1, top });
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

  // ---- layout (z increases toward the flag) --------------------------------
  ground(-18, 16);                     // opening stretch (menu pedestal at -14)
  coinRow(4, 10, 4);
  // gap 16→19 (3m, everyone clears it), coin arc
  coinRow(16.4, 18.6, 3, 1.3);
  ground(19, 40);                     // checkpoint 1 at z=28
  coinRow(22, 26, 3);
  step(-2.2, 2.2, 30.5, 33.5, 0.7);   // two hop-steps up (Sahm-safe ≤0.7)
  step(-2.2, 2.2, 33.5, 36.5, 1.4);
  coinRow(31.5, 35.5, 3, 2.4);
  ground(40, 52);                     // hammer arena (z≈46)
  c.hammers.push(makeHammer(R, world, 46, 1.5));
  coinRow(41.5, 44.5, 2, 0.9, 3);
  // wide gap 52→57 bridged by a bobbing pillar
  c.pillars.push(makePillar(R, world, 54.5, 0.3));
  coinRow(53.4, 55.6, 3, 2.1);
  ground(57, 88);                     // long run home, checkpoint 2 at 66
  coinRow(60, 64, 3);
  coinRow(70, 78, 5, 0.9, -2.4);
  coinRow(70, 78, 5, 0.9, 2.4);
  c.coinTotal = c.coins.length;

  // palms + rocks for the renderer to decorate the shoulders
  for (let z = 2; z < 86; z += 9.3) {
    c.decor.push({ kind: 'palm', x: z % 2 < 1 ? -6.4 : 6.4, z });
  }
  c.decor.push({ kind: 'rock', x: 5.6, z: 12 }, { kind: 'rock', x: -5.8, z: 63 });

  return c;
}

function makeHammer(R, world, z, speed) {
  const body = world.createRigidBody(
    R.RigidBodyDesc.kinematicPositionBased().setTranslation(0, 0, z));
  // arm reaches from the pivot out to |x|≈4.65 — wider than the path, so
  // the answer is always "jump it", Stumble-Guys style
  world.createCollider(
    R.ColliderDesc.cuboid(3.1, 0.27, 0.27)
      .setTranslation(1.55, 0.55, 0), body);
  return { body, z, omega: speed, phase: 0 };
}

function makePillar(R, world, z, phase) {
  const body = world.createRigidBody(
    R.RigidBodyDesc.kinematicPositionBased().setTranslation(0.4, 0.55, z));
  world.createCollider(R.ColliderDesc.cuboid(0.9, 0.35, 0.9), body);
  return { body, z, phase, y0: 0.55, amp: 0.45, omega: 2.0 };
}

// advance kinematic hazards; call before world.step() each tick
export function courseStep(R, course, frame) {
  const t = frame / 60;
  for (const h of course.hammers) {
    const a = t * h.omega + h.phase;
    h.body.setNextKinematicRotation({ x: 0, y: Math.sin(a / 2), z: 0, w: Math.cos(a / 2) });
  }
  for (const p of course.pillars) {
    const y = p.y0 + Math.sin(t * p.omega + p.phase) * p.amp;
    const q = p.body.translation();
    p.body.setNextKinematicTranslation({ x: q.x, y, z: q.z });
  }
}

export { SPAWN };
