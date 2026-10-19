// Headless checks for Super Pixel Bros 3D — no browser needed.
// Runs the real Game + Rapier physics and asserts the core loop works,
// plus i18n key parity (en/ar) and the Input edge-trigger contract.
//   node tools/headless.mjs

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { TABLES, t } from '../js/i18n.js';
import Input from '../js/input.js';
import { initPhysics } from '../js/phys.js';
import Game from '../js/game.js';
import {
  LEVELS, hazardTouch, windAt, courseStep, makeHammer, makePendulum,
  makeRoller, makePiston, makeCrumble, makeBounce, makeWind,
} from '../js/levels.js';
import { Player, HERO_IDS } from '../js/hero.js';

const here = dirname(fileURLToPath(import.meta.url));
const jsDir = join(here, '..', 'js');

let fails = 0;
const ok = (cond, msg) => {
  if (!cond) { fails++; console.error('  FAIL  ' + msg); }
  else console.log('  ok    ' + msg);
};

// ---- 1) i18n: en/ar key parity + every t('key') resolves -----------------
console.log('i18n');
const enKeys = Object.keys(TABLES.en), arKeys = Object.keys(TABLES.ar);
const missing = enKeys.filter((k) => !(k in TABLES.ar));
const extra = arKeys.filter((k) => !(k in TABLES.en));
ok(missing.length === 0, 'ar table covers every en key' +
  (missing.length ? ' (missing: ' + missing + ')' : ''));
ok(extra.length === 0, 'ar table has no orphan keys' +
  (extra.length ? ' (extra: ' + extra + ')' : ''));

