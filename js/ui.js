// UI: crisp DOM panels floating over the 3D scene — the hybrid approach.
// The world behind is live (rotating hero on the pedestal, course beyond);
// text/buttons are real DOM so Arabic shaping, RTL and a11y are free.

import { t, onLangChange } from './i18n.js';
import { HERO_IDS, CHARACTERS } from './hero.js';
import { FIELD_SIZE } from './rivals.js';

const heroColorCss = (id) =>
  '#' + CHARACTERS[id].color.toString(16).padStart(6, '0');

export class UI {
  constructor(root, cb) {
    this.root = root;
    this.cb = cb;
    this.heroIndex = 0;
    this.padOn = null;          // last published gamepad status
    this.twoPlayerUI = false;   // split HUD visibility
    this.root.innerHTML = `
      <div class="screen" id="sc-title">
        <div class="panel center grow">
          <h1 class="logo">SUPER <span>PIXEL</span> BROS <em>3D</em></h1>
          <p class="tagline" data-key="tagline"></p>
          <button class="btn big" id="b-start" data-key="press_enter"></button>
          <p class="keys"><span data-key="controls.move"></span></p>
          <p class="keys dim"><span data-key="controls.actions"></span></p>
          <div class="input-row">
            <span class="input-label" data-key="input.device"></span>
            <div class="seg">
              <button class="btn seg-btn" id="b-in-kb" data-key="input.keyboard"></button>
              <button class="btn seg-btn" id="b-in-pad" data-key="input.controller"></button>
            </div>
            <span class="pad-status">🎮 <span id="pad-status"></span></span>
          </div>
          <div class="input-row">
            <span class="input-label" data-key="opt.players"></span>
            <div class="seg">
              <button class="btn seg-btn" id="b-p1" data-key="opt.one"></button>
              <button class="btn seg-btn" id="b-p2" data-key="opt.two"></button>
            </div>
            <span class="pad-status dim" id="p2-note"></span>
          </div>
          <div class="input-row">
            <span class="input-label" data-key="opt.split"></span>
            <div class="seg">
              <button class="btn seg-btn" id="b-split-v" data-key="opt.splitv"></button>
              <button class="btn seg-btn" id="b-split-h" data-key="opt.splith"></button>
            </div>
          </div>
        </div>
      </div>

      <div class="screen hidden" id="sc-select">
        <div class="select-wrap">
          <div class="pick-half">
            <h2 class="pick-title" id="pick-title" data-key="choose_hero"></h2>
            <div class="hero-grid" id="hero-grid"></div>
            <div class="pick-bar">
              <button class="btn round" id="b-prev">◀</button>
              <button class="btn big accent" id="b-play" data-key="btn.play"></button>
              <button class="btn round" id="b-next">▶</button>
            </div>
            <p class="keys dim" data-key="select_hint"></p>
          </div>
          <div class="stage-half">
            <div id="hero-anchor" class="anchor"></div>
            <div class="hero-info panel">
              <h3 id="hero-name"></h3>
              <p id="hero-blurb" class="blurb"></p>
              <div class="stat"><span data-key="spd"></span><div class="bar"><i id="bar-spd"></i></div></div>
              <div class="stat"><span data-key="jmp"></span><div class="bar"><i id="bar-jmp"></i></div></div>
            </div>
          </div>
        </div>
      </div>

      <div class="hud hidden" id="sc-hud">
        <div class="hud-box" id="hud-coins"></div>
        <div class="hud-box" id="hud-place"></div>
        <div class="hud-box" id="hud-hearts"></div>
        <div class="hud-box" id="hud-time"></div>
        <div class="hud-box" id="hud-wave"></div>
      </div>

      <div class="hud hud2 hidden" id="sc-hud2">
        <div class="hud-box" id="hud2-a"></div>
        <div class="hud-box" id="hud2-time"></div>
        <div class="hud-box" id="hud2-b"></div>
      </div>

      <div class="screen hidden" id="sc-pause">
        <div class="panel card">
          <h2 data-key="paused"></h2>
          <div class="col">
            <button class="btn" id="b-resume" data-key="pause.resume"></button>
            <button class="btn" id="b-retry" data-key="pause.retry"></button>
            <button class="btn ghost" id="b-title" data-key="pause.quit"></button>
          </div>
          <p class="keys dim" data-key="pause_hint"></p>
        </div>
      </div>

      <div class="screen hidden" id="sc-clear">
        <div class="panel card">
          <div class="trophy" id="clear-trophy">🏆</div>
          <h2 data-key="clear.title"></h2>
          <p class="trophy-sub" data-key="clear.trophy"></p>
          <p class="result" id="clear-time"></p>
          <p class="result" id="clear-coins"></p>
          <p class="result" id="clear-place"></p>
          <p class="result" id="clear-dual"></p>
          <button class="btn big accent" id="b-done" data-key="clear.hint"></button>
        </div>
      </div>

      <div class="screen hidden" id="sc-dq">
        <div class="panel card dq">
          <div class="dq-mark">⏱</div>
          <h2 data-key="dq.title"></h2>
          <p class="blurb" data-key="dq.sub"></p>
          <div class="col">
            <button class="btn big accent" id="b-dq-retry" data-key="dq.retry"></button>
            <button class="btn ghost" id="b-dq-title" data-key="pause.quit"></button>
          </div>
          <p class="keys dim" data-key="dq.hint"></p>
        </div>
      </div>

      <div class="screen hidden" id="sc-lost">
        <div class="panel card dq">
          <div class="dq-mark">💔</div>
          <h2 data-key="lost.title"></h2>
          <p class="result" id="lost-place"></p>
          <p class="blurb" id="lost-rule"></p>
          <p class="result" id="lost-dual"></p>
          <div class="col">
            <button class="btn big accent" id="b-lost-retry" data-key="lost.retry"></button>
            <button class="btn ghost" id="b-lost-title" data-key="pause.quit"></button>
          </div>
          <p class="keys dim" data-key="lost.hint"></p>
        </div>
      </div>

      <div class="screen hidden" id="sc-over">
        <div class="panel card dq">
          <div class="dq-mark">🌊</div>
          <h2 data-key="over.title"></h2>
          <p class="blurb" data-key="over.sub"></p>
          <p class="result" id="over-time"></p>
          <p class="result" id="over-best"></p>
          <p class="result" id="over-dual"></p>
          <div class="col">
            <button class="btn big accent" id="b-over-retry" data-key="over.retry"></button>
            <button class="btn ghost" id="b-over-title" data-key="pause.quit"></button>
          </div>
          <p class="keys dim" data-key="over.hint"></p>
        </div>
      </div>

      <div class="screen hidden" id="sc-win">
        <div class="panel card">
          <div class="trophy gold">🥇</div>
          <h2 data-key="win.title"></h2>
          <p class="trophy-sub" data-key="win.sub"></p>
          <p class="result" id="win-best"></p>
          <p class="result" id="win-dual"></p>
          <p class="blurb" id="win-locked" data-key="win.locked"></p>
          <button class="btn big accent" id="b-win-title" data-key="win.hint_map"></button>
        </div>
      </div>

      <div class="screen hidden" id="sc-map">
        <div class="topbar"><h2 data-key="map.title"></h2></div>
        <div class="map-panel panel">
          <h3 id="map-stage"></h3>
          <p id="map-state" class="blurb"></p>
          <div class="map-btns">
            <button class="btn round" id="b-map-prev">◀</button>
            <button class="btn big accent" id="b-map-play" data-key="btn.play"></button>
            <button class="btn round" id="b-map-next">▶</button>
          </div>
          <p class="keys dim" data-key="map.hint"></p>
        </div>
      </div>

      <div class="screen hidden" id="sc-victory">
        <div class="select-wrap">
          <div class="pick-half victory-half">
            <div class="panel card grow">
              <div class="trophy gold">🏆</div>
              <h2 data-key="victory.title"></h2>
              <p class="trophy-sub" data-key="victory.sub"></p>
              <button class="btn big accent" id="b-victory" data-key="victory.hint"></button>
            </div>
          </div>
          <div class="stage-half">
            <div id="victory-anchor" class="anchor"></div>
          </div>
        </div>
      </div>

      <div class="rotate hidden" id="rotate" data-key="rotate"></div>
    `;
    this.bind('b-start', () => this.cb.onStart());
    this.bind('b-in-kb', () => this.cb.onInputDevice('keyboard'));
    this.bind('b-in-pad', () => this.cb.onInputDevice('controller'));
    this.bind('b-p1', () => this.cb.onPlayers(1));
    this.bind('b-p2', () => this.cb.onPlayers(2));
    this.bind('b-split-v', () => this.cb.onSplit('v'));
    this.bind('b-split-h', () => this.cb.onSplit('h'));
    this.bind('b-prev', () => this.cb.onMove(-1));
    this.bind('b-next', () => this.cb.onMove(1));
    this.bind('b-play', () => this.cb.onPlay());
    this.bind('b-resume', () => this.cb.onResume());
    this.bind('b-retry', () => this.cb.onRetry());
    this.bind('b-title', () => this.cb.onTitle());
    this.bind('b-done', () => this.cb.onDone());
    this.bind('b-dq-retry', () => this.cb.onRetry());
    this.bind('b-dq-title', () => this.cb.onTitle());
    this.bind('b-lost-retry', () => this.cb.onRetry());
    this.bind('b-lost-title', () => this.cb.onTitle());
    this.bind('b-over-retry', () => this.cb.onRetry());
    this.bind('b-over-title', () => this.cb.onTitle());
    this.bind('b-win-title', () => this.cb.onWinDone());
    this.bind('b-victory', () => this.cb.onTitle());
    this.bind('b-map-prev', () => this.cb.onMapMove(-1));
    this.bind('b-map-next', () => this.cb.onMapMove(1));
    this.bind('b-map-play', () => this.cb.onMapPlay());
    // select grid: one mini card per hero; click = pick (ENTER still = go)
    const grid = this.root.querySelector('#hero-grid');
    grid.innerHTML = HERO_IDS.map((id, i) => `
      <button class="hcard" data-i="${i}" style="--c:${heroColorCss(id)}">
        <span class="hdot"></span><span class="hname"></span>
      </button>`).join('');
    grid.addEventListener('click', (e) => {
      const c = e.target.closest('.hcard');
      if (c) this.cb.onPick(+c.dataset.i);
    });
    onLangChange(() => this.renderTexts());
    this.renderTexts();
  }

