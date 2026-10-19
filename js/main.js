// Boot + state machine + fixed-timestep loop. The one place that touches
// DOM/window: wires Input → Game → Renderer → UI. States mirror game.js:
// title / select / map / play / pause / clear / victory.

import Input from './input.js';
import { measure, view } from './view.js';
import { applyLang, toggleLang, t } from './i18n.js';
import { initPhysics, STEP } from './phys.js';
import Game from './game.js';
import { LEVELS } from './levels.js';
import { placement } from './rivals.js';
import { Renderer } from './renderer.js';
import { UI } from './ui.js';
import audio from './audio.js';

const STEP_MS = STEP * 1000;
const PROGRESS_KEY = 'pixelbros3d_progress';

async function boot() {
  measure();
  applyLang();

  const R = await initPhysics();
  const game = new Game(R);
  // adventure progress (which stage the hero has reached)
  try {
    game.frontier = Math.max(0,
      Math.min(LEVELS.length - 1,
        parseInt(localStorage.getItem(PROGRESS_KEY), 10) || 0));
  } catch { /* private mode: start fresh */ }
  const saveProgress = () => {
    try { localStorage.setItem(PROGRESS_KEY, String(game.frontier)); } catch { /* */ }
  };

  const renderer = new Renderer(document.getElementById('gl'));
  const uiRoot = document.getElementById('ui');
  const ui = new UI(uiRoot, {
    onStart: toSelect,
    onMove: (d) => { game.moveCursor(d); ui.setHero(game.heroIndex); },
    onPlay: toMap,
    onResume: resume,
    onRetry: () => startLevel(game.levelIndex),
    onTitle: toTitle,
    onMapMove: (d) => { game.mapMove(d); audio.sfx('select'); updateMapUI(); },
    onMapPlay: () => startLevel(game.map.cursor),
    onDone: handleDone,
  });

  const rotateEl = document.getElementById('rotate');

  // Web Audio needs a user gesture; unlock on the very first key/pointer
  const unlockAudio = () => audio.unlock();
  addEventListener('keydown', unlockAudio, { once: true });
  addEventListener('pointerdown', unlockAudio, { once: true });
  game.sfx = (n) => audio.sfx(n);

  function updateRotateHint() {
    rotateEl.classList.toggle('hidden', !(view.portrait && view.coarse));
  }
  updateRotateHint();

  function toSelect() { game.state = 'select'; audio.sfx('select'); syncMenu(); }
  function toMap() {
    game.enterMap();
    audio.setTheme(0);
    renderer.setHero('map:' + game.selectedHero());
    ui.show('map');
    updateMapUI();
  }
  function updateMapUI() {
    const c = game.map.cursor;
    ui.setMap(c + 1, t(LEVELS[c].nameKey), c < game.frontier);
  }
  // (re)build a run for stage levelIndex
  function startLevel(levelIndex) {
    game.start(levelIndex);
    renderer.buildCourse(game.course);
    renderer.setRivals(game.rivals);
    renderer.setHero('play:' + game.selectedHero());
    ui.show('play');
    audio.setTheme(levelIndex);
    audio.duck(false);
    audio.sfx('confirm');
  }
  function resume() { game.resume(); audio.duck(false); ui.show('play'); }
  function toTitle() { game.toTitle(); audio.duck(false); syncMenu(); }
  function syncMenu() {
    ui.show(game.state);
    ui.setHero(game.heroIndex);
  }
  // ENTER on the clear card: walk the map onward, or take the trophy
  function handleDone() {
    const r = game.advanceFrontier();
    saveProgress();
    if (r === 'victory') { audio.sfx('trophy'); ui.show('victory'); }
    else {
      audio.sfx('confirm');
      renderer.setHero('map:' + game.selectedHero());
      ui.show('map');
      updateMapUI();
    }
  }

  // edge-triggered flags must fire exactly once even when a slow frame
  // runs several physics ticks
  let jumpEdge = false, spinEdge = false;

  function handleKeys() {
    const s = game.state;
    if (Input.pressed('KeyL')) { toggleLang(); ui.renderTexts(); }
    if (Input.pressed('KeyM')) audio.toggleMute();
    if (s === 'title') {
      if (Input.pressed('Enter') || Input.pressed('Space')) toSelect();
    } else if (s === 'select') {
      if (Input.pressed('ArrowLeft') || Input.pressed('KeyA')) { game.moveCursor(-1); ui.setHero(game.heroIndex); }
      if (Input.pressed('ArrowRight') || Input.pressed('KeyD')) { game.moveCursor(1); ui.setHero(game.heroIndex); }
      if (Input.pressed('Enter') || Input.pressed('Space')) toMap();
    } else if (s === 'map') {
      if (Input.pressed('ArrowLeft') || Input.pressed('KeyA')) { game.mapMove(-1); audio.sfx('select'); updateMapUI(); }
      if (Input.pressed('ArrowRight') || Input.pressed('KeyD')) { game.mapMove(1); audio.sfx('select'); updateMapUI(); }
      if (Input.pressed('Enter') || Input.pressed('Space')) startLevel(game.map.cursor);
      if (Input.pressed('KeyQ')) toTitle();
    } else if (s === 'play') {
      if (Input.pressed('Escape')) { game.pause(); audio.duck(true); ui.show('pause'); }
      if (Input.pressed('KeyR')) startLevel(game.levelIndex);
      jumpEdge = Input.pressed('Space') || Input.pressed('ArrowUp') || Input.pressed('KeyW');
      spinEdge = Input.pressed('ArrowDown') || Input.pressed('KeyS') || Input.pressed('ShiftLeft');
    } else if (s === 'pause') {
      if (Input.pressed('Escape')) resume();
      if (Input.pressed('KeyR')) startLevel(game.levelIndex);
      if (Input.pressed('KeyQ')) toTitle();
    } else if (s === 'clear') {
      if (Input.pressed('Enter')) handleDone();
    } else if (s === 'dq') {
      if (Input.pressed('Enter')) startLevel(game.levelIndex);
      if (Input.pressed('KeyQ')) toTitle();
    } else if (s === 'victory') {
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
      game.mapStep();
      jumpEdge = false;
      spinEdge = false;
      acc -= STEP_MS;
    }

    // menu shows the live hero on the pedestal; map shows the tiny one
    if (game.state === 'title' || game.state === 'select') {
      renderer.setHero('menu:' + game.selectedHero());
    }
    if (game.state === 'play' && game.player) {
      ui.hud(game.coins, game.course.coinTotal, game.timeF / 60,
        placement(game), game.player.hp, game.player.maxHp, game.timeLimit);
    }
    if (game.state === 'clear') {
      ui.show('clear');
      ui.clearStats(game.clearTime, game.coins, game.course.coinTotal,
        !game.isLastStage(), game.clearPlace);
    }
    if (game.state === 'dq') ui.show('dq');

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