const usedKeys = new Set();
for (const f of readdirSync(jsDir)) {
  if (!f.endsWith('.js')) continue;
  const src = readFileSync(join(jsDir, f), 'utf8');
  for (const m of src.matchAll(/\bt\(\s*'([^']+)'/g)) usedKeys.add(m[1]);
  // template keys are hero.<id>.name/.blurb — expand them
  for (const m of src.matchAll(/t\(\s*`hero\.\$\{(?:id|heroId)\}\.(\w+)`/g)) {
    for (const id of HERO_IDS) usedKeys.add(`hero.${id}.${m[1]}`);
  }
}
for (const k of usedKeys) ok(k in TABLES.en, `t('${k}') resolves`);

// ---- 2) Input edge-trigger contract --------------------------------------
console.log('input');
Input.tap('KeyQ');
ok(Input.pressed('KeyQ') && Input.isDown('KeyQ'), 'tap fires pressed');
Input.endFrame();
ok(!Input.pressed('KeyQ') && !Input.isDown('KeyQ'), 'tap self-releases at endFrame');
Input.press('KeyW'); Input.endFrame();
ok(Input.isDown('KeyW') && !Input.pressed('KeyW'), 'press holds across frames');
Input.release('KeyW'); Input.endFrame();
ok(!Input.isDown('KeyW'), 'release clears held');

// ---- 3) Game: full run under real physics ---------------------------------
console.log('game');
const R = await initPhysics();

function mkGame(id, level = 0) {
  const g = new Game(R);
  g.heroIndex = HERO_IDS.indexOf(id);
  g.start(level);
  return g;
}

const g = mkGame('rosso');
g.hazardsOff = true;   // mechanics probe: hazards get their own section
ok(g.state === 'play' && g.player, 'start() enters play with a player');

// run 2s: auto-run should carry us forward with no input
for (let i = 0; i < 120; i++) g.step({ x: 0, jump: false, jumpHeld: false, spin: false });
let p = g.player.pos;
ok(Number.isFinite(p.x + p.y + p.z), 'hero position is finite');
ok(p.z > 3, `auto-run advanced us to z=${p.z.toFixed(1)}`);
ok(Math.abs(p.x) < 1, 'hero stayed on the path');

// jump: on safe flat ground, edge for 1 frame, hold 10 — hero must rise
g.player.body.setTranslation({ x: 0, y: 1.6, z: 6 }, true);
g.player.vy = 0;
const y0 = g.player.pos.y;
g.step({ x: 0, jump: true, jumpHeld: true, spin: false });
let peak = y0;
for (let i = 0; i < 20; i++) {
  g.step({ x: 0, jump: false, jumpHeld: true, spin: false });
  peak = Math.max(peak, g.player.pos.y);
}
ok(peak - y0 > 1.2, `jump rose ${(peak - y0).toFixed(2)}m`);
for (let i = 0; i < 120 && !g.player.grounded; i++) {
  g.step({ x: 0, jump: false, jumpHeld: false, spin: false });
}
ok(g.player.grounded, 'hero lands again');

// coins: teleport onto the first row and collect
const coin = g.course.coins.find((c) => !c.taken);
g.player.body.setTranslation({ x: coin.x, y: coin.y, z: coin.z }, true);
g.player.vy = 0;
g.step({ x: 0, jump: false, jumpHeld: false, spin: false });
ok(g.coins > 0, `coin collected (${g.coins})`);

// checkpoints + fall respawn
const g2 = mkGame('bolt');
g2.player.body.setTranslation({ x: 0, y: 1.2, z: 30 }, true);
for (let i = 0; i < 3; i++) g2.step({ x: 0, jump: false, jumpHeld: false, spin: false });
ok(g2.player.spawn.z >= 28, `checkpoint armed (spawn z=${g2.player.spawn.z})`);
g2.player.body.setTranslation({ x: 0, y: -40, z: 30 }, true);
g2.step({ x: 0, jump: false, jumpHeld: false, spin: false });
ok(g2.player.pos.y > -5 && g2.deaths === 1, 'falling respawns at checkpoint');

// finish → clear
const g3 = mkGame('aqua');
g3.player.body.setTranslation({ x: 0, y: 1.2, z: g3.course.finishZ - 1.5 }, true);
for (let i = 0; i < 120 && g3.state === 'play'; i++) {
  g3.step({ x: 0, jump: false, jumpHeld: false, spin: false });
}
ok(g3.state === 'clear' && g3.clearTime > 0, `finished → clear in ${g3.clearTime?.toFixed?.(1)}s`);

// every hero must FULLY CLEAR every level under its own jump envelope:
// a scripted bot auto-runs and jumps inside course.jumpZones with a full
// hold (slow heroes need full height). This is the reachability gate —
// extend levels, it follows automatically.
console.log('roster reachability');
const levelTimes = LEVELS.map(() => []);
for (let li = 0; li < LEVELS.length; li++) {
  for (const id of HERO_IDS) {
    const h = mkGame(id, li);
    h.hazardsOff = true;   // geometry + pace probe: timed hazards are the
                           // human problem, the bot proves the platforming
    const zones = h.course.jumpZones;
    let hold = 0;
    for (let i = 0; i < 3600 && h.state === 'play'; i++) {
      const q = h.player.pos;
      const jump = h.player.grounded &&
        zones.some(([a, b]) => q.z > a && q.z < b);
      if (jump) hold = 32;
      h.step({ x: 0, jump, jumpHeld: hold > 0, spin: false });
      if (hold > 0) hold--;
    }
    const q = h.player.pos;
    const tSec = h.timeF / 60;
    levelTimes[li].push({ id, t: tSec });
    ok(h.state === 'clear' && Number.isFinite(q.x + q.y + q.z),
      `${LEVELS[li].id}/${id}: cleared t=${tSec.toFixed(1)}s` +
      ` deaths=${h.deaths} coins=${h.coins}/${h.course.coinTotal}`);
    h.disposeWorld();
  }
}
// balance guard: bold but bounded — no hero may be more than 1.40× slower
// than the fastest. (True race fairness comes from rivals scaling to your
// pick; this only catches a stat regression making one hero unviable.)
for (let li = 0; li < LEVELS.length; li++) {
  const ts = levelTimes[li];
  if (!ts.every((e) => e.t > 0)) continue;   // a fail already reported
  const fast = Math.min(...ts.map((e) => e.t));
  const slow = ts.reduce((a, e) => (e.t > a.t ? e : a));
  ok(slow.t / fast <= 1.40,
    `${LEVELS[li].id} fair band: ${slow.id} ${slow.t.toFixed(1)}s` +
    ` vs fastest ${fast.toFixed(1)}s = ${(slow.t / fast).toFixed(2)}x ≤ 1.40`);
}
g.disposeWorld(); g2.disposeWorld(); g3.disposeWorld();

// ---- 4) scenery is solid ---------------------------------------------------
// palm trunk at (−6.4, z=2) on the shore shoulder: a hero pushed into it
// must stop at the bark, not ghost through
console.log('scenery collisions');
{
  const tg = mkGame('rosso', 0);
  tg.player.autoRun = false;
  tg.player.body.setTranslation({ x: -5.0, y: 1.2, z: 2 }, true);
  for (let i = 0; i < 90; i++) {
    tg.step({ x: -1, jump: false, jumpHeld: false, spin: false });
  }
  const tx = tg.player.pos.x;
  ok(tx < -5.2 && tx > -5.82,
    `hero stops at the palm trunk (x=${tx.toFixed(2)})`);
  tg.disposeWorld();
}

// ---- 5) damage model + hazard geometry ------------------------------------
console.log('damage + hazards');
{
  const hg = mkGame('faris', 0);          // faris = 3 hearts
  const pl = hg.player;
  ok(pl.hp === 3 && pl.maxHp === 3, 'faris starts with 3 hearts');
  ok(pl.hurt(6, -2) === 'hit' && pl.hp === 2, 'hurt costs a heart');
  ok(pl.stun > 0 && pl.vy > 0, 'hurt knocks the hero back and up');
  ok(pl.hurt(6, -2) === 'block', 'a second hit during invuln is blocked');
  pl.invuln = 0; pl.hurt(6, -2);          // 2 -> 1
  pl.invuln = 0;
  ok(pl.hurt(6, -2) === 'dead' && pl.hp === 0, 'losing the last heart is death');
  pl.respawn();
  ok(pl.hp === 3 && !pl.dead, 'respawn restores full hearts');
  hg.disposeWorld();

  const hit = (haz, pos) => hazardTouch(
    { hammers: [], pendulums: [], rollers: [], pistons: [], ...haz }, pos);
  ok(hit({ rollers: [{ z: 0, r: 0.9, bx: 0, vel: 1 }] }, { x: 0, y: 0.9, z: 0 }),
    'roller knocks a hero in its path');
  ok(!hit({ rollers: [{ z: 0, r: 0.9, bx: 3.4, vel: 1 }] }, { x: 0, y: 0.9, z: 0 }),
    'roller off to the side is safe');
  ok(hit({ pistons: [{ z: 0, hy: 1.4, bx: 0, vel: -1 }] }, { x: 0, y: 1, z: 0 }),
    'piston knocks a hero in its path');
  ok(hit({ pendulums: [{ z: 0, r: 0.62, bx: 0, by: 0.8, vel: 1 }] }, { x: 0, y: 0.8, z: 0 }),
    'low pendulum knocks');
  ok(!hit({ pendulums: [{ z: 0, r: 0.62, bx: 0, by: 2.6, vel: 1 }] }, { x: 0, y: 0.8, z: 0 }),
    'pendulum raised at the pivot is safe underneath');
  ok(hit({ hammers: [{ z: 0, harm: 0 }] }, { x: 2.5, y: 0.7, z: 0 }),
    'hammer bar pointing at the hero knocks');
  ok(!hit({ hammers: [{ z: 0, harm: Math.PI / 2 }] }, { x: 2.5, y: 0.7, z: 0 }),
    'hammer bar rotated away is safe');

  const wg = mkGame('rosso', 0);
  // integration: a real hero standing in the shore pendulum's path eats a
  // hit from the live game loop (geometry, not just unit math)
  wg.player.autoRun = false;
  wg.player.body.setTranslation({ x: 0, y: 1.2, z: 24 }, true);
  for (let i = 1; i <= 220 && wg.player.hp === wg.player.maxHp; i++) {
    wg.step({ x: 0, jump: false, jumpHeld: false, spin: false });
  }
  ok(wg.player.hp === wg.player.maxHp - 1,
    'shore pendulum hits a hero in the live loop');
  ok(windAt({ winds: [{ z0: 10, z1: 20, dir: -1, force: 4 }] }, { z: 15 }) === -4,
    'wind pushes in its direction within its span');
  ok(windAt({ winds: [{ z0: 10, z1: 20, dir: 1, force: 4 }] }, { z: 30 }) === 0,
    'no wind outside the zone');
  const cr = makeCrumble(R, wg.world, 100, 101, { top: 0, x0: -4, x1: 4 });
  wg.course.crumbles.push(cr);
  const stub = { grounded: true, pos: { x: 0, y: 0.7, z: 100.5 } };
  for (let i = 1; i <= 40; i++) courseStep(R, wg.course, i, stub);
  ok(cr.gone, 'crumble drops after standing on it');
  wg.disposeWorld();

  // live ridge crumble: stand on it → it gives way → real fall → cp respawn
  const cg = mkGame('rosso', 1);
  cg.player.autoRun = false;
  cg.player.body.setTranslation({ x: 0, y: 1.2, z: 67.2 }, true);
  const slab = cg.course.crumbles[0];
  for (let i = 0; i < 240 && !slab.removed; i++) {
    cg.step({ x: 0, jump: false, jumpHeld: false, spin: false });
  }
  ok(slab.gone && slab.removed, 'ridge crumble slab removed from physics');
  for (let i = 0; i < 240 && cg.deaths === 0; i++) {
    cg.step({ x: 0, jump: false, jumpHeld: false, spin: false });
  }
  ok(cg.deaths === 1 && cg.player.spawn.z >= 63,
    'dropping through the crumble respawns at the checkpoint');
  cg.disposeWorld();
}

// ---- 6) clock + disqualification ------------------------------------------
console.log('clock + disqualification');
{
  // calibration: every limit is generous vs the best achievable (bot) time
  for (let li = 0; li < LEVELS.length; li++) {
    const ts = levelTimes[li].filter((e) => e.t > 0);
    if (!ts.length) continue;
    const slow = Math.max(...ts.map((e) => e.t));
    ok(LEVELS[li].timeLimit >= 1.6 * slow,
      `${LEVELS[li].id} limit ${LEVELS[li].timeLimit}s ≥ 1.6× slowest bot ` +
      `${slow.toFixed(1)}s`);
  }
  const dg = mkGame('rosso', 0);
  dg.hazardsOff = true;
  dg.timeLimit = 1;                         // force the clock to run out
  for (let i = 0; i < 120 && dg.state === 'play'; i++) {
    dg.step({ x: 0, jump: false, jumpHeld: false, spin: false });
  }
  ok(dg.state === 'dq', 'running out of time disqualifies');
  dg.start(0);                               // retry the same stage
  ok(dg.state === 'play' && dg.timeF === 0 &&
    dg.timeLimit === LEVELS[0].timeLimit, 'retry resets the clock');
  dg.disposeWorld();
}

// ---- 7) AI rivals race along ----------------------------------------------
// Rivals run the SAME course on autopilot: they must make real progress,
// stay finite, finish, and yield a sane hero placement.
console.log('rivals');
{
  const rg = mkGame('rosso', 0);
  let hold = 0;
  const zones = rg.course.jumpZones;
  for (let i = 0; i < 3600 && rg.state === 'play'; i++) {
    const q = rg.player.pos;
    const jump = rg.player.grounded &&
      zones.some(([a, b]) => q.z > a && q.z < b);
    if (jump) hold = 32;
    rg.step({ x: 0, jump, jumpHeld: hold > 0, spin: false });
    if (hold > 0) hold--;
  }
  // hero stands at the flag; let the rivals run out their race on a clock
  // continuous with the hero's, so finish times are honest
  const f0 = rg.timeF;
  for (let i = 1; i <= 1800; i++) {
    for (const r of rg.rivals) r.step(rg.course, f0 + i, (f0 + i) / 60);
    rg.world.step();
  }
  for (const r of rg.rivals) {
    const q = r.pos;
    ok(Number.isFinite(q.x + q.y + q.z) && q.z > 30,
      `rival ${r.id} raced to z=${q.z.toFixed(1)}` +
      (r.finished ? ` (finished ${r.finishT.toFixed(1)}s)` : ''));
  }
  ok(rg.rivals[0].finished, 'the fastest rival finishes');
  ok(rg.clearPlace >= 1 && rg.clearPlace <= 4,
    `hero placement recorded: ${rg.clearPlace}`);
  rg.disposeWorld();
}

// ---- 8) adventure map logic -----------------------------------------------
console.log('adventure map');
const mg = new Game(R);
mg.enterMap();
ok(mg.state === 'map' && mg.map.cursor === 0 && !mg.map.walk,
  'enterMap: fresh save sits at stage 1');
mg.mapMove(1);
ok(mg.map.cursor === 0, 'cursor cannot pass the frontier');
mg.frontier = 1;
mg.mapMove(1);
ok(mg.map.cursor === 1, 'cursor reaches the frontier stage');
mg.mapMove(-1);
mg.mapMove(-1);
ok(mg.map.cursor === 0, 'cursor clamps at stage 1');

mg.levelIndex = 0;
ok(mg.advanceFrontier() === 'map' && mg.frontier === 1 && mg.map.walk,
  'clearing the frontier walks the hero onward');
for (let i = 0; i < 90; i++) mg.mapStep();
ok(!mg.map.walk, 'the walk tween completes');
const hp1 = mg.mapHeroPos();
ok(!hp1.walking && Math.abs(hp1.x - 6) < 0.01,
  `hero ends up on node 2 (x=${hp1.x.toFixed(1)})`);

mg.levelIndex = 1;
ok(mg.advanceFrontier() === 'victory', 'clearing the last stage wins the trophy');
mg.disposeWorld();

// ---- done -----------------------------------------------------------------
if (fails) {
  console.error(`\n${fails} headless check(s) FAILED`);
  process.exit(1);
}
console.log('\nall headless checks passed');