  bind(id, fn) {
    const el = this.root.querySelector('#' + id);
    el.addEventListener('click', (e) => { e.currentTarget.blur(); fn(); });
  }

  renderTexts() {
    this.root.querySelectorAll('[data-key]').forEach((el) => {
      el.textContent = t(el.dataset.key);
    });
    // grid card names live in JS (one per hero, i18n-driven)
    this.root.querySelectorAll('#hero-grid .hcard').forEach((el) => {
      el.querySelector('.hname').textContent =
        t(`hero.${HERO_IDS[+el.dataset.i]}.name`);
    });
    this.padOn = null;   // force the pad-status line to re-translate
    this.setHero(this.heroIndex);
  }

  // INPUT DEVICE segment on the title screen: who drives — keyboard or pad
  setInputMode(mode) {
    this.root.querySelector('#b-in-kb').classList.toggle('on',
      mode === 'keyboard');
    this.root.querySelector('#b-in-pad').classList.toggle('on',
      mode === 'controller');
  }

  // gamepad presence for the title row; accepts a COUNT (live) or a bool.
  // Text only re-renders on change — the title polls this every frame so a
  // pad that registers late (browsers expose pads after their first press)
  // flips the PLAYERS row from disabled to available immediately.
  setPadStatus(count) {
    const n = typeof count === 'number' ? count : (count ? 1 : 0);
    if (n === this.padOn) return;
    this.padOn = n;
    this.root.querySelector('#pad-status').textContent =
      n > 0 ? t('input.padCount', { n }) : t('input.padNo');
  }

