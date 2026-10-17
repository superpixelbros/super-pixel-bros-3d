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
import { HERO_IDS } from '../js/hero.js';

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

function mkGame(id) {
  const g = new Game(R);
  g.start(id);
  return g;
}

const g = mkGame('rosso');
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
g2.player.body.setTranslation({ x: 0, y: -40, z: 40 }, true);
g2.step({ x: 0, jump: false, jumpHeld: false, spin: false });
ok(g2.player.pos.y > -5 && g2.deaths === 1, 'falling respawns at checkpoint');

// finish → clear
const g3 = mkGame('aqua');
g3.player.body.setTranslation({ x: 0, y: 1.2, z: g3.course.finishZ - 1.5 }, true);
for (let i = 0; i < 120 && g3.state === 'play'; i++) {
  g3.step({ x: 0, jump: false, jumpHeld: false, spin: false });
}
ok(g3.state === 'clear' && g3.clearTime > 0, `finished → clear in ${g3.clearTime?.toFixed?.(1)}s`);

// every hero must actually CLEAR the course's first sections under its own
// jump envelope: run the gap at z16-19, then hop both steps (0.7m, 1.4m).
// (seed of the per-hero reachability checker — extend when adding course geometry)
console.log('roster reachability');
for (const id of HERO_IDS) {
  const h = mkGame(id);
  let hold = 0;
  for (let i = 0; i < 900 && h.player.pos.z < 36; i++) {
    const q = h.player.pos;
    const atEdge = (a, b) => q.z > a && q.z < b;
    const jump = h.player.grounded &&
      (atEdge(14.6, 15.4) || atEdge(29.3, 30.3) || atEdge(32.3, 33.3));
    if (jump) hold = 32; // hold to apex — slow heroes need full height
    h.step({ x: 0, jump, jumpHeld: hold > 0, spin: false });
    if (hold > 0) hold--;
  }
  const q = h.player.pos;
  ok(Number.isFinite(q.x + q.y + q.z) && q.z > 36,
    `${id}: cleared gap + steps, reached z=${q.z.toFixed(1)}`);
  h.disposeWorld();
}
g.disposeWorld(); g2.disposeWorld(); g3.disposeWorld();

// ---- done -----------------------------------------------------------------
if (fails) {
  console.error(`\n${fails} headless check(s) FAILED`);
  process.exit(1);
}
console.log('\nall headless checks passed');
