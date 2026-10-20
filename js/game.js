// Game: state machine + the run itself. Holds the physics world, the
// course, and the player; steps them on a fixed timestep fed by main.js.
// No three.js / DOM here — headless checks import this module directly.
//
// States: title → select → map → play ⇄ pause → clear → map … → victory.
// Terminal fail states: 'dq' (time limit), 'lost' (placement gate), and —
// survival mode only — 'over' (ring took you, or the hearts ran out); 'win'
// is the arena's 60-second Last-Standing ending, the gate to the trophy.
// The map is pure logic here (cursor + hero-walk tween); the diorama is
// the renderer's job.

import { createWorld } from './phys.js';
import { Player, HERO_IDS, CHARACTERS } from './hero.js';
import { LEVELS, courseStep, hazardTouch, windAt, arenaStep, ARENA } from './levels.js';
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
    this.mode = 'race';                  // 'race' | 'survival' (per level)
    this.rivals = [];
    this.wave = 1;                       // survival wave (HUD)
  }

  selectedHero() { return HERO_IDS[this.heroIndex]; }

  // every RACING stage beaten? frontier only moves by clearing, so it must
  // sit past the last race stop. The trophy is the arena prize — but it is
  // only raised with the whole race ladder done.
  allRacesCleared() {
    for (let i = 0; i < LEVELS.length; i++) {
      if ((LEVELS[i].mode || 'race') !== 'survival' && this.frontier < i + 1) {
        return false;
      }
    }
    return true;
  }

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
    let hi = this.frontier;
    // survival challenge nodes are ALWAYS visitable, unlocks be damned —
    // the arena is a pub challenge, not a frontier stage
    for (let i = 0; i < LEVELS.length; i++) {
      if ((LEVELS[i].mode || 'race') === 'survival') hi = Math.max(hi, i);
    }
    let next = Math.max(0, Math.min(hi, this.map.cursor + d));
    const locked = (i) => i > this.frontier &&
      (LEVELS[i].mode || 'race') !== 'survival';
    // skim past locked stages on the way to a challenge node, never park
    // on one that is locked
    while (next > 0 && next < hi && locked(next)) next += d > 0 ? 1 : -1;
    if (locked(next)) next = this.map.cursor;
    this.map.cursor = next;
  }

  // after clearing a stage: walk the hero onward — race stages into the
  // next node (the arena included), no early trophy. The victory screen
  // lives behind claimVictory() on the arena's win card.
  advanceFrontier() {
    const to = this.levelIndex + 1;
    this.map.walk = { from: this.levelIndex, to, t: 0 };
    this.frontier = Math.max(this.frontier, to);
    this.map.cursor = this.frontier;
    this.state = 'map';
    return 'map';
  }

  // ENTER on the arena's win card: trophy if the race ladder is done,
  // otherwise back to the map with a reminder of what is still owed.
  claimVictory() {
    this.disposeWorld();
    if (this.allRacesCleared()) { this.state = 'victory'; return 'victory'; }
    this.enterMap(false);
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
    const def = LEVELS[levelIndex];
    this.mode = def.mode || 'race';
    this.world = createWorld(this.R);
    this.course = def.build(this.R, this.world);
    this.player = new Player(this.R, this.world, this.selectedHero(),
      this.course.spawn);
    // survival = free control: no auto-run, WASD in two axes, hits shove
    // AND bite — a flat 4-heart pool for every hero keeps the leaderboard
    // honest (identity lives in grip, not in hit points, in here)
    this.player.free = this.mode === 'survival';
    if (this.mode === 'survival') {
      this.player.maxHp = ARENA.hearts;
      this.player.hp = ARENA.hearts;
    }
    this.rivals = this.mode === 'survival' ? []
      : makeRivals(this.R, this.world, this.course,
        CHARACTERS[this.selectedHero()]);
    this.frame = 0;
    this.timeF = 0;
    this.coins = 0;
    this.deaths = 0;
    this.timeLimit = def.timeLimit || 0;
    this.tickAt = 0;
    this.bestSpawn = { ...this.course.spawn };
    this.wave = 1;
    this.ringR = this.course.ringR;
    this.state = 'play';
  }

  step(flags) {
    if (this.state !== 'play' || !this.player) return;
    const P = this.player;
    this.frame++;
    this.timeF++;
    if (this.mode === 'survival') { this.stepSurvival(flags); return; }
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
    // speed pickups: boost rings and jinx orbs catch EVERY runner — hero
    // and rivals share the same luck (bot reachability runs set pickupsOff)
    if (!this.pickupsOff) {
      const runners = [P];
      for (const r of this.rivals) runners.push(r.player);
      for (const kind of [1, -1]) {
        const arr = kind > 0 ? this.course.boosts : this.course.curses;
        for (const u of arr) {
          if (u.taken) continue;
          for (const q of runners) {
            if (q.dead) continue;
            const w = q.pos;
            const dx = w.x - u.x, dy = w.y - u.y, dz = w.z - u.z;
            if (dx * dx + dy * dy + dz * dz < 1.5) {
              u.taken = true;
              q.applyMod(kind);
              if (q === P) this.sfx(kind > 0 ? 'boost' : 'jinx');
              break;
            }
          }
        }
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

  // ---- survival (Bumper Arena) ------------------------------------------
  // No flag, no rivals: the ring closes, the waves escalate, and every hit
  // costs a heart on top of the knockback. Out of the ring = over; hearts
  // at zero = over; ARENA.dur (60s) alive = win.
  stepSurvival(flags) {
    const P = this.player;
    const t = this.timeF / 60;
    arenaStep(this.course, this.frame);
    if (this.course.wave > this.wave) { this.wave = this.course.wave; this.sfx('wave'); }
    this.ringR = ARENA.ringR(t);
    this.course.ringR = this.ringR;
    if (flags.spin) this.sfx('spin');
    P.step(flags);
    this.world.step();

    const p = P.pos;
    // hits bite now: knockback toward the water AND a heart off the pool.
    // hurt() carries the 1.2s mercy window, so no chip-damage spirals.
    const k = this.hazardsOff ? null : hazardTouch(this.course, p);
    if (k) {
      const res = P.hurt(k.kx * 1.4, k.kz * 1.4, 4.6);
      if (res === 'hit') this.sfx('hit');
      else if (res === 'dead') {
        this.survTime = t;
        this.sfx('die'); this.sfx('gameover');
        this.state = 'over';
        return;
      }
    }
    // the ring is the whole game: past it, the sea takes you
    if (Math.hypot(p.x, p.z) > this.ringR - 0.1 || p.y < -4) {
      this.survTime = t;
      this.sfx('fall'); this.sfx('gameover');
      this.state = 'over';
      return;
    }
    // the final buzzer: outlast the whole closing ring → the win card
    if (t >= ARENA.dur) {
      this.survTime = ARENA.dur;
      this.sfx('clear');
      this.state = 'win';
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
