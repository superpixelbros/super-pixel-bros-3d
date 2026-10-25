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
import {
  LEVELS, courseStep, hazardTouch, windAt, arenaStep, ARENA,
  crateStep, CRATES, MAP_SPACING,
} from './levels.js';
import { makeRivals } from './rivals.js';

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
    this.mode = 'race';                  // 'race' | 'survival' | 'crates'
    this.rivals = [];
    this.wave = 1;                       // survival wave (HUD)
    // two-player: up to two local runners share the stage. `player` is
    // always P1; `players` holds both; `runs` carries per-player progress
    // (coins, deaths, checkpoint, finish) so nothing leaks between them.
    this.twoPlayer = false;
    this.hero2Index = 1;
    this.players = [];
    this.runs = [];
  }

  selectedHero2() { return HERO_IDS[this.hero2Index]; }

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
    const to = Math.min(this.levelIndex + 1, LEVELS.length - 1);
    this.map.walk = { from: this.levelIndex, to, t: 0 };
    this.frontier = Math.max(this.frontier, to);
    // land on the NEXT node — not on the frontier. A saved frontier from
    // an older ladder must never hop the hero past the stage they just
    // unlocked (clearing stage 1 walks to stage 2, full stop).
    this.map.cursor = to;
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

  // node position for the diorama: node i at x = i * MAP_SPACING, walking eased
  mapHeroPos() {
    const w = this.map.walk;
    if (!w) return { x: this.map.cursor * MAP_SPACING, walking: false };
    const e = w.t < 0.5 ? 2 * w.t * w.t : 1 - (1 - w.t) ** 2 * 2; // easeInOut
    return {
      x: (w.from + (w.to - w.from) * e) * MAP_SPACING,
      walking: w.t < 1,
    };
  }

  // ---- one run -----------------------------------------------------------
  // (re)builds a fresh world; the renderer rebuilds meshes right after
  start(levelIndex = this.levelIndex, opts = {}) {
    this.disposeWorld();
    if (opts.twoPlayer != null) this.twoPlayer = !!opts.twoPlayer;
    if (opts.hero2Index != null) this.hero2Index = opts.hero2Index;
    this.levelIndex = levelIndex;
    const def = LEVELS[levelIndex];
    this.mode = def.mode || 'race';
    this.world = createWorld(this.R);
    this.course = def.build(this.R, this.world);

    // spawns: crates uses its dry-deck pads; races put P2 on P1's shoulder
    const pads = this.course.spawnPads;
    const spawn1 = pads ? { x: pads[0][0], y: 1.6, z: pads[0][1] }
      : { ...this.course.spawn };
    const spawn2 = pads ? { x: pads[1][0], y: 1.6, z: pads[1][1] }
      : { x: this.course.spawn.x + 0.9, y: this.course.spawn.y,
          z: this.course.spawn.z };

    this.player = new Player(this.R, this.world, this.selectedHero(), spawn1);
    this.players = [this.player];
    if (this.twoPlayer) {
      this.players.push(new Player(this.R, this.world, this.selectedHero2(),
        spawn2));
    }
    // survival & crates = free control: no auto-run, WASD in two axes.
    // Survival hits bite (a flat heart pool keeps the leaderboard honest);
    // crates don't do hearts at all — the SEA is the only judge.
    for (const P of this.players) {
      P.free = this.mode !== 'race';
      if (P.free) P.autoRun = false;
      if (this.mode === 'survival') {
        P.maxHp = ARENA.hearts;
        P.hp = ARENA.hearts;
      } else if (this.mode === 'crates') {
        P.maxHp = 99;                   // splash = out, hearts don't apply
        P.hp = 99;
      }
    }
    // crates races AGAINST the rivals (last one dry wins); survival is a
    // solo pub challenge. Rivals take the pads after every human player.
    this.rivals = this.mode === 'survival' ? []
      : makeRivals(this.R, this.world, this.course,
        CHARACTERS[this.selectedHero()], this.course.spawnPads,
        this.players.length);
    if (this.mode === 'crates') {
      for (const r of this.rivals) { r.player.free = true; r.player.autoRun = false; }
    }
    // per-player progress: nothing is shared between P1 and P2
    this.runs = this.players.map((P) => ({
      P, coins: 0, deaths: 0, finished: false, clearTime: 0, aiPlace: 1,
      out: false, survived: false, bestSpawn: { ...P.spawn },
    }));
    this.frame = 0;
    this.timeF = 0;
    this.coins = 0;                      // P1 mirrors (HUD / headless)
    this.deaths = 0;
    this.timeLimit = def.timeLimit || 0;
    this.tickAt = 0;
    this.bestSpawn = { ...this.course.spawn };
    this.wave = 1;
    this.cratesLeft = this.course.crates ? this.course.crates.length : 0;
    this.ringR = this.course.ringR;
    this.state = 'play';
  }

  // placement against the AI FIELD only (1..4). The other human is a team
  // mate for gate purposes: on a must-win stage P1 1st + P2 2nd both pass.
  aiPlace(run) {
    const z = run.P.pos.z;
    let ahead = 0;
    for (const r of this.rivals) {
      if (r.finished || r.player.pos.z > z) ahead++;
    }
    return ahead + 1;
  }

  step(flags) {
    if (this.state !== 'play' || !this.player) return;
    this.frame++;
    this.timeF++;
    const fl = Array.isArray(flags) ? flags : [flags];
    if (this.mode === 'survival') { this.stepSurvival(fl); return; }
    if (this.mode === 'crates') { this.stepCrates(fl); return; }
    courseStep(this.R, this.course, this.frame,
      this.hazardsOff ? null : this.player);
    // drop given-way crumble slabs out of the physics world (safe between
    // steps; the mesh keeps falling visually via fallT)
    for (const c of this.course.crumbles) {
      if (c.gone && !c.removed) { c.removed = true; this.world.removeRigidBody(c.body); }
    }

    // physics for every human runner (finished runners idle at the flag)
    this.runs.forEach((run, i) => {
      const f = fl[i] || fl[0];
      if (run.finished) {
        run.P.step({ x: 0, z: 0, jump: false, jumpHeld: false, spin: false });
        return;
      }
      const ff = this.hazardsOff ? f
        : { ...f, windX: windAt(this.course, run.P.pos) };
      if (ff.spin && i === 0) this.sfx('spin');
      run.P.step(ff);
      if (i === 0 && run.P.jumped) this.sfx('jump');
      if (i === 0 && run.P.landed) this.sfx('land');
    });
    for (const r of this.rivals) {
      r.step(this.course, this.frame, this.timeF / 60, !this.hazardsOff);
    }
    this.world.step();

    // per-runner rules: bounces, hazards, coins, checkpoints, falls, flag
    for (const run of this.runs) {
      if (run.finished) continue;
      const P = run.P;
      const p = P.pos;
      const first = run === this.runs[0];
      if (!this.hazardsOff) {
        // bounce pads launch on contact (before damage so you don't eat a
        // hit the same frame you got a lift)
        for (const b of this.course.bounces) {
          if (P.vy <= 0.1 && p.y < 1.5 &&
            Math.hypot(p.x - b.x, p.z - b.z) < b.r) {
            P.bounce(b.up);
            if (first) this.sfx('bounce');
          }
        }
        // damaging hazards → hearts + knockback; a lethal hit respawns
        const k = hazardTouch(this.course, p);
        if (k) {
          const res = P.hurt(k.kx, k.kz);
          if (res === 'hit') { if (first) this.sfx('hit'); }
          else if (res === 'dead') {
            if (first) this.sfx('die');
            P.respawn(); run.deaths++;
            if (first) this.deaths = run.deaths;
          }
        }
      }
      // coins are personal
      for (const c of this.course.coins) {
        if (c.taken) continue;
        const dx = p.x - c.x, dy = p.y - c.y, dz = p.z - c.z;
        if (dx * dx + dy * dy + dz * dz < 1.1) {
          c.taken = true; run.coins++;
          if (first) { this.coins = run.coins; this.sfx('coin'); }
        }
      }
      // checkpoints are personal
      for (const cp of this.course.checkpoints) {
        if (p.z > cp.z && (run.bestSpawn.z ?? -999) < cp.z) {
          run.bestSpawn = { x: cp.x, y: cp.y, z: cp.z };
          P.spawn = run.bestSpawn;
          if (first) { this.bestSpawn = run.bestSpawn; this.sfx('checkpoint'); }
        }
      }
      // fell off the world
      if (p.y < -12) {
        run.deaths++;
        if (first) { this.deaths = run.deaths; this.sfx('fall'); }
        P.respawn();
      }
      // flag
      if (p.z >= this.course.finishZ) {
        run.finished = true;
        run.clearTime = this.timeF / 60;
        run.aiPlace = this.aiPlace(run);
        P.autoRun = false;
        if (first) this.sfx('clear');
      }
    }
    // speed pickups: boost rings and jinx orbs catch EVERY runner — both
    // players and rivals share the same luck (`pickupsOff` for bots)
    if (!this.pickupsOff) {
      const runners = [];
      for (const run of this.runs) if (!run.finished) runners.push(run.P);
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
              if (q === this.player) this.sfx(kind > 0 ? 'boost' : 'jinx');
              break;
            }
          }
        }
      }
    }
    // every runner across the flag → the stage verdict (both must clear)
    if (this.runs.every((r) => r.finished)) {
      this.clearTime = this.runs[0].clearTime;
      this.clearPlace = this.runs[0].aiPlace;
      this.clearTimes = this.runs.map((r) => r.clearTime);
      this.clearPlaces = this.runs.map((r) => r.aiPlace);
      const worst = Math.max(...this.runs.map((r) => r.aiPlace));
      if (!this.gatesOff && worst > LEVELS[this.levelIndex].passPlace) {
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

  // ---- punch / carry / throw (free modes only) --------------------------
  // Lives in Game because it needs the whole cast; the Player owns the
  // state (grab/throwCarried/struggle/shove).
  actorTargets() {
    const out = [];
    for (const run of this.runs) if (!run.out) out.push(run.P);
    for (const r of this.rivals) if (!r.out) out.push(r.player);
    return out;
  }

  nearestActor(P, reach) {
    let best = null, bd = reach;
    const a = P.pos;
    for (const q of this.actorTargets()) {
      if (q === P || q.carrier || q.carry || q.dead) continue;
      const b = q.pos;
      const d = Math.hypot(a.x - b.x, a.z - b.z);
      if (d < bd && Math.abs(a.y - b.y) < 1.2) { bd = d; best = q; }
    }
    return best;
  }

  releaseHeld(P) {
    if (P.carry) { P.carry.carrier = null; P.carry = null; }
    if (P.carrier) { P.carrier.carry = null; P.carrier = null; }
    P.escapeP = 0;
  }

  // ACTION button: throw → grab → punch, in that priority
  actorAction(P) {
    if (P.throwT > 0 || P.carrier) return 'none';
    if (P.carry) {
      P.throwCarried();
      if (P === this.player) this.sfx('bounce');
      return 'throw';
    }
    const grab = this.nearestActor(P, 1.05);
    if (grab) {
      P.grab(grab);
      if (P === this.player) this.sfx('select');
      return 'grab';
    }
    P.punchT = 14;
    const hit = this.nearestActor(P, 1.35);
    if (hit) {
      const dir = Math.sign(hit.pos.x - P.pos.x) || 1;
      hit.shove(dir * 5.2, -2.2);
      if (P === this.player) this.sfx('hit');
      return 'punch';
    }
    if (P === this.player) this.sfx('spin');
    return 'punch';
  }

  // ---- survival (Bumper Arena) ------------------------------------------
  // No flag, no rivals: the ring closes, the waves escalate, and every hit
  // costs a heart on top of the knockback. Out of the ring = over; hearts
  // at zero = over; ARENA.dur (60s) alive = win.
  stepSurvival(flags) {
    const fl = Array.isArray(flags) ? flags : [flags];
    const t = this.timeF / 60;
    arenaStep(this.course, this.frame);
    if (this.course.wave > this.wave) { this.wave = this.course.wave; this.sfx('wave'); }
    this.ringR = ARENA.ringR(t);
    this.course.ringR = this.ringR;
    this.runs.forEach((run, i) => {
      if (run.out) return;
      const P = run.P;
      const f = fl[i] || fl[0];
      // carried co-op partner: ride along, mash to escape
      if (P.carrier) {
        P.step({ ...f, x: 0, z: 0, spin: false });
        if (f.spin) P.struggle();
        return;
      }
      P.step({ ...f, spin: false });     // action button is not the spin attack here
      if (f.spin) this.actorAction(P);
    });
    this.world.step();

    // hits bite: knockback toward the water AND a heart off the pool.
    // hurt() carries the 1.2s mercy window, so no chip-damage spirals.
    // Co-op in 2P: a player who falls out stays out; the stage can only
    // clear if BOTH are still standing at the buzzer.
    for (const run of this.runs) {
      if (run.out) continue;
      const P = run.P;
      const p = P.pos;
      const first = run === this.runs[0];
      const k = this.hazardsOff ? null : hazardTouch(this.course, p);
      if (k) {
        const res = P.hurt(k.kx * 1.4, k.kz * 1.4, 4.6);
        if (res === 'hit') { if (first) this.sfx('hit'); }
        else if (res === 'dead') {
          run.out = true;
          this.releaseHeld(P);
          P.body.setNextKinematicTranslation({ x: p.x, y: -40, z: p.z });
          if (first) { this.sfx('die'); this.sfx('gameover'); }
        }
      }
      if (!run.out && (Math.hypot(p.x, p.z) > this.ringR - 0.1 || p.y < -4)) {
        run.out = true;
        this.releaseHeld(P);
        P.body.setNextKinematicTranslation({ x: p.x, y: -40, z: p.z });
        if (first) { this.sfx('fall'); this.sfx('gameover'); }
      }
    }
    const alive = this.runs.filter((r) => !r.out).length;
    if (alive === 0) {
      this.survTime = t;
      this.state = 'over';
      return;
    }
    // the final buzzer: outlast the whole closing ring → the win card
    if (t >= ARENA.dur) {
      this.survTime = ARENA.dur;
      if (alive === this.runs.length) {
        this.sfx('clear');
        this.state = 'win';
      } else {
        this.state = 'over';
      }
    }
  }

  // ---- Crate Cove (mode 'crates') — last one dry wins -------------------
  // The decks sink on the shuffled schedule; four runners hop between them.
  // You're OUT the instant you touch the water; the last deck shrinks to a
  // sumo ring until only one runner is still dry. No clock, no buzzer.
  stepCrates(flags) {
    const fl = Array.isArray(flags) ? flags : [flags];
    const t = this.timeF / 60;
    crateStep(this.course, this.frame);
    this.runs.forEach((run, i) => {
      const f = fl[i] || fl[0];
      if (run.out) return;               // out = parked, no more input
      const P = run.P;
      // carried: ride along; jump/action mashing breaks the hold
      if (P.carrier) {
        P.step({ ...f, x: 0, z: 0, spin: false });
        if (f.spin) P.struggle();
        return;
      }
      P.step({ ...f, spin: false });     // action button, not the spin attack
      if (f.spin) this.actorAction(P);
    });
    for (const r of this.rivals) {
      r.stepCrates(this.course, this.frame, this.actorTargets());
      if (r.out && r.player.carry) this.releaseHeld(r.player);
    }
    this.world.step();
    this.cratesLeft = this.course.crates.filter((k) => !k.sunk).length;

    // the sea takes anyone who touches it — each player separately
    for (const run of this.runs) {
      if (run.out) continue;
      const p = run.P.pos;
      if (p.y < CRATES.drown) {
        run.out = true;
        this.releaseHeld(run.P);
        run.P.body.setNextKinematicTranslation({ x: p.x, y: -40, z: p.z });
        if (run === this.runs[0]) this.sfx('fall');
      }
    }
    const dryRuns = this.runs.filter((r) => !r.out);
    if (dryRuns.length === 0) {         // everyone swimming
      this.survTime = t;
      this.sfx('gameover');
      this.state = 'over';
      return;
    }
    // every AI rival wet: any player still dry OUTLASTED the field = clear.
    // In 2P a player who fell earlier fails the "both must clear" rule, so
    // the stage ends on the failure card (the survivor's result still shows).
    if (this.rivals.every((r) => r.out)) {
      for (const run of dryRuns) run.survived = true;
      this.survTime = t;
      if (dryRuns.length === this.runs.length) {
        this.sfx('clear');
        this.state = 'win';
      } else {
        this.sfx('gameover');
        this.state = 'over';
      }
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
