// Gamepad source: polls the browser-native W3C Gamepad API and feeds
// standard-mapping presses into Input as the SAME virtual key codes the
// keyboard uses — so main.js's steering negation, menu keys and the
// survival throttle all keep working untouched, and the pure-logic core
// never learns a pad exists. Zero dependencies (the runtime-deps cap is
// three + rapier); Node-safe: poll() is a no-op without a navigator, and
// the pad getter is injectable for headless mapping smoke tests.
//
// The F710 in XInput mode (USB 046d:c21f) speaks the STANDARD mapping,
// so button indices below are browser-normalized, not vendor quirks.

import Input from './input.js';

// standard-mapping button index → virtual key code(s)
const BUTTONS = {
  // ✕ (bottom) — jump AND the universal confirm: the clear/lost/DQ/win
  // cards listen for Enter only, races for Space; pressing both is safe
  // because every menu branch fires its action once per frame
  0: ['Space', 'Enter'],
  1: ['Escape'],      // ◯ (right) — universal back: play→pause, pause→
                      // resume, map/cards→title (main.js routes ESC)
  2: ['ShiftLeft'],   // □ (left of the right cluster) — ACTION in the
                      // free modes: punch → grab → throw
  3: ['Enter'],       // Y — confirm
  5: ['ShiftLeft'],   // RB — spin (races) / action (free modes)
  9: ['Escape', 'KeyQ'], // Start — context quit: ESC half opens/resumes
                      // the pause (main.js orders resume before Q), Q
                      // half quits to title on map & cards
  12: ['ArrowUp'],    // d-pad up (race jump, survival forward)
  13: ['ArrowDown'],  // d-pad down (race spin, survival brake/reverse)
  14: ['ArrowLeft'],
  15: ['ArrowRight'],
};

const DEAD = 0.3;   // stick deadzone — tired F710s drift a little

let getPads = null;      // injected or navigator-backed; null until init
let enabled = false;     // gated by the title-screen INPUT DEVICE setting
let connected = false;
let throttle = 0;        // analog survival drive, −1..+1 (forward = +1)
const heldCodes = new Set();   // codes the pad currently holds
const slotHeld = [new Set(), new Set()];   // per-player button edges
const seenPads = new Set();    // pad indices already registered once

export function init(get) {
  getPads = get || (() =>
    (typeof navigator !== 'undefined' && navigator.getGamepads)
      ? navigator.getGamepads() : []);
}

export function setEnabled(on) {
  enabled = !!on;
  if (!enabled) { releaseAll(); connected = false; throttle = 0; }
}

function releaseAll() {
  for (const c of heldCodes) Input.release(c);
  heldCodes.clear();
  for (const s of slotHeld) s.clear();
}

// Live gamepad list. navigator.getGamepads() is an ARRAY-LIKE (GamepadList)
// in several browsers — never assume Symbol.iterator; index loops only.
// Sorted by pad index so slot 0 is always the lowest-index pad.
function connectedPads() {
  const out = [];
  if (!getPads) return out;
  const list = getPads() || [];
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    if (p && p.connected) out.push(p);
  }
  out.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  return out;
}

// how many pads are live right now (title options need this)
export function padCount() {
  return connectedPads().length;
}

