// Fully synthesized audio (Web Audio API): retro SFX + looping chiptune
// music — same zero-asset promise as the 2D game. One original melody per
// stage; the map/title uses the stage-1 theme. Music ducks while paused.
// unlock() must run from a user gesture (browser autoplay policy).

const LS_KEY = 'pixelbros3d_mute';
const hasLS = typeof localStorage !== 'undefined';

const NOTE = {};
(() => {
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  for (let o = 0; o < 8; o++)
    names.forEach((n, i) => {
      NOTE[n + o] = 440 * Math.pow(2, (o * 12 + i - 57) / 12);
    });
})();

// [note, beats] — null = rest. Original melodies.
const THEMES = [
  { // 0 - Sunny Shore: bouncy major, waves-and-palms energy
    tempo: 2.5,
    mel: [['E5',1],['G5',1],['A5',1],['G5',1],['E5',1],['C5',2],[null,1],
          ['D5',1],['E5',1],['G5',2],['E5',1],[null,1],
          ['C5',1],['D5',1],['E5',1],['A4',2],[null,1],
          ['G4',1],['B4',1],['C5',2],[null,2]],
    bass: ['C2','G2'],
  },
  { // 1 - Sunset Ridge: warm, a little wistful (mixolydian)
    tempo: 2.15,
    mel: [['A4',1],['B4',1],['D5',2],['C5',1],['B4',1],['A4',2],[null,1],
          ['D5',1],['E5',1],['F5',2],['E5',1],['D5',1],['B4',2],
          ['A4',1],['D5',1],['C5',2],['A4',1],[null,1],
          ['G4',1],['A4',1],['B4',2],[null,2]],
    bass: ['A2','E2'],
  },
  { // 2 - Crate Cove: a jaunty sea-shanty lilt, deck-to-deck energy
    tempo: 2.35,
    mel: [['D5',1],['F#5',1],['A5',2],['F#5',1],['E5',1],['D5',2],[null,1],
          ['B4',1],['D5',1],['E5',2],['F#5',1],['E5',1],['D5',2],
          ['A4',1],['B4',1],['D5',2],['E5',1],[null,1],
          ['F#5',1],['E5',1],['D5',2],[null,2]],
    bass: ['D2','A2'],
  },
  { // 3 - Bumper Arena: driving, tense, fast — a fight in a phone box
    tempo: 3.1,
    mel: [['A4',1],['C5',1],['E5',1],['C5',1],['A4',2],[null,1],
          ['G4',1],['B4',1],['D5',1],['B4',1],['G4',2],
          ['E5',1],['D5',1],['C5',1],['B4',1],['A4',2],[null,1],
          ['C5',1],['B4',1],['A4',2],[null,2]],
    bass: ['A1','E2'],
  },
];

class AudioEngine {
  constructor() {
    this.ctx = null;
    this.muted = hasLS && localStorage.getItem(LS_KEY) === '1';
    this.themeIdx = 0;
    this.music = true;   // loop on/off (on during play/map, off never — just ducked)
  }

