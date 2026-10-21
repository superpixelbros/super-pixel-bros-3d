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
  2: ['Space'],       // X — alt jump
  3: ['Enter'],       // Y — confirm
  5: ['ShiftLeft'],   // RB — spin
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
}

// once per rAF, BEFORE handleKeys() so pad edges land in this frame.
// Scans in every mode so the title-screen status row is truthful even
// while the pad is disabled; only presses/releases when enabled.
export function poll() {
  if (!getPads) return;
  let pad = null;
  for (const p of getPads()) {
    if (p && p.connected) { pad = p; break; }
  }
  connected = !!pad;
  if (!enabled) { throttle = 0; return; }
  if (!pad) { releaseAll(); throttle = 0; return; }   // unplug: nothing sticks

  const want = new Set();
  for (const idx of Object.keys(BUTTONS)) {
    const b = pad.buttons[+idx];
    if (b && (b.pressed || b.value > 0.5)) {
      for (const c of BUTTONS[idx]) want.add(c);
    }
  }
  const ax = pad.axes[0] || 0;
  if (ax < -DEAD) want.add('ArrowLeft');
  else if (ax > DEAD) want.add('ArrowRight');
  // stick Y stays OUT of the arrow codes — mapped there it would fire race
  // jumps; survival reads Gamepad.throttle (forward = −Y on pads = +drive)
  const ay = pad.axes[1] || 0;
  throttle = Math.abs(ay) > DEAD ? -ay : 0;

  for (const c of want) if (!heldCodes.has(c)) Input.press(c);
  for (const c of heldCodes) if (!want.has(c)) Input.release(c);
  heldCodes.clear();
  for (const c of want) heldCodes.add(c);
}

export function isConnected() { return connected; }
export function getThrottle() { return throttle; }
