// Game: state machine + the run itself. Holds the physics world, the
// course, and the player; steps them on a fixed timestep fed by main.js.
// No three.js / DOM here — headless checks import this module directly.

import { createWorld } from './phys.js';
import { Player, HERO_IDS } from './hero.js';
import { buildCourse, courseStep } from './course.js';

export default class Game {
  constructor(RAPIER) {
    this.R = RAPIER;
    this.state = 'title';
    this.heroIndex = 0;
    this.world = null;
    this.course = null;
    this.player = null;
  }

  selectedHero() { return HERO_IDS[this.heroIndex]; }

  moveCursor(d) {
    this.heroIndex = (this.heroIndex + d + HERO_IDS.length) % HERO_IDS.length;
  }

  // (re)build a fresh world for one run — cheap and leak-free because the
  // renderer rebuilds its meshes from the new course right after
  start(heroId) {
    this.disposeWorld();
    this.world = createWorld(this.R);
    this.course = buildCourse(this.R, this.world);
    this.player = new Player(this.R, this.world, heroId, this.course.spawn);
    this.frame = 0;
    this.timeF = 0;
    this.coins = 0;
    this.deaths = 0;
    this.bestSpawn = { ...this.course.spawn };
    this.state = 'play';
  }

  step(flags) {
    if (this.state !== 'play' || !this.player) return;
    this.frame++;
    this.timeF++;
    courseStep(this.R, this.course, this.frame);
    this.player.step(flags);
    this.world.step();

    const p = this.player.pos;
    // coins: simple proximity to the capsule center
    for (const c of this.course.coins) {
      if (c.taken) continue;
      const dx = p.x - c.x, dy = p.y - c.y, dz = p.z - c.z;
      if (dx * dx + dy * dy + dz * dz < 1.1) { c.taken = true; this.coins++; }
    }
    // checkpoints
    for (const cp of this.course.checkpoints) {
      if (p.z > cp.z && (this.bestSpawn.z ?? -999) < cp.z) {
        this.bestSpawn = { x: cp.x, y: cp.y, z: cp.z };
        this.player.spawn = this.bestSpawn;
      }
    }
    // fell off the world
    if (p.y < -12) {
      this.deaths++;
      this.player.respawn();
    }
    // flag
    if (p.z >= this.course.finishZ) {
      this.clearTime = this.timeF / 60;
      this.state = 'clear';
    }
  }

  pause() { if (this.state === 'play') this.state = 'pause'; }
  resume() { if (this.state === 'pause') this.state = 'play'; }
  toTitle() { this.disposeWorld(); this.state = 'title'; }

  disposeWorld() {
    if (this.world) {
      try { this.world.free(); } catch { /* already gone */ }
    }
    this.world = null;
    this.course = null;
    this.player = null;
  }
}