  // pause-menu highlight: ↑↓/stick cycles Resume/Restart/Title, ✕ picks
  setPauseFocus(i) {
    ['b-resume', 'b-retry', 'b-title'].forEach((id, n) => {
      this.root.querySelector('#' + id).classList.toggle('focus', n === i);
    });
  }

  show(name) {
    const map = {
      title: ['sc-title'], select: ['sc-select'], play: ['sc-hud'],
      pause: ['sc-hud', 'sc-pause'], clear: ['sc-clear'], dq: ['sc-dq'],
      lost: ['sc-lost'], map: ['sc-map'], victory: ['sc-victory'],
      over: ['sc-over'], win: ['sc-win'],
    };
    const ids = new Set(map[name] || []);
    if (ids.has('sc-hud') && this.twoPlayerUI) ids.add('sc-hud2');
    for (const id of ['sc-title', 'sc-select', 'sc-hud', 'sc-hud2', 'sc-pause',
      'sc-clear', 'sc-dq', 'sc-lost', 'sc-map', 'sc-victory', 'sc-over',
      'sc-win']) {
      this.root.querySelector('#' + id).classList.toggle('hidden', !ids.has(id));
    }
  }

  // PLAYERS row: 1P / 2P. 2P is only offered when a controller is present
  // (browser keyboards cannot be told apart, so 2P always needs a pad).
  // `pads` is the LIVE count: the note tells the player how the run will be
  // split (two pads, or pad + keyboard) before they commit.
  setPlayers(n, canTwo, pads = 0) {
    const sig = `${n}|${canTwo}|${pads}`;
    if (sig === this.playerSig) return;
    this.playerSig = sig;
    this.twoPlayerUI = n === 2 && canTwo;
    const one = this.root.querySelector('#b-p1');
    const two = this.root.querySelector('#b-p2');
    one.classList.toggle('on', n !== 2 || !canTwo);
    two.classList.toggle('on', this.twoPlayerUI);
    two.disabled = !canTwo;
    this.root.querySelector('#p2-note').textContent =
      n === 2
        ? (!canTwo ? t('opt.p2need')
          : pads >= 2 ? t('opt.pads2') : t('opt.pads1'))
        : (canTwo ? '' : t('opt.p2need'));
  }

