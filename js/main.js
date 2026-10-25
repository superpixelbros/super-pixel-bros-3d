// Boot + state machine + fixed-timestep loop. The one place that touches
// DOM/window: wires Input → Game → Renderer → UI. States mirror game.js:
// title / select / map / play / pause / clear / victory.

import Input from './input.js';
import * as Gamepad from './gamepad.js';
import { measure, view } from './view.js';
import { applyLang, toggleLang, t } from './i18n.js';
import { initPhysics, STEP } from './phys.js';
import Game from './game.js';
import { LEVELS, ARENA, CRATES } from './levels.js';
import { HERO_IDS, stepHeroGrid } from './hero.js';
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

  // two-player settings: PLAYERS (needs a pad) and SPLIT orientation
  let twoPlayer = false;
  let splitMode = 'v';
  let selectPass = 0;            // select screen: 0 = P1 picks, 1 = P2
  let slots = ['keys', null];    // per-player device: 'pad' | 'keys'
  try {
    twoPlayer = localStorage.getItem('pixelbros3d_players') === '2';
    splitMode = localStorage.getItem('pixelbros3d_split') === 'h' ? 'h' : 'v';
  } catch { /* private mode: defaults */ }
  const canTwo = () => Gamepad.padCount() > 0;

  Gamepad.init();
  Gamepad.setEnabled(inputMode === 'controller' || twoPlayer);
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
      // 2P always needs the pads, whatever the 1P input preference says
      Gamepad.setEnabled(inputMode === 'controller' || twoPlayer);
      ui.setInputMode(inputMode);
      audio.sfx('select');
    },
    onMove: (d) => movePick(d),
    onPick: (i) => pickHero(i),
    onPlay: toMap,
    onResume: resume,
    onRetry: () => startLevel(game.levelIndex),
    onTitle: toTitle,
    onMapMove: (d) => { game.mapMove(d); audio.sfx('select'); updateMapUI(); },
    onMapPlay: () => startLevel(game.map.cursor),
    onDone: handleDone,
    onWinDone: winDone,
    onPlayers: setPlayersMode,
    onSplit: setSplitMode,
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

  function setPlayersMode(n) {
    twoPlayer = n === 2 && canTwo();
    try {
      localStorage.setItem('pixelbros3d_players', twoPlayer ? '2' : '1');
    } catch { /* */ }
    if (twoPlayer) Gamepad.setEnabled(true);   // 2P always needs the pad
    ui.setPlayers(twoPlayer ? 2 : 1, canTwo(), Gamepad.padCount());
    audio.sfx('select');
  }

  function setSplitMode(m) {
    splitMode = m === 'h' ? 'h' : 'v';
    try { localStorage.setItem('pixelbros3d_split', splitMode); } catch { /* */ }
    ui.setSplit(splitMode);
    renderer.setSplit(twoPlayer, splitMode);
    audio.sfx('select');
  }

  // device assignment follows the pads that are ACTUALLY connected:
  // 2 pads → both players on pads; 1 pad → P1 pad, P2 keyboard (2P is
  // gated on a pad, so a keyboard-only 2P setup can never happen).
  // In 1P the pad only drives when controller mode is selected.
  function assignSlots() {
    const pads = Gamepad.padCount();
    if (!twoPlayer) {
      slots = pads > 0 && inputMode === 'controller'
        ? ['pad', null] : ['keys', null];
      return;
    }
    if (pads === 0) return;               // keep the last binding on a drop
    slots = pads >= 2 ? ['pad0', 'pad1'] : ['pad0', 'keys'];
  }

  const padFlags = (s = {}, playing) => ({
    // `|| 0` / `!!`: a slot must never leak undefined into Player.step
    // (flags.x * speed = NaN freezes that player's physics for the run)
    x: playing ? -(s.x || 0) : 0,
    z: playing ? (s.z || 0) : 0,
    jump: !!(playing && s.jumpPressed),
    jumpHeld: !!(playing && s.jump),
    spin: !!(playing && s.spin),
  });

  // pad-driven menu navigation: edges straight from the slot layer, so a
  // pad can pick a hero even when Input injection is disabled
  function padNav(slots) {
    let dx = 0, dy = 0, confirm = false;
    for (const s of slots || []) {
      if (!s || !s.connected) continue;
      if (!dx) dx = (s.right ? 1 : 0) - (s.left ? 1 : 0);
      if (!dy) dy = (s.down ? 1 : 0) - (s.up ? 1 : 0);
      confirm = confirm || !!s.jumpPressed;
    }
    return { dx, dy, confirm };
  }

  // 1P controller mode keeps the KEYBOARD live too (dead battery = no
  // lock-out): merge both streams
  const mergeFlags = (kb, pad) => ({
    x: kb.x !== 0 ? kb.x : pad.x,
    z: kb.z !== 0 ? kb.z : pad.z,
    jump: kb.jump || pad.jump,
    jumpHeld: kb.jumpHeld || pad.jumpHeld,
    spin: kb.spin || pad.spin,
  });

  function toSelect() {
    selectPass = 0;
    if (twoPlayer) Gamepad.setEnabled(true);   // P2's pad must be live here
    game.state = 'select';
    ui.setSelectPass(0);
    audio.sfx('select');
    syncMenu();
  }
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
  // select-screen hero picking: pass 0 edits P1, pass 1 edits P2.
  // Horizontal wraps around the row; vertical steps exactly one ROW using
  // the grid's live column count and NEVER leaves the grid — the last row
  // is short, so a Down from it simply stays put instead of jumping
  // columns.
  function movePick(dx, dy = 0) {
    const p2 = twoPlayer && selectPass === 1;
    const cur = p2 ? game.hero2Index : game.heroIndex;
    const next = stepHeroGrid(cur, dx, dy, ui.gridColumns(), HERO_IDS.length);
    if (next === cur) return;
    if (p2) game.hero2Index = next;
    else game.heroIndex = next;
    ui.setHero(next);
    audio.sfx('select');
  }
  function pickHero(i) {
    if (twoPlayer && selectPass === 1) {
      game.hero2Index = i;
      ui.setHero(i);
    } else {
      game.heroIndex = i;
      ui.setHero(i);
    }
    audio.sfx('select');
  }

  // P2 HUD (split screen): mirrors the active mode's essentials
  const mmss = (s) => {
    const v = Math.max(0, s);
    return `${Math.floor(v / 60)}:${String(Math.floor(v % 60)).padStart(2, '0')}`;
  };
  function hud2Update() {
    const P2 = game.players[1];
    const r2 = game.runs[1];
    if (game.mode === 'crates') {
      ui.hud2(t('hud.crates', { n: game.cratesLeft }), mmss(game.timeF / 60), '');
      return;
    }
    if (game.mode === 'survival') {
      ui.hud2(`♥ ${Math.max(0, P2.hp)}/${P2.maxHp}`,
        t('hud.survive', { t: mmss(ARENA.dur - game.timeF / 60) }),
        t('hud.wave', { n: game.wave }));
      return;
    }
    const hearts = '♥'.repeat(Math.max(0, P2.hp))
      + '♡'.repeat(Math.max(0, P2.maxHp - P2.hp));
    ui.hud2(
      t('hud.coins', { n: `${r2.coins} / ${game.course.coinTotal}` }),
      t('hud.time', { t: mmss(game.timeLimit - game.timeF / 60) }),
      `${t('hud.place', { p: game.aiPlace(r2), m: 4 })}  ${hearts}`);
  }
  function dualState() {
    if (!game.runs || game.runs.length < 2) return '';
    const st = (run) => run.out ? t('state.out') : t('state.dry');
    return `${t('p1')} ${st(game.runs[0])} · ${t('p2')} ${st(game.runs[1])}`;
  }

  // (re)build a run for stage levelIndex
  function startLevel(levelIndex) {
    // 2P is gated on a live controller — if the pad vanished, run 1P rather
    // than handing player 1 a dead stick
    if (twoPlayer && Gamepad.padCount() === 0) {
      twoPlayer = false;
      try { localStorage.setItem('pixelbros3d_players', '1'); } catch { /* */ }
      ui.setPlayers(1, canTwo(), Gamepad.padCount());
    }
    if (twoPlayer) Gamepad.setEnabled(true);   // 2P always needs the pads
    assignSlots();
    game.start(levelIndex, { twoPlayer, hero2Index: game.hero2Index });
    survSaved = false;           // fresh survival attempt: arm the best-save
    ui.modeCards(game.mode);     // arena vs crate-cove wording on the cards
    ui.setPlayers(twoPlayer ? 2 : 1, canTwo(), Gamepad.padCount());
    document.body.classList.toggle('split-v', twoPlayer && splitMode === 'v');
    document.body.classList.toggle('split-h', twoPlayer && splitMode === 'h');
    renderer.setSplit(twoPlayer, splitMode);
    renderer.setP2Hero(twoPlayer ? game.selectedHero2() : null);
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
    document.body.classList.remove('split-v', 'split-h');
    renderer.setSplit(false);
    renderer.setP2Hero(null);
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
  // otherwise back to the map — the locked card already said what is owed.
  // A Crate Cove win is simply a cleared frontier stage: walk onward.
  function winDone() {
    if (game.mode === 'crates') { handleDone(); return; }
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

  function handleKeys(padSlots = []) {
    const s = game.state;
    if (Input.pressed('KeyL')) { toggleLang(); ui.renderTexts(); }
    if (Input.pressed('KeyM')) audio.toggleMute();
    if (s === 'title') {
      if (Input.pressed('Enter') || Input.pressed('Space')) toSelect();
      // quick settings without the mouse: 1/2 players, V/H split
      if (Input.pressed('Digit2')) setPlayersMode(2);
      if (Input.pressed('Digit1')) setPlayersMode(1);
      if (Input.pressed('KeyV')) setSplitMode('v');
      if (Input.pressed('KeyH')) setSplitMode('h');
    } else if (s === 'select') {
      // both pads and the keyboard drive the ACTIVE picker; pad edges come
      // straight from the slot layer so P2 can always choose with a pad
      const pNav = padNav(padSlots);
      const dx = pNav.dx
        || (Input.pressed('ArrowRight') || Input.pressed('KeyD') ? 1 : 0)
        - (Input.pressed('ArrowLeft') || Input.pressed('KeyA') ? 1 : 0);
      const dy = pNav.dy
        || (Input.pressed('ArrowDown') || Input.pressed('KeyS') ? 1 : 0)
        - (Input.pressed('ArrowUp') || Input.pressed('KeyW') ? 1 : 0);
      if (dx || dy) movePick(dx, dy);
      if (pNav.confirm || Input.pressed('Enter') || Input.pressed('Space')) {
        if (twoPlayer && selectPass === 0) {
          selectPass = 1;
          if (game.hero2Index === game.heroIndex) {
            game.hero2Index = (game.heroIndex + 1) % HERO_IDS.length;
          }
          ui.setSelectPass(1);
          ui.setHero(game.hero2Index);
          audio.sfx('select');
        } else {
          selectPass = 0;
          ui.setSelectPass(0);
          toMap();
        }
      }
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
      // free modes (arena + crate cove): Space is the ONLY jump (W/↑ drive
      // the free-control rig); racing: Space/W/↑ all hop
      if (game.mode !== 'race') {
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

    // pad edges must land before key routing reads this frame's presses;
    // during a run the pads feed player slots directly, so only MENU codes
    // are injected into Input (pause/restart) — gameplay never double-feeds
    const padSlots = Gamepad.pollSlots();
    // live rebinding: a pad that wakes mid-run joins its player, and one
    // that drops hands that player back to the keyboard (never a dead stick)
    if (game.state === 'play') assignSlots();
    Gamepad.poll(game.state === 'play'
      ? { only: ['Escape', 'KeyQ', 'Enter', 'KeyR', 'KeyM', 'KeyL'] }
      : {});
    handleKeys(padSlots);

    while (acc >= STEP_MS) {
      const playing = game.state === 'play';
      // camera faces +Z, so world +X is screen-LEFT — steering is inverted
      const kb = {
        x: playing ? -Input.axisX() : 0,
        z: playing ? zAxis : 0,
        jump: playing && jumpEdge,
        jumpHeld: playing && (Input.isDown('Space')
          || (game.mode === 'race'
            && (Input.isDown('ArrowUp') || Input.isDown('KeyW')))),
        spin: playing && spinEdge,
      };
      let stepFlags = kb;
      if (game.twoPlayer) {
        stepFlags = [
          slots[0] === 'keys' ? kb : padFlags(padSlots[0], playing),
          slots[1] === 'keys' ? kb : padFlags(padSlots[1], playing),
        ];
      } else if (slots[0] === 'pad') {
        stepFlags = mergeFlags(kb, padFlags(padSlots[0], playing));
      }
      game.step(stepFlags);
      game.mapStep();
      jumpEdge = false;
      spinEdge = false;
      acc -= STEP_MS;
    }

    // menu shows the live hero on the pedestal; select slides it beside
    // the card, map shows the tiny one; victory reuses the same showcase
    // with the hero hoisting the trophy next to the card
    if (game.state === 'title' || game.state === 'select') {
      const pick = (game.state === 'select' && twoPlayer && selectPass === 1)
        ? game.hero2Index : game.heroIndex;
      renderer.setHero('menu:' + HERO_IDS[pick]);
      renderer.setSelectHero(
        game.state === 'select' ? ui.selectHeroPx() : null);
    }
    if (game.state === 'victory') {
      renderer.setHero('menu:' + game.selectedHero());
      renderer.setSelectHero(ui.victoryHeroPx());
    }
    renderer.showTrophy(game.state === 'victory');
    // split-screen styling only while the run world is on screen
    const splitOn = twoPlayer && (game.state === 'play' || game.state === 'pause');
    document.body.classList.toggle('split-v', splitOn && splitMode === 'v');
    document.body.classList.toggle('split-h', splitOn && splitMode === 'h');
    renderer.setSplit(splitOn, splitMode);

    // title row shows pad presence (poll runs in every mode for this).
    // Live, every frame: a second pad registers as soon as it is pressed,
    // so the PLAYERS row enables 2P without a reload.
    if (game.state === 'title') {
      const pads = Gamepad.padCount();
      ui.setPadStatus(pads);
      ui.setPlayers(twoPlayer ? 2 : 1, pads > 0, pads);
    }
    if (game.state === 'play' && game.player) {
      if (game.mode === 'survival') {
        ui.hudSurvive(game.timeF / 60, game.wave, ARENA.dur,
          game.player.hp, game.player.maxHp);
      } else if (game.mode === 'crates') {
        ui.hudCrates(game.timeF / 60, game.cratesLeft);
      } else {
        ui.hud(game.coins, game.course.coinTotal, game.timeF / 60,
          game.runs[0] ? game.aiPlace(game.runs[0]) : 1,
          game.player.hp, game.player.maxHp, game.timeLimit);
      }
      if (twoPlayer && game.players[1]) hud2Update();
    }
    if (game.state === 'clear') {
      ui.show('clear');
      // every race stage now leads onward (Ridge → arena), so the card
      // always offers "next island"
      ui.clearStats(game.clearTime, game.coins, game.course.coinTotal,
        true, game.clearPlace);
      ui.dual('clear', twoPlayer && game.clearPlaces
        ? `${t('p1')} ${game.clearPlaces[0]} · ${t('p2')} ${game.clearPlaces[1]}`
        : '');
    }
    if (game.state === 'dq') ui.show('dq');
    if (game.state === 'lost') {
      ui.show('lost');
      ui.lost(game.clearPlace, LEVELS[game.levelIndex].passPlace);
      ui.dual('lost', twoPlayer && game.clearPlaces
        ? `${t('p1')} ${game.clearPlaces[0]} · ${t('p2')} ${game.clearPlaces[1]}`
        : '');
    }
    if (game.state === 'over' || game.state === 'win') {
      // the arena keeps a best time; the cove only keeps bragging rights
      if (game.mode === 'survival' && !survSaved) {
        survSaved = true; saveSurvBest(game.survTime);
      }
    }
    if (game.state === 'over') {
      ui.show('over');
      ui.overStats(game.survTime, game.mode === 'survival' ? survBest : 0);
      ui.dual('over', twoPlayer ? dualState() : '');
    }
    if (game.state === 'win') {
      ui.show('win');
      if (game.mode === 'crates') ui.winCrates();
      else ui.winStats(survBest, game.allRacesCleared());
      ui.dual('win', twoPlayer ? dualState() : '');
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
  ui.setInputMode(inputMode);
  ui.setPlayers(twoPlayer ? 2 : 1, canTwo(), Gamepad.padCount());
  ui.setSplit(splitMode);
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
