// Headless checks for Super Pixel Bros 3D — no browser needed.
// Runs the real Game + Rapier physics and asserts the core loop works,
// plus i18n key parity (en/ar) and the Input edge-trigger contract.
//   node tools/headless.mjs

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { TABLES, t } from '../js/i18n.js';
import Input from '../js/input.js';
import * as Gamepad from '../js/gamepad.js';
import { initPhysics, createWorld } from '../js/phys.js';
import Game from '../js/game.js';
import {
  LEVELS, hazardTouch, windAt, courseStep, makeHammer, makePendulum,
  makeRoller, makePiston, makeCrumble, makeBounce, makeWind, ARENA,
  CRATES, buildCrates, crateStep,
} from '../js/levels.js';
import { Player, HERO_IDS, CHARACTERS, stepHeroGrid } from '../js/hero.js';
import { crateHop } from '../js/rivals.js';

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

// ---- 2b) gamepad detection (two pads, array-like list) --------------------
console.log('gamepad');
{
  const mkPad = (index, pressed = {}) => ({
    index, connected: true, id: `F710 #${index}`,
    buttons: Array.from({ length: 17 }, (_, i) => ({
      pressed: !!pressed[i], value: pressed[i] ? 1 : 0,
    })),
    axes: [0, 0, 0, 0],
  });
  // ARRAY-LIKE, not iterable: browsers hand back GamepadList objects, so
  // detection must never assume Symbol.iterator (the old for...of bug)
  const list = { length: 2, 0: mkPad(0, { 0: true }), 1: mkPad(1, {}) };
  Gamepad.init(() => list);
  Gamepad.setEnabled(true);
  ok(Gamepad.padCount() === 2,
    'two pads detected from an array-like gamepad list');
  let slots = Gamepad.pollSlots();
  ok(slots.length === 2 && slots[0].connected && slots[1].connected,
    'pollSlots: both pads map to their own slot');
  ok(slots[0].jump && !slots[1].jump,
    'pollSlots: each slot reads its own ✕ press');

  // slot 0 is always the LOWEST-INDEX pad, whatever the list order
  const list2 = { length: 2, 0: mkPad(3, { 0: true }), 1: mkPad(0, {}) };
  Gamepad.init(() => list2);
  slots = Gamepad.pollSlots();
  ok(slots[0].index === 0 && slots[1].index === 3,
    'pollSlots: slots sort by pad index');

  // a second pad pressing Start reaches Input (pause works from pad 2).
  // The FIRST poll of a newly seen pad is swallowed (wake-press guard), so
  // register both pads before asserting.
  Gamepad.poll();
  Input.endFrame();
  list2[1].buttons[9].pressed = true;
  list2[1].buttons[9].value = 1;
  Gamepad.poll();
  ok(Input.pressed('Escape') && Input.pressed('KeyQ'),
    'menu codes (Start) come from ANY pad, not just the first');
  Gamepad.setEnabled(false);
  Input.endFrame();

  // plugging pad 3 with ✕ held must NOT start/confirm anything
  Input.endFrame();
  const list3 = { length: 1, 0: mkPad(7, { 0: true }) };
  Gamepad.init(() => list3);
  Gamepad.setEnabled(true);
  Gamepad.poll();
  ok(!Input.pressed('Enter') && !Input.pressed('Space'),
    'the wake press never starts the game or confirms a menu');
  Gamepad.setEnabled(false);
  Input.endFrame();

  // unplug the second pad: slot 1 empties, slot 0 keeps working
  list[1].connected = false;
  Gamepad.init(() => list);
  Gamepad.setEnabled(true);
  slots = Gamepad.pollSlots();
  ok(slots[0].connected && !slots[1].connected,
    'unplugging pad 2 empties slot 1 only');

  // DISABLED slots must still be fully shaped: a missing x/jump field turns
  // into NaN inside Player.step and freezes that player for the whole run
  Gamepad.setEnabled(false);
  const dead = Gamepad.pollSlots();
  ok(dead.length === 2 && dead.every((s) => !s.connected
    && typeof s.x === 'number' && typeof s.z === 'number'
    && typeof s.jump === 'boolean' && typeof s.jumpPressed === 'boolean'),
    'disabled slots are fully shaped (no undefined → NaN flags)');

  Gamepad.setEnabled(false);
  Gamepad.init(() => []);
  ok(Gamepad.padCount() === 0, 'no pads → count 0');
}

// ---- 2c) select grid navigation (up/down stay in bounds) -----------------
console.log('select grid');
{
  const L = HERO_IDS.length;             // 10 heroes
  ok(stepHeroGrid(0, 0, 1, 4, L) === 4, 'grid: down = exactly one row');
  ok(stepHeroGrid(2, 0, 1, 4, L) === 6, 'grid: down keeps the column');
  ok(stepHeroGrid(6, 0, -1, 4, L) === 2, 'grid: up = exactly one row');
  ok(stepHeroGrid(1, 0, -1, 4, L) === 1,
    'grid: up from the first row stays in bounds');
  ok(stepHeroGrid(L - 1, 0, 1, 4, L) === L - 1,
    'grid: down from the short last row never jumps columns');
  ok(stepHeroGrid(L - 1, 1, 0, 4, L) === 0, 'grid: right wraps from the last card');
  ok(stepHeroGrid(0, -1, 0, 4, L) === L - 1, 'grid: left wraps from the first card');
  ok(stepHeroGrid(8, 0, 1, 3, L) === 8,
    'grid: obeys a 3-column layout too (no out-of-bounds hop)');
}