  setSplit(mode) {
    this.root.querySelector('#b-split-v').classList.toggle('on', mode !== 'h');
    this.root.querySelector('#b-split-h').classList.toggle('on', mode === 'h');
  }

  // live column count of the hero grid (responsive auto-fill): used by the
  // up/down arrows so a row step is always exactly one row, whatever the
  // viewport width does to the layout
  gridColumns() {
    const el = this.root.querySelector('#hero-grid');
    if (!el) return 4;
    const cols = getComputedStyle(el).gridTemplateColumns;
    const n = cols ? cols.split(' ').filter(Boolean).length : 0;
    return n > 0 ? n : 4;
  }

  // select screen: pass 0 = P1 picks, pass 1 = P2 picks
  setSelectPass(pass) {
    const el = this.root.querySelector('#pick-title');
    const key = pass === 1 ? 'pick2' : 'choose_hero';
    el.dataset.key = key;
    el.textContent = t(key);
  }

  // P2 HUD (split screen): the mode essentials in three compact boxes
  hud2(a, time, b) {
    const r = this.root.querySelector('#sc-hud2');
    r.querySelector('#hud2-a').textContent = a || '';
    r.querySelector('#hud2-time').textContent = time || '';
    r.querySelector('#hud2-b').textContent = b || '';
  }

  // dual result line on a terminal card ('clear' | 'lost' | 'over' | 'win')
  dual(which, text) {
    const el = this.root.querySelector('#' + which + '-dual');
    if (el) el.textContent = text || '';
  }

  // showcase anchor: the exact center of the stage half (screen center
  // vertically, that half's center horizontally). The renderer parks the
  // rotating hero's body center on it; the live DOM rect means RTL mirroring
  // comes for free (the halves swap with <html dir>). Used by the select
  // screen and the victory card — scope to the screen so the hidden twin
  // can never answer with a zero rect.
  _anchorCenter(screenSel) {
    const a = this.root.querySelector(screenSel + ' .anchor').getBoundingClientRect();
    const s = this.root.querySelector(screenSel + ' .stage-half').getBoundingClientRect();
    return {
      px: a.left + a.width / 2,
      py: a.top + a.height / 2,
      room: s.width * 0.85,
    };
  }

  selectHeroPx() { return this._anchorCenter('#sc-select'); }

  victoryHeroPx() { return this._anchorCenter('#sc-victory'); }

