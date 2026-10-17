// Physics bootstrap: Rapier (vendored, self-contained WASM) at a fixed
// 60 Hz timestep — same "physics values are px/frame-ish at 60Hz" spirit
// as the 2D game, but in metres/second. 1 metre ≈ 2 hero-heights/3.

import RAPIER from '../vendor/rapier.mjs';

export const STEP = 1 / 60;
export const GRAVITY = { x: 0, y: -26, z: 0 };

export async function initPhysics() {
  await RAPIER.init();
  return RAPIER;
}

export function createWorld(RAPIER) {
  const world = new RAPIER.World(GRAVITY);
  world.timestep = STEP;
  return world;
}