// ---- 3) Game: full run under real physics ---------------------------------
console.log('game');
const R = await initPhysics();

function mkGame(id, level = 0) {
  const g = new Game(R);
  g.heroIndex = HERO_IDS.indexOf(id);
  g.start(level);
  return g;
}

const g = mkGame('hero');
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
const g2 = mkGame('yas');
g2.player.body.setTranslation({ x: 0, y: 1.2, z: 30 }, true);
for (let i = 0; i < 3; i++) g2.step({ x: 0, jump: false, jumpHeld: false, spin: false });
ok(g2.player.spawn.z >= 22, `checkpoint armed (spawn z=${g2.player.spawn.z})`);
g2.player.body.setTranslation({ x: 0, y: -40, z: 30 }, true);
g2.step({ x: 0, jump: false, jumpHeld: false, spin: false });
ok(g2.player.pos.y > -5 && g2.deaths === 1, 'falling respawns at checkpoint');

// finish → clear
const g3 = mkGame('ghzl');
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
  if ((LEVELS[li].mode || 'race') !== 'race') continue;   // arena + crates: own sections
  for (const id of HERO_IDS) {
    const h = mkGame(id, li);
    h.hazardsOff = true;   // geometry + pace probe: timed hazards are the
                           // human problem, the bot proves the platforming
    h.gatesOff = true;     // placement gates need human racing, not a bot
    h.pickupsOff = true;   // keep clear-time bands comparable run to run
    const zones = h.course.jumpZones;
    const narrows = h.course.narrows;
    let hold = 0;
    // cap 160s: Sunset Ridge v3 is ~2× long — slowest bots land ~90s
    for (let i = 0; i < 9600 && h.state === 'play'; i++) {
      const q = h.player.pos;
      // press EDGES only (hold === 0): the jump latch needs a release to
      // re-arm, so a level-triggered bot would jump once and freeze
      const jump = hold === 0 && h.player.grounded &&
        zones.some(([a, b]) => q.z > a && q.z < b);
      if (jump) hold = 32;
      // gated chicanes: inside a narrow, steer for the GAP center (a
      // centered narrow is a no-op here — the hero is already at 0).
      // Pressing along a wall still slides you into the opening.
      let steer = 0;
      for (const [z0, z1, , cx = 0] of narrows) {
        if (q.z > z0 - 1.5 && q.z < z1 && Math.abs(q.x - cx) > 0.5) {
          steer = Math.sign(cx - q.x);
          break;
        }
      }
      h.step({ x: steer, jump, jumpHeld: hold > 0, spin: false });
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
// balance guards. (1) SPEED LAW: max/min roster speed ≤ 1.05 — the roster
// is balanced by design, identity lives in grip/jump/hearts. (2) Clear-time
// band ≤ 1.12× catches a stat or level regression making one hero unviable
// (measured with hazards parked, so it reflects geometry + pace only).
const speeds = HERO_IDS.map((id) => CHARACTERS[id].speed);
ok(Math.max(...speeds) / Math.min(...speeds) <= 1.05,
  `roster speed spread ${(Math.max(...speeds) / Math.min(...speeds)).toFixed(3)}x ≤ 1.05`);
for (let li = 0; li < LEVELS.length; li++) {
  const ts = levelTimes[li];
  if (!ts.length || !ts.every((e) => e.t > 0)) continue;   // arena: own section
  const fast = Math.min(...ts.map((e) => e.t));
  const slow = ts.reduce((a, e) => (e.t > a.t ? e : a));
  ok(slow.t / fast <= 1.12,
    `${LEVELS[li].id} fair band: ${slow.id} ${slow.t.toFixed(1)}s` +
    ` vs fastest ${fast.toFixed(1)}s = ${(slow.t / fast).toFixed(2)}x ≤ 1.12`);
}
g.disposeWorld(); g2.disposeWorld(); g3.disposeWorld();

// ---- power-ups: boost rings + jinx orbs -----------------------------------
console.log('power-ups');
{
  const pg = mkGame('hero', 0);
  pg.hazardsOff = true;
  const C = pg.course;
  ok(C.boosts.length >= 2 && C.curses.length >= 1,
    `shore ships ${C.boosts.length} boosts + ${C.curses.length} jinxes`);
  const base = CHARACTERS.hero.speed;

  // grab the first boost ring: mod latches, ground speed climbs past base
  const b = C.boosts[0];
  pg.player.body.setTranslation({ x: b.x, y: b.y, z: b.z - 0.4 }, true);
  pg.player.vy = 0;
  pg.step({ x: 0, jump: false, jumpHeld: false, spin: false });
  ok(b.taken && pg.player.mod === 1 && pg.player.modT > 180,
    `boost ring collected (mod=${pg.player.mod}, modT=${pg.player.modT})`);
  let vmax = 0;
  for (let i = 0; i < 40; i++) {
    pg.step({ x: 0, jump: false, jumpHeld: false, spin: false });
    vmax = Math.max(vmax, pg.player.vz);
  }
  ok(vmax > base * 1.15,
    `boosted ground run hits ${vmax.toFixed(1)} > base ${base}`);

  // airborne = honest base envelope, jinx or no jinx
  const j = C.curses[0];
  pg.player.body.setTranslation({ x: j.x, y: j.y, z: j.z - 0.4 }, true);
  pg.player.vy = 0;
  pg.step({ x: 0, jump: false, jumpHeld: false, spin: false });
  ok(pg.player.mod === -1, 'jinx orb replaces a running boost (no stacking)');
  pg.player.grounded = false;
  ok(pg.player.speedMul === 1, 'modifier is ground-only mid-air');
  pg.player.grounded = true;
  let vmin = 99;
  for (let i = 0; i < 40; i++) {
    pg.step({ x: 0, jump: false, jumpHeld: false, spin: false });
    vmin = Math.min(vmin, pg.player.vz);
  }
  ok(vmin < base * 0.85, `jinxed ground run drags to ${vmin.toFixed(1)} < base`);

  // both effects time out: modT drains and the ground multiplier returns
  pg.player.body.setTranslation({ x: 0, y: 1.6, z: 8 }, true);
  pg.player.vy = 0;
  for (let i = 0; i < 200 && pg.player.modT > 0; i++) {
    if (i % 30 === 0) {
      pg.player.body.setTranslation({ x: 0, y: 1.2, z: 8 }, true);
    }
    pg.step({ x: 0, jump: false, jumpHeld: false, spin: false });
  }
  ok(pg.player.modT === 0 && pg.player.speedMul === 1,
    'modifier expires, base multiplier restored');

  // dying washes it off; rivals are affected by the same rings
  pg.player.applyMod(1);
  pg.player.respawn();
  ok(pg.player.modT === 0, 'respawn clears any modifier');
  const rb = C.boosts[1];
  const rival = pg.rivals[0].player;
  pg.step({ x: 0, jump: false, jumpHeld: false, spin: false });
  rival.body.setTranslation({ x: rb.x, y: rb.y, z: rb.z }, true);
  pg.step({ x: 0, jump: false, jumpHeld: false, spin: false });
  ok(rb.taken && rival.mod === 1, 'rivals share the boost rings too');
  pg.disposeWorld();

  // the arena ships no pickups (it has a ring to keep you honest)
  const ag = mkGame('hero', 3);
  ok(ag.course.boosts.length === 0 && ag.course.curses.length === 0,
    'bumper arena ships zero pickups');
  ag.disposeWorld();
}

// ---- 4) scenery is solid ---------------------------------------------------
// palm trunk at (−6.6, z=6) on the Daybreak Ridge shoulder: a hero pushed
// into it must stop at the bark, not ghost through
console.log('scenery collisions');
{
  const tg = mkGame('hero', 0);
  tg.player.autoRun = false;
  tg.player.body.setTranslation({ x: -5.0, y: 1.2, z: 6 }, true);
  for (let i = 0; i < 90; i++) {
    tg.step({ x: -1, jump: false, jumpHeld: false, spin: false });
  }
  const tx = tg.player.pos.x;
  ok(tx < -5.6 && tx > -6.25,
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

  const wg = mkGame('hero', 0);
  // integration: a real hero standing in the Ridge pendulum's path eats a
  // hit from the live game loop (geometry, not just unit math)
  wg.player.autoRun = false;
  wg.player.body.setTranslation({ x: 0, y: 1.2, z: 90.8 }, true);
  for (let i = 1; i <= 220 && wg.player.hp === wg.player.maxHp; i++) {
    wg.step({ x: 0, jump: false, jumpHeld: false, spin: false });
  }
  ok(wg.player.hp === wg.player.maxHp - 1,
    'ridge pendulum hits a hero in the live loop');
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

  // live crumble (Daybreak's crossing): stand on it → gives way → fall → cp
  const cg = mkGame('hero', 0);
  cg.player.autoRun = false;
  cg.player.body.setTranslation({ x: 0, y: 1.2, z: 67.2 }, true);
  const slab = cg.course.crumbles[0];
  for (let i = 0; i < 240 && !slab.removed; i++) {
    cg.step({ x: 0, jump: false, jumpHeld: false, spin: false });
  }
  ok(slab.gone && slab.removed, 'crumble slab removed from physics');
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
  const dg = mkGame('hero', 0);
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

// ---- 6b) placement gates ---------------------------------------------------
// Daybreak Ridge advances on top-3 (4th loses); Sunset Ridge demands 1st.
// We park rivals at chosen z's around the flag to force a finishing place
// and check the outcome.
console.log('placement gates');
{
  // finish with exactly `ahead` rivals beating us, hero otherwise clean
  const gateRun = (level, ahead) => {
    const gg = mkGame('hero', level);
    gg.hazardsOff = true;
    const fz = gg.course.finishZ;
    gg.player.body.setTranslation({ x: 0, y: 1.2, z: fz - 1.4 }, true);
    gg.player.vz = 7;
    gg.rivals.forEach((r, i) => {
      const win = i < ahead;                 // these finish just ahead
      const xs = [-3.5, -2.6, 3.5];          // never stacked, off the lane
      r.player.body.setTranslation(
        { x: xs[i], y: 1.2, z: win ? fz - 0.2 : 1 }, true);
      r.player.vz = win ? 7 : 0;
      r.player.autoRun = win;                // losers simply stop at the line
    });
    for (let i = 0; i < 90 && gg.state === 'play'; i++) {
      gg.step({ x: 0, jump: false, jumpHeld: false, spin: false });
    }
    return gg;
  };
  const g1 = gateRun(0, 3);   // dayridge, 3 rivals ahead → we are 4th
  ok(g1.state === 'lost' && g1.clearPlace === 4,
    `dayridge 4th place → LOST (place=${g1.clearPlace})`);
  g1.disposeWorld();
  const g2 = gateRun(0, 2);   // dayridge, 2 ahead → 3rd → passes (top 3)
  ok(g2.state === 'clear' && g2.clearPlace === 3,
    `dayridge 3rd place → clear (place=${g2.clearPlace})`);
  g2.disposeWorld();
  const g3 = gateRun(1, 1);   // ridge, 1 ahead → 2nd → must-win means LOST
  ok(g3.state === 'lost' && g3.clearPlace === 2,
    `ridge 2nd place → LOST (must win, place=${g3.clearPlace})`);
  g3.disposeWorld();
  const g4 = gateRun(1, 0);   // ridge, clean win → clear
  ok(g4.state === 'clear' && g4.clearPlace === 1,
    `ridge 1st place → clear (place=${g4.clearPlace})`);
  g4.disposeWorld();
}

// ---- 6c) the difficulty wave: Sunset Ridge v3 is the double-length one --
console.log('stage lengths');
{
  const a = mkGame('hero', 0);
  const b = mkGame('hero', 1);
  ok(b.course.finishZ >= 1.9 * a.course.finishZ,
    `stage 2 (${b.course.finishZ}m) ≥ 1.9× stage 1 (${a.course.finishZ}m)`);
  ok(b.course.alleys && b.course.bins.length >= 4 && b.course.cars.length >= 4
    && b.course.fountains.length >= 1 && b.course.wets.length >= 4
    && b.course.critters.length >= 3 && b.course.facades.length >= 10,
    `sunset alleys carries the street set (bins=${b.course.bins.length}` +
    ` cars=${b.course.cars.length} wets=${b.course.wets.length}` +
    ` critters=${b.course.critters.length} facades=${b.course.facades.length})`);
  ok(a.course.bins.length === 0 && a.course.critters.length === 0,
    'stage 1 stays the pure ridge (no street set)');
  a.disposeWorld(); b.disposeWorld();
}

// ---- 6d) Sunset Alleys street rules --------------------------------------
console.log('sunset alleys');
{
  // standing water is a speed multiplier, never a stun or damage
  const wg = mkGame('hero', 1);
  wg.hazardsOff = true;
  const run = (z, x) => {
    wg.player.body.setTranslation({ x, y: 1.6, z }, true);
    wg.player.vz = 0;
    const z0 = wg.player.pos.z;
    for (let i = 0; i < 30; i++) {
      wg.step({ x: 0, jump: false, jumpHeld: false, spin: false });
    }
    return wg.player.pos.z - z0;
  };
  const dry = run(24, 3.6);
  const wet = run(28.6, 3.6);
  ok(wet < dry * 0.82,
    `water slows the runner (${wet.toFixed(1)}m vs ${dry.toFixed(1)}m in 1s)`);
  ok(wg.player.stun === 0, 'water never stuns');
  wg.disposeWorld();

  // a darting dog is a real knockback hazard
  const dg = mkGame('hero', 1);
  dg.player.autoRun = false;
  dg.player.body.setTranslation({ x: 0, y: 1.2, z: 90 }, true);
  for (let i = 0; i < 320 && dg.player.hp === dg.player.maxHp; i++) {
    dg.step({ x: 0, jump: false, jumpHeld: false, spin: false });
  }
  ok(dg.player.hp < dg.player.maxHp,
    'a darting dog knocks a hero standing in its path');
  dg.disposeWorld();

  // small bins are jumpable; dumpsters and wrecks are lane blockers
  const lg = mkGame('hero', 1);
  const smalls = lg.course.bins.filter((b) => !b.big);
  const bigs = lg.course.bins.filter((b) => b.big);
  ok(smalls.length >= 2 && smalls.every((b) => b.h <= 0.95),
    'small bins are low enough to jump');
  ok(bigs.length >= 1 && lg.course.cars.length >= 3,
    'dumpsters and wrecks are lane blockers');
  lg.disposeWorld();
}

// ---- 7) AI rivals race along ----------------------------------------------
// Rivals run the SAME course on autopilot: they must make real progress,
// stay finite, finish, and yield a sane hero placement.
console.log('rivals');
{
  const rg = mkGame('hero', 0);
  // rival autopilot probe — hazards parked so the race is about pace;
  // the live-hazard rival torture lives in THE GAUNTLET STRESS below
  rg.hazardsOff = true;
  let hold = 0;
  const zones = rg.course.jumpZones;
  const narrows = rg.course.narrows;
  for (let i = 0; i < 5400 && rg.state === 'play'; i++) {
    const q = rg.player.pos;
    // press EDGE only — the latch needs a release to re-arm
    const jump = hold === 0 && rg.player.grounded &&
      zones.some(([a, b]) => q.z > a && q.z < b);
    if (jump) hold = 32;
    // Daybreak Ridge has real canyon walls — steer for the gap centers
    // (same contract as the roster bot) or the hero grinds on stone
    let steer = 0;
    for (const [z0, z1, , cx = 0] of narrows) {
      if (q.z > z0 - 1.5 && q.z < z1 && Math.abs(q.x - cx) > 0.5) {
        steer = Math.sign(cx - q.x);
        break;
      }
    }
    rg.step({ x: steer, jump, jumpHeld: hold > 0, spin: false });
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

  // THE GAUNTLET STRESS: in Sunset Alleys the rivals must weave the fork,
  // thread the archway and dodge the wrecks — live hazards, no bot mercy —
  // and still all come out the far side
  const rg2 = mkGame('hero', 1);
  const zones2 = rg2.course.jumpZones, narrows2 = rg2.course.narrows;
  let hold2 = 0;
  for (let i = 0; i < 9600 && rg2.state === 'play'; i++) {
    const q = rg2.player.pos;
    const jump = hold2 === 0 && rg2.player.grounded &&
      zones2.some(([a, b]) => q.z > a && q.z < b);
    if (jump) hold2 = 32;
    let steer = 0;
    for (const [z0, z1, , cx = 0] of narrows2) {
      if (q.z > z0 - 1.5 && q.z < z1 && Math.abs(q.x - cx) > 0.5) {
        steer = Math.sign(cx - q.x);
        break;
      }
    }
    rg2.step({ x: steer, jump, jumpHeld: hold2 > 0, spin: false });
    if (hold2 > 0) hold2--;
  }
  for (let i = 1; i <= 60 * 100; i++) {
    // keep the kinematics alive while the rivals run out their race —
    // the portcullis only lifts if courseStep keeps turning
    courseStep(R, rg2.course, rg2.timeF + i, null);
    for (const r of rg2.rivals) r.step(rg2.course, rg2.timeF + i, (rg2.timeF + i) / 60, false);
    rg2.world.step();
  }
  for (const r of rg2.rivals) {
    ok(r.pos.z > 40 || r.finished,
      `alleys rival ${r.id} ran the street (z=${r.pos.z.toFixed(1)}` +
      (r.finished ? ', finished)' : ')'));
  }
  ok(rg2.rivals.some((r) => r.finished),
    'a rival can run Sunset Alleys fair and square (hazards live)');
  rg2.disposeWorld();
}

// ---- 8) adventure map logic -----------------------------------------------
console.log('adventure map');
const mg = new Game(R);
mg.enterMap();
ok(mg.state === 'map' && mg.map.cursor === 0 && !mg.map.walk,
  'enterMap: fresh save sits at stage 1');
mg.mapMove(1);
ok(mg.map.cursor === 3,
  'frontier 0: the arena challenge is always reachable (skips locked stages)');
mg.mapMove(-1);
ok(mg.map.cursor === 0, 'a locked stage is skimmed past, never parked on');
mg.frontier = 1;
mg.mapMove(1);
ok(mg.map.cursor === 1, 'cursor reaches the frontier stage');
mg.mapMove(1);
ok(mg.map.cursor === 3, 'the arena node sits beyond the last race stage');
mg.mapMove(-1);
mg.mapMove(-1);
ok(mg.map.cursor === 0, 'cursor clamps at stage 1');
// requirement: a fresh run from the title always opens on stage 1 even when
// stage 2 is unlocked; mid-run map entries (after a clear) keep the frontier
mg.enterMap(true);
ok(mg.map.cursor === 0 && mg.frontier === 1,
  'fresh run opens the map on stage 1 (unlocks kept)');
mg.enterMap(false);
ok(mg.map.cursor === 1, 'mid-run map entry lands on the frontier');
mg.mapMove(-1);

mg.levelIndex = 0;
ok(mg.advanceFrontier() === 'map' && mg.frontier === 1 && mg.map.walk,
  'clearing the frontier walks the hero onward');
for (let i = 0; i < 90; i++) mg.mapStep();
ok(!mg.map.walk, 'the walk tween completes');
const hp1 = mg.mapHeroPos();
ok(!hp1.walking && Math.abs(hp1.x - 6) < 0.01,
  `hero ends up on node 2 (x=${hp1.x.toFixed(1)})`);

// regression (Oct 2026): a persisted frontier from an older ladder must
// never hop the hero PAST the node they just unlocked
mg.frontier = 3;
mg.levelIndex = 0;
mg.advanceFrontier();
ok(mg.map.cursor === 1,
  'a saved frontier never hops the hero past the next node (stage 1 → 2)');

mg.levelIndex = 1;
mg.frontier = 1;   // the cove is still unbeaten
// an arena win with the ladder unfinished just walks you back to the map
ok(mg.claimVictory() === 'map' && mg.state === 'map' && mg.frontier === 1,
  'arena win with stages uncleared only walks you back to the map');
ok(mg.advanceFrontier() === 'map' && mg.frontier === 2 && mg.state === 'map',
  'clearing Sunset Ridge unlocks the CRATE COVE node');
ok(!mg.allRacesCleared(), 'the ladder is not complete until the cove is won');
mg.levelIndex = 2;
ok(mg.advanceFrontier() === 'map' && mg.frontier === 3 && mg.map.cursor === 3,
  'clearing Crate Cove walks to the ARENA node (no early trophy)');
ok(mg.allRacesCleared(), 'race ladder complete');
ok(mg.claimVictory() === 'victory' && mg.state === 'victory',
  'trophy = arena win + every race stage cleared');
mg.disposeWorld();

// ---- 10) survival arena ----------------------------------------------------
console.log('survival arena');
{
  const live = (c) => [c.pendulums, c.rollers, c.hammers]
    .reduce((n, arr) => n + arr.filter((h) => h.active).length, 0);

  const sg = mkGame('hero', 3);
  ok(sg.mode === 'survival' && sg.player.free && sg.rivals.length === 0,
    'arena: free control, no rivals, no auto-run');
  for (let i = 0; i < 90; i++) {
    sg.step({ x: 0, z: 1, jump: false, jumpHeld: false, spin: false });
  }
  ok(sg.player.pos.z > -4, `throttle drives forward (z=${sg.player.pos.z.toFixed(1)})`);
  for (let i = 0; i < 90; i++) {
    sg.step({ x: 0, z: 0, jump: false, jumpHeld: false, spin: false });
  }
  ok(Math.abs(sg.player.vz) < 0.3, 'releasing the throttle brakes to a stop');
  sg.disposeWorld();

  // ring closes monotonically, waves only climb, hazard count escalates
  const rg = mkGame('hero', 3);
  rg.hazardsOff = true;
  let mono = true, prevR = rg.ringR, prevW = 1, live0 = 0, live45 = 0, live55 = 0;
  for (let i = 0; i < 60 * 57 && rg.state === 'play'; i++) {
    rg.player.body.setTranslation({ x: 0, y: 1.2, z: 0 }, true); // hover the hub
    rg.step({ x: 0, z: 0, jump: false, jumpHeld: false, spin: false });
    if (rg.ringR > prevR + 1e-9 || rg.wave < prevW) mono = false;
    prevR = rg.ringR; prevW = rg.wave;
    const t = rg.timeF / 60;
    if (t > 0.5 && t < 0.6 && !live0) live0 = live(rg.course);
    if (t > 45.5 && t < 45.7 && !live45) live45 = live(rg.course);
    if (t > 55 && t < 55.3 && !live55) live55 = live(rg.course);
  }
  ok(mono && rg.state === 'play', 'ring shrinks, waves only ever climb');
  ok(live0 === 2 && live45 === 7 && live55 === 8,
    `waves bring the thunder: ${live0} live at 0.5s, ${live45} at 45s, ` +
    `all ${live55} by 55s`);
  rg.disposeWorld();

  // stand outside the closing ring → the sea takes you
  const og = mkGame('hero', 3);
  og.hazardsOff = true;
  og.player.body.setTranslation({ x: 0, y: 1.2, z: 9.85 }, true);
  for (let i = 0; i < 60 * 30 && og.state === 'play'; i++) {
    og.step({ x: 0, z: 0, jump: false, jumpHeld: false, spin: false });
  }
  ok(og.state === 'over' && og.survTime > 5,
    `the ring swallows you (over at ${og.survTime?.toFixed(1)}s)`);
  og.disposeWorld();

  // the heart pool: flat 4 for every hero; hits bite through it; zero = over
  const hg = mkGame('hero', 3);
  ok(hg.player.maxHp === ARENA.hearts && hg.player.hp === ARENA.hearts,
    `arena ships a flat ${ARENA.hearts}-heart pool`);
  let bites = 0;
  for (let i = 0; i < 60 * 30 && hg.state === 'play' && hg.player.hp > 0; i++) {
    // glue the hero to the live pendulum ball every frame and wink out
    // the mercy window — testing the accounting, not the dodging
    const pd = hg.course.pendulums[0];
    hg.player.body.setTranslation({ x: pd.bx, y: pd.by, z: pd.z }, true);
    hg.player.vy = 0;
    hg.player.invuln = 0;
    const before = hg.player.hp;
    hg.step({ x: 0, z: 0, jump: false, jumpHeld: false, spin: false });
    if (hg.player.hp < before) bites++;
  }
  ok(hg.state === 'over' && bites === ARENA.hearts,
    `hits drain the pool → over (bites=${bites}, t=${hg.survTime?.toFixed(1)}s)`);
  hg.disposeWorld();

  // the full gauntlet: 60s alive → LAST STANDING
  const wg = mkGame('ghzl', 3);
  wg.hazardsOff = true;
  for (let i = 0; i < 60 * 64 && wg.state === 'play'; i++) {
    wg.player.body.setTranslation({ x: 0, y: 1.2, z: 0 }, true);
    wg.step({ x: 0, z: 0, jump: false, jumpHeld: false, spin: false });
  }
  ok(wg.state === 'win' && wg.survTime >= ARENA.dur,
    `survive ${ARENA.dur} seconds → WIN (t=${(wg.timeF / 60).toFixed(1)}s)`);
  wg.disposeWorld();
}

// ---- 11) crate cove: strict last one standing ------------------------------
console.log('crate cove');
{
  const cg = mkGame('hero', 2);
  ok(cg.mode === 'crates' && cg.player.free && cg.rivals.length === 3
    && cg.course.crates.length === 12 && !cg.player.autoRun,
    'cove: free control, three rivals, twelve decks, no auto-run');
  const finite = cg.course.crates.map((k) => k.sinkAt)
    .filter((t) => t !== Infinity).sort((a, b) => a - b);
  ok(finite.length === 11 && finite.every((t, i) => i === 0 || t > finite[i - 1]),
    'eleven decks sink on an escalating schedule, one is the showdown');
  cg.disposeWorld();

  // same seed → same deal; different seed → different deal
  const sched = (seed) => {
    const w = createWorld(R);
    const c = buildCrates(R, w, seed);
    const out = c.crates.map((k) => k.sinkAt).join(',');
    w.free();
    return out;
  };
  ok(sched(1234) === sched(1234), 'a fixed seed deals the same sink order');
  ok(sched(1234) !== sched(99), 'a different seed deals a different order');

  // the hero plays with the same hop brain the rivals use — it must end
  const hg = mkGame('hero', 2);
  let hold = 0;
  for (let i = 0; i < 60 * 160 && hg.state === 'play'; i++) {
    const q = hg.player.pos;
    const h = crateHop(hg.course, q, hg.player.grounded, hg.frame);
    if (h.jump) hold = 26;
    hg.step({ x: h.x, z: h.z, jump: h.jump, jumpHeld: hold > 0, spin: false });
    if (hold > 0) hold--;
  }
  ok(hg.state === 'win' || hg.state === 'over',
    `the cove always reaches a verdict (${hg.state} at ${(hg.frame / 60).toFixed(1)}s)`);
  hg.disposeWorld();

  // the sea is the only judge: touch it and you're out
  const og = mkGame('hero', 2);
  og.player.body.setTranslation({ x: 20, y: -2, z: 0 }, true);
  for (let i = 0; i < 10 && og.state === 'play'; i++) {
    og.step({ x: 0, z: 0, jump: false, jumpHeld: false, spin: false });
  }
  ok(og.state === 'over', 'touching the sea ends the run (over)');
  og.disposeWorld();

  // every rival swimming while you're dry = last one standing (no buzzer)
  const wg = mkGame('hero', 2);
  for (const r of wg.rivals) {
    r.player.body.setTranslation({ x: 20, y: -2, z: 0 }, true);
  }
  for (let i = 0; i < 6 && wg.state === 'play'; i++) {
    wg.step({ x: 0, z: 0, jump: false, jumpHeld: false, spin: false });
  }
  ok(wg.state === 'win' && wg.rivals.every((r) => r.out),
    'last one dry wins — the rivals must go in');
  wg.disposeWorld();

  // the showdown deck shrinks into a sumo ring once it stands alone
  const sg = mkGame('hero', 2);
  for (const k of sg.course.crates) if (k.sinkAt !== Infinity) k.sinkAt = 0;
  for (let f = 0; f < 60 * 6; f++) crateStep(sg.course, f);
  const last = sg.course.crates.find((k) => k.sinkAt === Infinity);
  ok(sg.course.showdownAt != null && last.half === CRATES.half,
    'one deck left → the showdown arms (full size during the grace)');
  for (let f = 60 * 6; f < 60 * 24; f++) crateStep(sg.course, f);
  ok(last.half <= CRATES.shrinkTo + 1e-6,
    `the last deck shrinks into a sumo ring (half=${last.half.toFixed(2)})`);
  sg.disposeWorld();
}

// ---- 12) regressions from the Oct 2026 playtest ---------------------------
console.log('regressions');
{
  // one press = one jump: holding never re-arms, release must happen
  const jg = mkGame('hero', 0);
  jg.player.autoRun = false;
  let jumps = 0;
  for (let i = 0; i < 400; i++) {
    jg.step({ x: 0, jump: i === 0, jumpHeld: true, spin: false });
    if (jg.player.jumped) jumps++;
  }
  ok(jumps === 1, `jump: one press = one jump, hold never re-arms (got ${jumps})`);
  jg.step({ x: 0, jump: false, jumpHeld: false, spin: false });
  jg.step({ x: 0, jump: true, jumpHeld: true, spin: false });
  ok(jg.player.jumped, 'jump: release + press re-arms the next jump');
  jg.disposeWorld();

  // hammer damage covers the visible bar only (no phantom zone)
  const w = createWorld(R);
  const hm = makeHammer(R, w, 0, 0, 0);    // bar along +X, stationary
  const c = { hammers: [hm], pendulums: [], rollers: [], pistons: [] };
  hm.harm = 0;
  ok(!!hazardTouch(c, { x: 2.5, y: 0.7, z: 0 }),
    'hammer: hero at bar height inside the sweep is hit');
  ok(!hazardTouch(c, { x: 2.5, y: 2.0, z: 0 }),
    'hammer: jumping above the bar is safe');
  ok(!hazardTouch(c, { x: 5.7, y: 0.7, z: 0 }),
    'hammer: no phantom hit past the bar tip');
  w.free();
}

// ---- 13) two-player --------------------------------------------------------
console.log('two player');
{
  const g = mkGame('hero', 0);
  g.start(0, { twoPlayer: true, hero2Index: 2 });
  ok(g.players.length === 2 && g.runs.length === 2 && g.rivals.length === 3,
    'two-player: P1 + P2 + three rivals (5-runner field)');
  ok(Math.abs(g.players[1].pos.x - g.players[0].pos.x) > 0.2,
    'P2 spawns beside P1, not inside them');
  ok(g.players[1].maxHp === g.players[1].hp && g.players[0].hp > 0,
    'both players carry their own hearts');

  // both bots clear Daybreak: same zone-edge jump contract for each slot
  const zones = g.course.jumpZones, narrows = g.course.narrows;
  const holds = [0, 0];
  const bot = (i) => {
    const run = g.runs[i];
    const q = run.P.pos;
    const jump = holds[i] === 0 && run.P.grounded &&
      zones.some(([a, b]) => q.z > a && q.z < b);
    if (jump) holds[i] = 32;
    let steer = 0;
    for (const [z0, z1, , cx = 0] of narrows) {
      if (q.z > z0 - 1.5 && q.z < z1 && Math.abs(q.x - cx) > 0.5) {
        steer = Math.sign(cx - q.x); break;
      }
    }
    const f = { x: steer, jump, jumpHeld: holds[i] > 0, spin: false };
    if (holds[i] > 0) holds[i]--;
    return f;
  };
  for (let i = 0; i < 9600 && g.state === 'play'; i++) {
    g.step([bot(0), bot(1)]);
  }
  ok(g.state === 'clear' && g.runs.every((r) => r.finished),
    `two-player race clears with BOTH finishers (state=${g.state})`);
  ok(g.clearPlaces.length === 2 && g.clearPlaces.every((p) => p >= 1 && p <= 4),
    `dual places are AI-relative (${g.clearPlaces.join(' / ')})`);
  ok(g.coins === g.runs[0].coins && g.runs[1].coins >= 0,
    'coins stay personal per player');
  g.disposeWorld();

  // crates 2P: both dry when the AI field is gone = both clear
  const cg = mkGame('hero', 2);
  cg.start(2, { twoPlayer: true, hero2Index: 1 });
  ok(cg.runs.length === 2 && cg.rivals.length === 3,
    'crates 2P: two players, three rivals');
  for (const r of cg.rivals) {
    r.player.body.setTranslation({ x: 30, y: -2, z: 0 }, true);
  }
  const idle = { x: 0, z: 0, jump: false, jumpHeld: false, spin: false };
  for (let i = 0; i < 8 && cg.state === 'play'; i++) cg.step([idle, idle]);
  ok(cg.state === 'win' && cg.runs.every((r) => r.survived),
    'crates 2P: both players dry = both clear the cove');
  cg.disposeWorld();

  // arena 2P is co-op: both must still be standing at the buzzer
  const ag = mkGame('hero', 3);
  ag.start(3, { twoPlayer: true, hero2Index: 1 });
  ag.hazardsOff = true;
  for (let i = 0; i < 60 * 64 && ag.state === 'play'; i++) {
    for (const P of ag.players) {
      P.body.setTranslation({ x: 0, y: 1.2, z: 0 }, true);
    }
    ag.step([idle, idle]);
  }
  ok(ag.state === 'win' && ag.runs.every((r) => !r.out),
    'arena 2P co-op: both survive 60s → win');
  ag.disposeWorld();

  const fg = mkGame('hero', 3);
  fg.start(3, { twoPlayer: true, hero2Index: 1 });
  fg.hazardsOff = true;
  fg.runs[1].out = true;                 // P2 went in — co-op can't clear
  fg.players[1].body.setTranslation({ x: 0, y: -40, z: 0 }, true);
  for (let i = 0; i < 60 * 64 && fg.state === 'play'; i++) {
    fg.players[0].body.setTranslation({ x: 0, y: 1.2, z: 0 }, true);
    fg.step([idle, idle]);
  }
  ok(fg.state === 'over', 'arena 2P: one splash ends the co-op run');
  fg.disposeWorld();
}

// ---- 14) punch / carry / throw (Crate Cove + Arena) -----------------------
console.log('carry & throw');
{
  const idle = { x: 0, z: 0, jump: false, jumpHeld: false, spin: false };
  const g = mkGame('hero', 2);
  g.start(2, { twoPlayer: true, hero2Index: HERO_IDS.indexOf('yas') });
  const P1 = g.runs[0].P, P2 = g.runs[1].P;
  const q = P1.pos;
  P2.body.setTranslation({ x: q.x + 0.5, y: q.y, z: q.z }, true);
  for (let i = 0; i < 3; i++) g.step([idle, idle]);

  g.step([{ ...idle, spin: true }, idle]);
  ok(P1.carry === P2 && P2.carrier === P1,
    'grab: the action button hoists a neighbour');
  ok(P2.pos.y > P1.pos.y + 0.5,
    'carry: the carried hero rides the carrier’s head');

  for (let i = 0; i < 6; i++) {
    g.step([idle, { ...idle, jump: true }]);
    g.step([idle, idle]);
  }
  ok(!P2.carrier, 'escape: mashing jump breaks the hold');
  ok(P2.stun > 0, 'escape: the escapee stumbles free');

  P2.body.setTranslation({ x: P1.pos.x + 0.4, y: P1.pos.y, z: P1.pos.z }, true);
  for (let i = 0; i < 3; i++) g.step([idle, idle]);
  g.step([{ ...idle, spin: true }, idle]);
  ok(P1.carry === P2, 'grab again for the throw');
  g.step([{ ...idle, spin: true }, idle]);
  ok(!P1.carry && !P2.carrier && P2.throwT > 0 && P2.vy > 0,
    'throw: the action button hurls the carried hero forward + up');

  // punch: a neighbour inside punch reach (outside grab reach) staggers
  const p1 = P1.pos;
  P2.body.setTranslation({ x: p1.x + 1.2, y: p1.y, z: p1.z }, true);
  for (let i = 0; i < 2; i++) g.step([idle, idle]);
  g.step([{ ...idle, spin: true }, idle]);
  ok(P2.stun > 0 && !P1.carry, 'punch: a punch staggers a nearby character');

  // rivals fight back: an AI rival grabs a player who lingers
  const r0 = g.rivals[0];
  r0.player.body.setTranslation({ x: P1.pos.x + 0.4, y: P1.pos.y, z: P1.pos.z }, true);
  r0.actT = 0;
  for (let i = 0; i < 4 && !r0.player.carry; i++) g.step([idle, idle]);
  ok(r0.player.carry === P1, 'rivals fight back: an AI rival grabs a player');
  g.disposeWorld();
}

// ---- done -----------------------------------------------------------------
if (fails) {
  console.error(`\n${fails} headless check(s) FAILED`);
  process.exit(1);
}
console.log('\nall headless checks passed');