  setHero(index) {
    this.heroIndex = index;
    const id = HERO_IDS[index];
    // grid: glow the chosen card, keep it in view on small screens
    this.root.querySelectorAll('#hero-grid .hcard').forEach((el) => {
      const on = +el.dataset.i === index;
      el.classList.toggle('sel', on);
      if (on) el.scrollIntoView({ block: 'nearest' });
    });
    const name = this.root.querySelector('#hero-name');
    name.textContent = t(`hero.${id}.name`);
    name.style.color = heroColorCss(id);
    this.root.querySelector('#hero-blurb').textContent = t(`hero.${id}.blurb`);
    const d = CHARACTERS[id];
    // bars compare within the CURRENT roster envelope (speed 7.1–7.45,
    // jump 9.4–12.0) — the old 8.4/12.6 divisors flattened everyone into
    // a bar, which sells the 5% speed law short
    this.root.querySelector('#bar-spd').style.width =
      Math.round(((d.speed - 6.8) / 0.9) * 100) + '%';
    this.root.querySelector('#bar-jmp').style.width =
      Math.round(((d.jump - 9.0) / 3.2) * 100) + '%';
  }

  hud(coins, coinTotal, timeSec, place, hp = 1, maxHp = 1, limit = 0) {
    this.root.querySelector('#hud-wave').style.visibility = 'hidden';
    this.root.querySelector('#hud-coins').style.visibility = 'visible';
    this.root.querySelector('#hud-place').style.visibility = 'visible';
    this.root.querySelector('#hud-coins').textContent =
      t('hud.coins', { n: coins + ' / ' + coinTotal });
    const timeEl = this.root.querySelector('#hud-time');
    // countdown to the disqualification clock (elapsed if no limit set)
    timeEl.textContent = t('hud.time',
      { t: fmtTime(limit > 0 ? Math.max(0, limit - timeSec) : timeSec) });
    if (limit > 0) {
      const rem = limit - timeSec;
      timeEl.classList.toggle('warn', rem <= limit * 0.25 && rem > limit * 0.1);
      timeEl.classList.toggle('crit', rem <= limit * 0.1);
    }
    this.root.querySelector('#hud-place').textContent =
      t('hud.place', { p: place, m: FIELD_SIZE });
    // hearts: filled/empty pips; hidden entirely for 1-heart heroes so a
    // Bolt run isn't spammed with a lone heart
    const hearts = this.root.querySelector('#hud-hearts');
    if (maxHp > 1) {
      hearts.textContent = '♥'.repeat(hp) + '♡'.repeat(Math.max(0, maxHp - hp));
      hearts.style.visibility = 'visible';
    } else hearts.style.visibility = 'hidden';
  }

  // survival HUD: coins/place retire, the wave counter, a count-DOWN to
  // the Last-Standing buzzer and the arena heart pool take over
  hudSurvive(timeSec, wave, dur, hp = 1, maxHp = 1) {
    const r = this.root;
    r.querySelector('#hud-coins').style.visibility = 'hidden';
    r.querySelector('#hud-place').style.visibility = 'hidden';
    const hearts = r.querySelector('#hud-hearts');
    hearts.style.visibility = 'visible';
    hearts.textContent = '♥'.repeat(Math.max(0, hp))
      + '♡'.repeat(Math.max(0, maxHp - hp));
    const timeEl = r.querySelector('#hud-time');
    const rem = dur - timeSec;
    timeEl.textContent = t('hud.survive', { t: fmtTime(Math.max(0, rem)) });
    timeEl.classList.toggle('warn', rem <= 20 && rem > 10);
    timeEl.classList.toggle('crit', rem <= 10);
    const w = r.querySelector('#hud-wave');
    w.style.visibility = 'visible';
    w.textContent = t('hud.wave', { n: wave });
  }

  overStats(timeSec, bestSec) {
    const r = this.root;
    r.querySelector('#over-time').textContent =
      t('over.time', { t: fmtTime(timeSec) });
    r.querySelector('#over-best').textContent =
      bestSec > 0 ? t('over.best', { t: fmtTime(bestSec) }) : '';
  }

