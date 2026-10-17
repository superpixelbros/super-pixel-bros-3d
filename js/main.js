// Boot + state machine + fixed-timestep loop. The one place that touches
// DOM/window: wires Input → Game → Renderer → UI. States mirror game.js:
// title / select / play / pause / clear.

import Input from './input.js';
import { measure, view } from './view.js';
import { applyLang, toggleLang } from './i18n.js';
import { initPhysics, STEP } from './phys.js';
import Game from './game.js';
import { Renderer } from './renderer.js';
import { UI } from './ui.js';

const STEP_MS = STEP * 1000;

async function boot() {
  measure();
  applyLang();

  const R = await initPhysics();
  const game = new Game(R);
  const renderer = new Renderer(document.getElementById('gl'));
  const uiRoot = document.getElementById('ui');
  const ui = new UI(uiRoot, {
    onStart: toSelect,
    onMove: (d) => { game.moveCursor(d); ui.setHero(game.heroIndex); },
    onPlay: startRun,
    onResume: resume,
    onRetry: startRun,
    onTitle: toTitle,
  });

  const rotateEl = document.getElementById('rotate');
  function updateRotateHint() {
    rotateEl.classList.toggle('hidden', !(view.portrait && view.coarse));
  }
  updateRotateHint();

  function toSelect() { game.state = 'select'; syncMenu(); }
  function startRun() {
    const id = game.selectedHero();
    game.start(id);
    renderer.buildCourse(game.course);
    renderer.setHero('play:' + id);
    ui.show('play');
  }
  function resume() { game.resume(); ui.show('play'); }
  function toTitle() { game.toTitle(); syncMenu(); }
  function syncMenu() {
    ui.show(game.state);
    ui.setHero(game.heroIndex);
  }

  // edge-triggered flags must fire exactly once even when a slow frame
  // runs several physics ticks
  let jumpEdge = false, spinEdge = false;

  function handleKeys() {
    const s = game.state;
    if (Input.pressed('KeyL')) { toggleLang(); ui.renderTexts(); }
    if (s === 'title') {
      if (Input.pressed('Enter') || Input.pressed('Space')) toSelect();
    } else if (s === 'select') {
      if (Input.pressed('ArrowLeft') || Input.pressed('KeyA')) { game.moveCursor(-1); ui.setHero(game.heroIndex); }
      if (Input.pressed('ArrowRight') || Input.pressed('KeyD')) { game.moveCursor(1); ui.setHero(game.heroIndex); }
      if (Input.pressed('Enter') || Input.pressed('Space')) startRun();
    } else if (s === 'play') {
      if (Input.pressed('Escape')) { game.pause(); ui.show('pause'); }
      if (Input.pressed('KeyR')) startRun();
      jumpEdge = Input.pressed('Space') || Input.pressed('ArrowUp') || Input.pressed('KeyW');
      spinEdge = Input.pressed('ArrowDown') || Input.pressed('KeyS') || Input.pressed('ShiftLeft');
    } else if (s === 'pause') {
      if (Input.pressed('Escape')) resume();
      if (Input.pressed('KeyR')) startRun();
      if (Input.pressed('KeyQ')) toTitle();
    } else if (s === 'clear') {
      if (Input.pressed('Enter')) toTitle();
    }
  }

  let last = performance.now();
  let acc = 0;

  function frame(now) {
    requestAnimationFrame(frame);
    let dt = now - last;
    last = now;
    if (dt > 250) dt = 250;
    acc += dt;

    handleKeys();

    while (acc >= STEP_MS) {
      const playing = game.state === 'play';
      // camera faces +Z, so world +X is screen-LEFT — steering is inverted
      game.step({
        x: playing ? -Input.axisX() : 0,
        jump: playing && jumpEdge,
        jumpHeld: playing && (Input.isDown('Space') || Input.isDown('ArrowUp') || Input.isDown('KeyW')),
        spin: playing && spinEdge,
      });
      jumpEdge = false;
      spinEdge = false;
      acc -= STEP_MS;
    }

    // menu shows the live hero on the pedestal
    if (game.state === 'title' || game.state === 'select') {
      renderer.setHero('menu:' + game.selectedHero());
    }
    if (game.state === 'play' && game.player) {
      ui.hud(game.coins, game.course.coinTotal, game.timeF / 60);
    }
    if (game.state === 'clear') {
      ui.show('clear');
      ui.clearStats(game.clearTime, game.coins, game.course.coinTotal);
    }

    renderer.sync(game, game.state);
    renderer.render();
    Input.endFrame();
  }

  addEventListener('resize', () => {
    measure();
    renderer.resize();
    updateRotateHint();
  });

  ui.show('title');
  ui.setHero(0);
  requestAnimationFrame(frame);

  // PWA service worker — never on localhost, so the no-store dev server
  // can't be shadowed by a cached shell (same policy as the 2D game)
  if ('serviceWorker' in navigator
    && !['localhost', '127.0.0.1'].includes(location.hostname)) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

boot();