  unlock() {
    if (!this.ctx) {
      const AC = typeof window !== 'undefined'
        && (window.AudioContext || window.webkitAudioContext);
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.5;
      this.master.connect(this.ctx.destination);
      this.musicBus = this.ctx.createGain();
      this.musicBus.gain.value = 1;
      this.musicBus.connect(this.master);
      this.nextTime = this.ctx.currentTime + 0.1;
      this.noteIdx = 0;
      this.beatCount = 0;
      setInterval(() => this._tick(), 30);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  setMuted(m) {
    this.muted = m;
    if (hasLS) localStorage.setItem(LS_KEY, m ? '1' : '0');
    if (this.master) this.master.gain.value = m ? 0 : 0.5;
  }
  toggleMute() { this.setMuted(!this.muted); return this.muted; }

  duck(on) {
    if (this.musicBus) this.musicBus.gain.value = on ? 0.25 : 1;
  }

  setTheme(idx) {
    if (idx === this.themeIdx) return;
    this.themeIdx = idx;
    this.noteIdx = 0;
    this.beatCount = 0;
    if (this.ctx) this.nextTime = this.ctx.currentTime + 0.08;
  }

  _tick() {
    if (!this.ctx || this.muted) return;
    const theme = THEMES[this.themeIdx % THEMES.length];
    const beat = 1 / theme.tempo;
    while (this.nextTime < this.ctx.currentTime + 0.18) {
      const step = theme.mel[this.noteIdx % theme.mel.length];
      if (step[0]) {
        this._tone(step[0], this.nextTime, step[1] * beat * 0.92,
          'square', 0.085);
      }
      if (this.beatCount % 2 === 0) {
        const b = theme.bass[(this.beatCount / 2) % theme.bass.length];
        this._tone(b, this.nextTime, beat * 1.6, 'triangle', 0.13);
      }
      this.nextTime += step[1] * beat;
      this.noteIdx++;
      this.beatCount++;
    }
  }

  _tone(name, when, dur, wave, vol) {
    const f = NOTE[name];
    if (!f) return;
    const t = Math.max(when, this.ctx.currentTime);
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = wave;
    o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.musicBus);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  _seq(notes, gap, wave, vol) {
    if (!this.ctx) return;
    let t = this.ctx.currentTime + 0.001;
    for (const n of notes) {
      this._tone(n, t, gap * 1.4, wave, vol);
      t += gap;
    }
  }

  _slide(f0, f1, dur, wave, vol) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = wave;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  _noise(dur, vol) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const len = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const g = this.ctx.createGain();
    g.gain.value = vol;
    src.connect(g).connect(this.master);
    src.start(t);
  }

  sfx(name) {
    if (!this.ctx) return;
    switch (name) {
      case 'jump':    this._slide(300, 660, 0.16, 'square', 0.09); break;
      case 'land':    this._noise(0.07, 0.10); this._slide(150, 70, 0.1, 'sine', 0.12); break;
      case 'spin':    this._slide(500, 1400, 0.18, 'sawtooth', 0.05); break;
      case 'coin':    this._seq(['E5', 'B5'], 0.07, 'square', 0.09); break;
      case 'checkpoint': this._seq(['C5', 'E5', 'G5'], 0.08, 'square', 0.09); break;
      case 'hit':     this._noise(0.1, 0.16); this._slide(220, 70, 0.18, 'square', 0.11); break;
      case 'die':     this._seq(['B4','F4','D4','G3','C3'], 0.13, 'square', 0.1); break;
      case 'bounce':  this._slide(240, 900, 0.2, 'square', 0.1); break;
      case 'boost':   this._seq(['E5','A5','E6'], 0.06, 'square', 0.09); break;
      case 'jinx':    this._slide(420, 90, 0.35, 'triangle', 0.11); break;
      case 'fall':    this._slide(500, 90, 0.5, 'square', 0.09); break;
      case 'clear':   this._seq(['C5','E5','G5','C6','G5','C6'], 0.12, 'square', 0.1); break;
      case 'tick':    this._tone('A5', this.ctx.currentTime, 0.05, 'square', 0.09); break;
      case 'gameover':this._seq(['A4','F4','D4','A3'], 0.22, 'triangle', 0.12); break;
      case 'trophy':  this._seq(['C5','E5','G5','C6','E6','G6','C6','E6','G6'], 0.11, 'square', 0.1); break;
      case 'select':  this._seq(['E5'], 0.07, 'square', 0.08); break;
      case 'confirm': this._seq(['C5', 'G5'], 0.08, 'square', 0.09); break;
      case 'wave':    this._seq(['D5', 'A5', 'D6'], 0.09, 'square', 0.11); break;
    }
  }
}

const audio = new AudioEngine();
export default audio;