  // Crate Cove HUD: elapsed time + decks left where the wave counter lives;
  // hearts play no part here — only the sea judges, and there is no buzzer
  hudCrates(timeSec, cratesLeft) {
    const r = this.root;
    r.querySelector('#hud-coins').style.visibility = 'hidden';
    r.querySelector('#hud-place').style.visibility = 'hidden';
    r.querySelector('#hud-hearts').style.visibility = 'hidden';
    const timeEl = r.querySelector('#hud-time');
    timeEl.textContent = t('hud.time', { t: fmtTime(timeSec) });
    timeEl.classList.remove('warn', 'crit');
    const w = r.querySelector('#hud-wave');
    w.style.visibility = 'visible';
    w.textContent = t('hud.crates', { n: cratesLeft });
  }

  // Crate Cove win card: no best-time row, no locked trophy line — the
  // button simply walks onward to the arena island
  winCrates() {
    const r = this.root;
    r.querySelector('#win-best').textContent = '';
    r.querySelector('#win-locked').style.display = 'none';
    const b = r.querySelector('#b-win-title');
    b.dataset.key = 'clear.hint_next';
    b.textContent = t('clear.hint_next');
  }

  // Arena vs Crate Cove share the over/win cards — swap the flavour line
  // (data-key included, so language toggles keep the right wording)
  modeCards(mode) {
    const set = (sel, key) => {
      const el = this.root.querySelector(sel);
      if (!el) return;
      el.dataset.key = key;
      el.textContent = t(key);
    };
    const crates = mode === 'crates';
    set('#sc-over .blurb', crates ? 'over.sub.crates' : 'over.sub');
    set('#sc-win .trophy-sub', crates ? 'win.sub.crates' : 'win.sub');
  }

  // win card: the trophy gleams only once the race ladder is done — until
  // then a locked line says what is still owed, and the button walks back
  winStats(bestSec, allClear) {
    this.root.querySelector('#win-best').textContent =
      t('over.newbest') + '  ' + t('over.best', { t: fmtTime(bestSec) });
    this.root.querySelector('#win-locked').style.display =
      allClear ? 'none' : '';
    const b = this.root.querySelector('#b-win-title');
    b.dataset.key = allClear ? 'win.hint_trophy' : 'win.hint_map';
    b.textContent = t(b.dataset.key);
  }

  clearStats(timeSec, coins, coinTotal, hasNext, place) {
    this.root.querySelector('#clear-time').textContent =
      t('clear.time', { t: fmtTime(timeSec) });
    this.root.querySelector('#clear-coins').textContent =
      t('clear.coins', { n: coins, m: coinTotal });
    this.root.querySelector('#clear-place').textContent =
      t('clear.place', { p: place, m: FIELD_SIZE });
    // beat the whole rival field → the trophy gleams gold
    this.root.querySelector('#clear-trophy').classList.toggle('gold',
      place === 1);
    // frontier stage continues to the map; the last one ends the game
    const b = this.root.querySelector('#b-done');
    b.dataset.key = hasNext ? 'clear.hint_next' : 'clear.hint';
    b.textContent = t(b.dataset.key);
  }

  // placement gate failure: which place, and which rule it broke
  lost(place, passPlace) {
    this.root.querySelector('#lost-place').textContent =
      t('clear.place', { p: place, m: FIELD_SIZE });
    this.root.querySelector('#lost-rule').textContent =
      t(passPlace <= 1 ? 'lost.rule_win' : 'lost.rule_top3');
  }

  setMap(num, name, cleared, opts = {}) {
    this.root.querySelector('#map-stage').textContent =
      opts.arena ? t('level.arena') : t('map.stage', { n: num, name });
    this.root.querySelector('#map-state').textContent =
      opts.arena
        ? (opts.best > 0 ? t('over.best', { t: fmtTime(opts.best) })
          : t('map.arena'))
        : (cleared ? t('map.cleared') : t('map.frontier'));
    // free-control explainer instead of the race hint while on the arena
    const b = this.root.querySelector('#sc-map .keys');
    b.dataset.key = opts.arena ? 'map.arenaHint' : 'map.hint';
    b.textContent = t(b.dataset.key);
  }
}

export function fmtTime(sec) {
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
  const cs = Math.floor((sec * 100) % 100);
  return `${m}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}
