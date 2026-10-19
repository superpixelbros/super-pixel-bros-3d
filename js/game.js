// Game: state machine + the run itself. Holds the physics world, the
// course, and the player; steps them on a fixed timestep fed by main.js.
// No three.js / DOM here — headless checks import this module directly.
//
// States: title → select → map → play ⇄ pause → clear → map … → victory.
// Terminal fail states: 'dq' (time limit) and 'lost' (placement gate) —
// both offer retry / title and keep rendering the live world behind them.
// The map is pure logic here (cursor + hero-walk tween); the diorama is
// the renderer's job.

import { createWorld } from './phys.js';
import { Player, HERO_IDS, CHARACTERS } from './hero.js';
import { LEVELS, courseStep, hazardTouch, windAt } from './levels.js';
import { makeRivals, placement } from './rivals.js';

export default class Game {
  constructor(RAPIER) {
    this.R = RAPIER;
    this.state = 'title';
    this.heroIndex = 0;
    this.world = null;
    this.course = null;
    this.player = null;
    this.frontier = 0;                   // highest stage unlocked to play
    this.levelIndex = 0;
    this.map = { cursor: 0, walk: null }; // walk: {from, to, t 0..1}
    this.sfx = () => {};                 // main.js injects the audio hook
    this.hazardsOff = false;             // geometry-only bots (headless)
    this.gatesOff = false;               // race-rule gates off for bots
  }

  selectedHero() { return HERO_IDS[this.heroIndex]; }
  isLastStage() { return this.levelIndex >= LEVELS.length - 1; }

  moveCursor(d) {
    this.heroIndex = (this.heroIndex + d + HERO_IDS.length) % HERO_IDS.length;
  }

  // ---- adventure map (pure logic) --------------------------------------
  // fromStart (title → select → map): the cursor always begins at stage 1;
  // unlocks are kept, the player may move anywhere up to the frontier.
  enterMap(fromStart = false) {
    this.map.cursor = fromStart ? 0 : this.frontier;
    this.map.walk = null;
    this.disposeWorld();
    this.state = 'map';
  }

  mapMove(d) {
    if (this.map.walk) return;
    this.map.cursor = Math.max(0, Math.min(this.frontier, this.map.cursor + d));
  }

  // after clearing a stage: walk the hero onward, or win the trophy
  advanceFrontier() {
    if (this.isLastStage()) {
      this.state = 'victory';
      return 'victory';
    }
    this.map.walk = { from: this.levelIndex, to: this.levelIndex + 1, t: 0 };
    this.frontier = Math.max(this.frontier, this.levelIndex + 1);
    this.map.cursor = this.frontier;
    this.state = 'map';
    return 'map';
  }

  // called every frame while on the map (walk tween at ~1.4s per hop)
  mapStep() {
    if (!this.map.walk) return;
    this.map.walk.t = Math.min(1, this.map.walk.t + 1 / 84);
    if (this.map.walk.t >= 1) this.map.walk = null;
  }

  // node position for the diorama: node i at x = i * 6, walking eased
  mapHeroPos() {
    const w = this.map.walk;
    if (!w) return { x: this.map.cursor * 6, walking: false };
    const e = w.t < 0.5 ? 2 * w.t * w.t : 1 - (1 - w.t) ** 2 * 2; // easeInOut
    return {
      x: (w.from + (w.to - w.from) * e) * 6,
      walking: w.t < 1,
    };
  }

  // ---- one run -----------------------------------------------------------
  // (re)builds a fresh world; the renderer rebuilds meshes right after
  start(levelIndex = this.levelIndex) {
    this.disposeWorld();
    this.levelIndex = levelIndex;
    this.world = createWorld(this.R);
    this.course = LEVELS[levelIndex].build(this.R, this.world);
    this.player = new Player(this.R, this.world, this.selectedHero(),
      this.course.spawn);
    this.rivals = makeRivals(this.R, this.world, this.course,
      CHARACTERS[this.selectedHero()]);
    this.frame = 0;
    this.timeF = 0;
    this.coins = 0;
    this.deaths = 0;
    this.timeLimit = LEVELS[levelIndex].timeLimit;
    this.tickAt = 0;
    this.bestSpawn = { ...this.course.spawn };
    this.state = 'play';
  }

  step(flags) {
    if (this.state !== 'play' || !this.player) return;
    const P = this.player;
    this.frame++;
    this.timeF++;
    courseStep(this.R, this.course, this.frame, this.hazardsOff ? null : P);
    // drop given-way crumble slabs out of the physics world (safe between
    // steps; the mesh keeps falling visually via fallT)
    for (const c of this.course.crumbles) {
      if (c.gone && !c.removed) { c.removed = true; this.world.removeRigidBody(c.body); }
    }

    if (!this.hazardsOff) flags = { ...flags, windX: windAt(this.course, P.pos) };
    if (flags.spin) this.sfx('spin');
    P.step(flags);
    if (P.jumped) this.sfx('jump');
    if (P.landed) this.sfx('land');
    for (const r of this.rivals) {
      r.step(this.course, this.frame, this.timeF / 60, !this.hazardsOff);
    }
    this.world.step();

    const p = P.pos;
    if (!this.hazardsOff) {
      // bounce pads launch on contact (before damage so you don't eat a hit
      // the same frame you got a lift)
      for (const b of this.course.bounces) {
        if (P.vy <= 0.1 && p.y < 1.5 &&
          Math.hypot(p.x - b.x, p.z - b.z) < b.r) {
          P.bounce(b.up); this.sfx('bounce');
        }
      }
      // damaging hazards → hearts + knockback; a lethal hit respawns
      const k = hazardTouch(this.course, p);
      if (k) {
        const res = P.hurt(k.kx, k.kz);
        if (res === 'hit') this.sfx('hit');
        else if (res === 'dead') { this.sfx('die'); P.respawn(); this.deaths++; }
      }
    }
    // coins: simple proximity to the capsule center
    for (const c of this.course.coins) {
      if (c.taken) continue;
      const dx = p.x - c.x, dy = p.y - c.y, dz = p.z - c.z;
      if (dx * dx + dy * dy + dz * dz < 1.1) {
        c.taken = true; this.coins++; this.sfx('coin');
      }
    }
    // checkpoints
    for (const cp of this.course.checkpoints) {
      if (p.z > cp.z && (this.bestSpawn.z ?? -999) < cp.z) {
        this.bestSpawn = { x: cp.x, y: cp.y, z: cp.z };
        this.player.spawn = this.bestSpawn;
        this.sfx('checkpoint');
      }
    }
    // fell off the world
    if (p.y < -12) {
      this.deaths++;
      this.sfx('fall');
      this.player.respawn();
    }
    // flag wins before the clock
    if (p.z >= this.course.finishZ) {
      this.clearTime = this.timeF / 60;
      this.clearPlace = placement(this);
      // each stage allows a worst place (Shore: top 3 of 4, Ridge: must
      // win) — finishing worse than that ends the run, not just the stage
      if (!this.gatesOff &&
        this.clearPlace > LEVELS[this.levelIndex].passPlace) {
        this.state = 'lost';
        this.sfx('gameover');
        return;
      }
      this.state = 'clear';
      this.sfx('clear');
      return;
    }
    // the clock: ticking under 5s, disqualification at zero
    const rem = this.timeLimit - this.timeF / 60;
    if (rem <= 0) {
      this.state = 'dq';
      this.sfx('gameover');
    } else if (rem <= 5 && this.timeF >= this.tickAt) {
      this.tickAt = this.timeF + 60;
      this.sfx('tick');
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

export { LEVELS };
