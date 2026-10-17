// Keyboard input: held state + edge-triggered "pressed" lookups.
// Ported 1:1 from Super Pixel Bros (2D) — same pipeline, same headless
// contract: drive via press/release/tap, call endFrame() after every frame
// or edge triggers leak. addEventListener is guarded so the module can be
// imported under Node for headless checks.
const held = new Set();
const pressedSet = new Set();
const tapped = new Set(); // auto-released in endFrame (virtual button taps)

const BLOCK_DEFAULT = new Set([
  'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space', 'Enter',
]);

if (typeof addEventListener === 'function') {
  addEventListener('keydown', (e) => {
    if (BLOCK_DEFAULT.has(e.code)) e.preventDefault();
    if (!held.has(e.code)) pressedSet.add(e.code);
    held.add(e.code);
  });
  addEventListener('keyup', (e) => held.delete(e.code));
  addEventListener('blur', () => held.clear());
}

const Input = {
  isDown: (code) => held.has(code),
  pressed: (code) => pressedSet.has(code),
  anyPressed: () => pressedSet.size > 0,
  // virtual keys from touch controls (same edge-trigger semantics as keyboard)
  press(code) {
    if (!held.has(code)) pressedSet.add(code);
    held.add(code);
  },
  release(code) { held.delete(code); },
  // one-shot key press (canvas taps): fires `pressed` once, auto-released
  // at endFrame so taps never leak held state into the next frame
  tap(code) {
    if (!held.has(code)) pressedSet.add(code);
    held.add(code);
    tapped.add(code);
  },
  endFrame() {
    pressedSet.clear();
    for (const c of tapped) held.delete(c);
    tapped.clear();
  },
  // -1 / 0 / +1 horizontal axis from the keyboard
  axisX(leftCode = 'ArrowLeft', rightCode = 'ArrowRight') {
    const l = Input.isDown(leftCode) || Input.isDown('KeyA') ? 1 : 0;
    const r = Input.isDown(rightCode) || Input.isDown('KeyD') ? 1 : 0;
    return r - l;
  },
};

export default Input;
