// Runtime viewport metrics for the 3D game. Unlike the 2D game the canvas
// is full-window (3D has no fixed internal resolution); what we do pin down
// is dpr (capped for mobile perf), CSS size, and coarse-pointer state.

export const view = {
  w: 960,          // CSS pixels
  h: 540,
  dpr: 1,
  portrait: false,
  coarse: false,   // touch device
};

export function measure() {
  view.w = window.innerWidth;
  view.h = window.innerHeight;
  view.dpr = Math.min(window.devicePixelRatio || 1, 1.5); // perf budget
  view.portrait = view.h > view.w;
  view.coarse = window.matchMedia &&
    window.matchMedia('(pointer: coarse)').matches;
  return view;
}
