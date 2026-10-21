// Boot + state machine + fixed-timestep loop. The one place that touches
// DOM/window: wires Input → Game → Renderer → UI. States mirror game.js:
// title / select / map / play / pause / clear / victory.

import Input from './input.js';
import * as Gamepad from './gamepad.js';
import { measure, view } from './view.js';
import { applyLang, toggleLang, t } from './i18n.js';
import { initPhysics, STEP } from './phys.js';
import Game from './game.js';
import { LEVELS, ARENA } from './levels.js';
import { placement } from './rivals.js';
import { Renderer } from './renderer.js';
import { UI } from './ui.js';
import audio from './audio.js';

const STEP_MS = STEP * 1000;
const PROGRESS_KEY = 'pixelbros3d_progress';
const BEST_KEY = 'pixelbros3d_arena_best';   // survival record (ARENA.dur = win)
const INPUT_KEY = 'pixelbros3d_input';       // 'keyboard' | 'controller'

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
  // survival best (seconds survived; ARENA.dur = the full 90s win)
  let survBest = 0;
  let survSaved = true;          // one-shot per survival run
  try { survBest = parseFloat(localStorage.getItem(BEST_KEY)) || 0; } catch { /* */ }
  // input device (title-screen segment): keyboard is the default — the pad
  // never drives until the player opts in; controller mode keeps the
  // keyboard alive too, so a dead pad battery can never lock anyone out
  let inputMode = 'keyboard';
  try {
    inputMode = localStorage.getItem(INPUT_KEY) === 'controller'
      ? 'controller' : 'keyboard';
  } catch { /* private mode: keyboard */ }
  Gamepad.init();
  Gamepad.setEnabled(inputMode === 'controller');
  const saveSurvBest = (t) => {
    if (t <= survBest) return false;
    survBest = t;
    try { localStorage.setItem(BEST_KEY, String(t)); } catch { /* */ }
    return true;
  };

  const renderer = new Renderer(document.getElementById('gl'));
  const uiRoot = document.getElementById('ui');
  const ui = new UI(uiRoot, {
    onStart: toSelect,
    onInputDevice: (m) => {
      inputMode = m === 'controller' ? 'controller' : 'keyboard';
      try { localStorage.setItem(INPUT_KEY, inputMode); } catch { /* */ }
      Gamepad.setEnabled(inputMode === 'controller');
      ui.setInputMode(inputMode);
      audio.sfx('select');
    },
    onMove: (d) => { game.moveCursor(d); ui.setHero(game.heroIndex); },
    onPick: (i) => { game.heroIndex = i; ui.setHero(i); audio.sfx('select'); },
    onPlay: toMap,
    onResume: resume,
    onRetry: () => startLevel(game.levelIndex),
    onTitle: toTitle,
    onMapMove: (d) => { game.mapMove(d); audio.sfx('select'); updateMapUI(); },
    onMapPlay: () => startLevel(game.map.cursor),
    onDone: handleDone,
    onWinDone: winDone,
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
    game.enterMap(true);   // fresh run: map always opens on stage 1
    audio.setTheme(0);
    renderer.setHero('map:' + game.selectedHero());
    ui.show('map');
    updateMapUI();
  }
  function updateMapUI() {
    const c = game.map.cursor;
    const lvl = LEVELS[c];
    if (lvl.mode === 'survival') {
      ui.setMap(c + 1, t(lvl.nameKey), false, { arena: true, best: survBest });
      return;
    }
    ui.setMap(c + 1, t(lvl.nameKey), c < game.frontier);
  }
  // (re)build a run for stage levelIndex
  function startLevel(levelIndex) {
    game.start(levelIndex);
    survSaved = false;           // fresh survival attempt: arm the best-save
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
  // ENTER on the clear card: the hero walks onward — every race stage has
  // a next node now (Ridge's leads to the arena), no trophy before then
  function handleDone() {
    game.advanceFrontier();
    saveProgress();
    audio.sfx('confirm');
    renderer.setHero('map:' + game.selectedHero());
    ui.show('map');
    updateMapUI();
  }
  // ENTER on the arena's win card: trophy if the race ladder is done,
  // otherwise back to the map — the locked card already said what is owed
  function winDone() {
    if (game.claimVictory() === 'victory') {
      audio.sfx('trophy');
      ui.show('victory');
    } else {
      audio.sfx('confirm');
      renderer.setHero('map:' + game.selectedHero());
      ui.show('map');
      updateMapUI();
    }
  }

  // edge-triggered flags must fire exactly once even when a slow frame
  // runs several physics ticks
  let jumpEdge = false, spinEdge = false, zAxis = 0;
  let pauseOpt = 0;          // highlighted pause-menu option (0 resume, 1 retry, 2 title)

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
      // ESC is the pad's ◯: back out of the map to the title (like Q)
      if (Input.pressed('KeyQ') || Input.pressed('Escape')) toTitle();
    } else if (s === 'play') {
      if (Input.pressed('Escape')) {
        game.pause(); audio.duck(true); ui.show('pause');
        pauseOpt = 0; ui.setPauseFocus(0);   // Start/ESC always opens on Resume
      }
      if (Input.pressed('KeyR')) startLevel(game.levelIndex);
      // survival: Space is the ONLY jump (W/↑ drive the free-control rig);
      // racing: Space/W/↑ all hop
      if (game.mode === 'survival') {
        jumpEdge = Input.pressed('Space');
      } else {
        jumpEdge = Input.pressed('Space') || Input.pressed('ArrowUp') || Input.pressed('KeyW');
      }
      spinEdge = Input.pressed('ArrowDown') || Input.pressed('KeyS') || Input.pressed('ShiftLeft');
      // survival free-control throttle (race auto-run ignores this flag):
      // W/↑ drives toward +Z, S/↓ backs up; the stick feeds analog drive
      // through Gamepad.throttle when nothing is held on the keyboard
      const kbZ = (Input.isDown('KeyW') || Input.isDown('ArrowUp') ? 1 : 0)
        - (Input.isDown('KeyS') || Input.isDown('ArrowDown') ? 1 : 0);
      zAxis = kbZ !== 0 ? kbZ : Gamepad.getThrottle();
    } else if (s === 'pause') {
      // pause menu: ↑↓ (d-pad/stick too) cycle the highlighted option,
      // ✕/Enter picks it — ESC (or Start's ESC half) resumes; resume is
      // ordered FIRST so Start (ESC+Q) can never fall through to title
      if (Input.pressed('Escape')) { resume(); }
      else {
        if (Input.pressed('ArrowUp') || Input.pressed('KeyW')) {
          pauseOpt = (pauseOpt + 2) % 3; ui.setPauseFocus(pauseOpt); audio.sfx('select');
        }
        if (Input.pressed('ArrowDown') || Input.pressed('KeyS')) {
          pauseOpt = (pauseOpt + 1) % 3; ui.setPauseFocus(pauseOpt); audio.sfx('select');
        }
        if (Input.pressed('KeyR')) startLevel(game.levelIndex);
        else if (Input.pressed('Enter') || Input.pressed('Space')) {
          if (pauseOpt === 0) resume();
          else if (pauseOpt === 1) startLevel(game.levelIndex);
          else toTitle();
        }
        else if (Input.pressed('KeyQ')) toTitle();
      }
    } else if (s === 'clear') {
      if (Input.pressed('Enter')) handleDone();
    } else if (s === 'dq') {
      if (Input.pressed('Enter')) startLevel(game.levelIndex);
      if (Input.pressed('KeyQ') || Input.pressed('Escape')) toTitle();
    } else if (s === 'lost') {
      if (Input.pressed('Enter')) startLevel(game.levelIndex);
      if (Input.pressed('KeyQ') || Input.pressed('Escape')) toTitle();
    } else if (s === 'victory') {
      if (Input.pressed('Enter')) toTitle();
    } else if (s === 'over') {
      if (Input.pressed('Enter')) startLevel(game.levelIndex);
      if (Input.pressed('KeyQ') || Input.pressed('Escape')) toTitle();
    } else if (s === 'win') {
      if (Input.pressed('Enter')) winDone();
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

    // pad edges must land before key routing reads this frame's presses
    Gamepad.poll();
    handleKeys();

    while (acc >= STEP_MS) {
      const playing = game.state === 'play';
      // camera faces +Z, so world +X is screen-LEFT — steering is inverted
      game.step({
        x: playing ? -Input.axisX() : 0,
        z: playing ? zAxis : 0,
        jump: playing && jumpEdge,
        jumpHeld: playing && (Input.isDown('Space')
          || (game.mode !== 'survival'
            && (Input.isDown('ArrowUp') || Input.isDown('KeyW')))),
        spin: playing && spinEdge,
      });
      game.mapStep();
      jumpEdge = false;
      spinEdge = false;
      acc -= STEP_MS;
    }

    // menu shows the live hero on the pedestal; select slides it beside
    // the card, map shows the tiny one; victory reuses the same showcase
    // with the hero hoisting the trophy next to the card
    if (game.state === 'title' || game.state === 'select') {
      renderer.setHero('menu:' + game.selectedHero());
      renderer.setSelectHero(
        game.state === 'select' ? ui.selectHeroPx() : null);
    }
    if (game.state === 'victory') {
      renderer.setHero('menu:' + game.selectedHero());
      renderer.setSelectHero(ui.victoryHeroPx());
    }
    renderer.showTrophy(game.state === 'victory');
    // title row shows pad presence (poll runs in every mode for this)
    if (game.state === 'title') ui.setPadStatus(Gamepad.isConnected());
    if (game.state === 'play' && game.player) {
      if (game.mode === 'survival') {
        ui.hudSurvive(game.timeF / 60, game.wave, ARENA.dur,
          game.player.hp, game.player.maxHp);
      } else {
        ui.hud(game.coins, game.course.coinTotal, game.timeF / 60,
          placement(game), game.player.hp, game.player.maxHp, game.timeLimit);
      }
    }
    if (game.state === 'clear') {
      ui.show('clear');
      // every race stage now leads onward (Ridge → arena), so the card
      // always offers "next island"
      ui.clearStats(game.clearTime, game.coins, game.course.coinTotal,
        true, game.clearPlace);
    }
    if (game.state === 'dq') ui.show('dq');
    if (game.state === 'lost') {
      ui.show('lost');
      ui.lost(game.clearPlace, LEVELS[game.levelIndex].passPlace);
    }
    if (game.state === 'over' || game.state === 'win') {
      if (!survSaved) { survSaved = true; saveSurvBest(game.survTime); }
    }
    if (game.state === 'over') { ui.show('over'); ui.overStats(game.survTime, survBest); }
    if (game.state === 'win') { ui.show('win'); ui.winStats(survBest, game.allRacesCleared()); }

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
  ui.setInputMode(inputMode);
  ui.setPadStatus(false);
  requestAnimationFrame(frame);

  // PWA service worker — never on localhost, so the no-store dev server
  // can't be shadowed by a cached shell (same policy as the 2D game)
  if ('serviceWorker' in navigator
    && !['localhost', '127.0.0.1'].includes(location.hostname)) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

boot();