// once per rAF, BEFORE handleKeys() so pad edges land in this frame.
// Scans in every mode so the title-screen status row is truthful even
// while the pad is disabled; only presses/releases when enabled.
// `inject: false` skips feeding Input — used while playing with pad
// players so a pad never also drives the keyboard slot.
export function poll(opts = {}) {
  if (!getPads) return;
  const pads = connectedPads();
  connected = pads.length > 0;
  // a pad that registers NOW was just woken by a button press — that press
  // (usually ✕ = Enter) must not start the game or confirm a menu, so the
  // first poll after a new pad appears is swallowed.
  let fresh = false;
  for (const p of pads) {
    const idx = p.index ?? 0;
    if (!seenPads.has(idx)) { seenPads.add(idx); fresh = true; }
  }
  for (const idx of Array.from(seenPads)) {
    if (!pads.some((p) => (p.index ?? 0) === idx)) seenPads.delete(idx);
  }
  if (!enabled) { throttle = 0; return; }
  if (!pads.length) { releaseAll(); throttle = 0; return; }  // unplug: nothing sticks
  if (fresh) { heldCodes.clear(); return; }

  // menu input from ANY pad: Start/ESC on pad 2 must pause the 2P run too
  const want = new Set();
  for (const pad of pads) {
    for (const idx of Object.keys(BUTTONS)) {
      const b = pad.buttons[+idx];
      if (b && (b.pressed || b.value > 0.5)) {
        for (const c of BUTTONS[idx]) want.add(c);
      }
    }
    const ax = pad.axes[0] || 0;
    if (ax < -DEAD) want.add('ArrowLeft');
    else if (ax > DEAD) want.add('ArrowRight');
  }
  // stick Y stays OUT of the arrow codes — mapped there it would fire race
  // jumps; survival reads Gamepad.throttle (forward = −Y on pads = +drive)
  throttle = 0;
  for (const pad of pads) {
    const ay = pad.axes[1] || 0;
    if (Math.abs(ay) > DEAD) { throttle = -ay; break; }
  }

  // optional whitelist: during a run only MENU codes reach Input (pause,
  // restart, mute, language) so a pad never drives the keyboard slot
  let feed = want;
  if (opts.only) {
    feed = new Set();
    for (const c of want) if (opts.only.includes(c)) feed.add(c);
  }
  if (opts.inject === false) { heldCodes.clear(); return; }
  for (const c of feed) if (!heldCodes.has(c)) Input.press(c);
  for (const c of heldCodes) if (!feed.has(c)) Input.release(c);
  heldCodes.clear();
  for (const c of feed) heldCodes.add(c);
}

// Two-player slots: the live pads, lowest index first. Each returns its own
// edge/hold state — the pads never touch Input here, so the keyboard player
// keeps a clean stream. Slot 0 is ALWAYS the lowest-index pad.
// A slot that exists but has no pad attached. ALWAYS fully shaped: a
// missing field would leak NaN into Player.step (flags.x * speed) and
// silently kill that player's physics — the old bare {connected:false}
// did exactly that when Input Device was toggled to keyboard mid-2P.
const deadSlot = () => ({
  connected: false, index: -1, id: '', x: 0, z: 0, throttle: 0,
  jump: false, jumpPressed: false, spin: false,
  left: false, right: false, up: false, down: false,
});

export function pollSlots() {
  const out = [];
  if (!enabled || !getPads) {
    for (const s of slotHeld) s.clear();
    return [deadSlot(), deadSlot()];
  }
  const pads = connectedPads();
  for (let s = 0; s < 2; s++) {
    const pad = pads[s] || null;
    const held = slotHeld[s];
    if (!pad) { held.clear(); out.push(deadSlot()); continue; }
    const st = {
      connected: true, index: pad.index, id: pad.id,
      x: 0, z: 0, throttle: 0,
      jump: false, jumpPressed: false, spin: false,
      left: false, right: false, up: false, down: false,
    };
    const want = new Set();
    for (const idx of Object.keys(BUTTONS)) {
      const b = pad.buttons[+idx];
      if (b && (b.pressed || b.value > 0.5)) {
        for (const c of BUTTONS[idx]) want.add(c);
      }
    }
    const edge = (code) => want.has(code) && !held.has(code);
    const ax = pad.axes[0] || 0, ay = pad.axes[1] || 0;
    st.x = Math.abs(ax) > DEAD ? Math.sign(ax)
      : (want.has('ArrowRight') ? 1 : 0) - (want.has('ArrowLeft') ? 1 : 0);
    st.z = Math.abs(ay) > DEAD ? -ay
      : (want.has('ArrowUp') ? 1 : 0) - (want.has('ArrowDown') ? 1 : 0);
    st.throttle = st.z;
    st.jump = want.has('Space');
    st.jumpPressed = edge('Space');
    st.spin = edge('ShiftLeft');
    // menu edges: the select screen reads these directly, so a pad can
    // always pick a hero even while Input injection is off
    st.left = edge('ArrowLeft');
    st.right = edge('ArrowRight');
    st.up = edge('ArrowUp');
    st.down = edge('ArrowDown');
    held.clear();
    for (const c of want) held.add(c);
    out.push(st);
  }
  return out;
}

export function isConnected() { return connected; }
export function getThrottle() { return throttle; }
