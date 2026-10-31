import { clamp } from './utils.js';

/**
 * Fully procedural audio: no external assets, every sound is synthesised.
 */
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.enabled = true;
    this.started = false;
    this.volume = 0.7;
    this._ambient = null;
  }

  init() {
    if (this.ctx) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) { this.enabled = false; return; }
    this.ctx = new Ctx();
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.knee.value = 18;
    comp.ratio.value = 8;
    comp.attack.value = 0.002;
    comp.release.value = 0.18;
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(comp);
    comp.connect(this.ctx.destination);

    const len = this.ctx.sampleRate * 2;
    this.noiseBuffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

    this._buildAmbient();
    this.started = true;
  }

  resume() {
    if (!this.ctx) this.init();
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  setEnabled(on) {
    this.enabled = on;
    if (this.master) this.master.gain.setTargetAtTime(on ? this.volume : 0, this.ctx.currentTime, 0.05);
  }

  _buildAmbient() {
    if (!this.ctx) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 380;
    const gain = this.ctx.createGain();
    gain.gain.value = 0.028;
    const lfo = this.ctx.createOscillator();
    const lfoGain = this.ctx.createGain();
    lfo.frequency.value = 0.09;
    lfoGain.gain.value = 0.012;
    lfo.connect(lfoGain); lfoGain.connect(gain.gain);
    src.connect(filter); filter.connect(gain); gain.connect(this.master);
    src.start(); lfo.start();
    this._ambient = { src, gain };

    // distant surf
    const surf = this.ctx.createBufferSource();
    surf.buffer = this.noiseBuffer;
    surf.loop = true;
    const sf = this.ctx.createBiquadFilter();
    sf.type = 'lowpass'; sf.frequency.value = 900;
    const sg = this.ctx.createGain(); sg.gain.value = 0.018;
    const sl = this.ctx.createOscillator(); const slg = this.ctx.createGain();
    sl.frequency.value = 0.16; slg.gain.value = 0.013;
    sl.connect(slg); slg.connect(sg.gain);
    surf.connect(sf); sf.connect(sg); sg.connect(this.master);
    surf.start(); sl.start();
    this._surf = { surf, sg };
  }

  _noise(duration, { type = 'bandpass', freq = 1200, q = 0.8, gain = 0.5, decay = 0.12, when = 0 } = {}) {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime + when;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration + decay);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t);
    src.stop(t + duration + decay + 0.02);
  }

  _tone(freq, duration, { type = 'sine', gain = 0.12, when = 0, slideTo = null, attack = 0.004 } = {}) {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime + when;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + duration);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + duration + 0.02);
  }

  shot(kind = 'rifle') {
    if (!this.ctx) return;
    if (kind === 'smg') {
      this._noise(0.09, { freq: 2100, q: 1.2, gain: 0.34, decay: 0.09 });
      this._tone(150, 0.1, { type: 'square', gain: 0.07, slideTo: 55 });
    } else {
      this._noise(0.13, { freq: 1500, q: 0.9, gain: 0.48, decay: 0.16 });
      this._noise(0.05, { freq: 380, q: 0.6, gain: 0.3, decay: 0.1 });
      this._tone(94, 0.18, { type: 'sawtooth', gain: 0.14, slideTo: 38 });
    }
    this._tone(3100, 0.03, { type: 'square', gain: 0.015 });
  }

  enemyShot(distance = 20) {
    if (!this.ctx) return;
    const att = clamp(1 - distance / 90, 0.08, 1);
    this._noise(0.09, { freq: 1100, q: 0.7, gain: 0.16 * att, decay: 0.12 });
    this._tone(80, 0.14, { type: 'sine', gain: 0.06 * att, slideTo: 40 });
  }

  hitmarker(head = false) {
    this._tone(head ? 1450 : 950, 0.055, { type: 'square', gain: head ? 0.055 : 0.035, slideTo: head ? 1150 : 800 });
  }

  reload() {
    this._noise(0.035, { freq: 2600, q: 3, gain: 0.09, decay: 0.02 });
    this._tone(420, 0.04, { type: 'square', gain: 0.025, when: 0.18 });
    this._noise(0.04, { freq: 1800, q: 2, gain: 0.08, decay: 0.03, when: 0.22 });
    this._tone(280, 0.05, { type: 'square', gain: 0.03, when: 0.55 });
  }

  equip() {
    this._noise(0.05, { freq: 1700, q: 2, gain: 0.07, decay: 0.03 });
    this._tone(360, 0.05, { type: 'square', gain: 0.02, when: 0.04 });
  }

  step(running = false) {
    const f = running ? 260 : 190;
    this._noise(0.05, { freq: f, q: 1.4, gain: running ? 0.05 : 0.03, decay: 0.05 });
  }

  jump() { this._noise(0.07, { freq: 500, q: 1, gain: 0.03, decay: 0.04 }); }
  land() { this._noise(0.12, { freq: 180, q: 0.8, gain: 0.08, decay: 0.1 }); }

  hurt() {
    this._tone(120, 0.2, { type: 'sine', gain: 0.16, slideTo: 55 });
    this._noise(0.14, { freq: 500, q: 0.8, gain: 0.12, decay: 0.1 });
  }

  kill() {
    this._tone(880, 0.09, { type: 'square', gain: 0.05 });
    this._tone(1320, 0.14, { type: 'square', gain: 0.04, when: 0.07 });
  }

  pickup() {
    this._tone(660, 0.06, { type: 'sine', gain: 0.05 });
    this._tone(990, 0.1, { type: 'sine', gain: 0.04, when: 0.06 });
  }

  zone() {
    this._tone(220, 0.5, { type: 'sine', gain: 0.06, slideTo: 180 });
    this._tone(330, 0.5, { type: 'sine', gain: 0.035, slideTo: 270, when: 0.5 });
  }

  victory() {
    [523, 659, 784, 1046].forEach((f, i) => this._tone(f, 0.5, { type: 'triangle', gain: 0.08, when: i * 0.13 }));
  }

  defeat() {
    [392, 330, 262, 196].forEach((f, i) => this._tone(f, 0.55, { type: 'triangle', gain: 0.07, when: i * 0.15 }));
  }

  ui() { this._tone(760, 0.035, { type: 'square', gain: 0.02 }); }

  stopAmbient() {
    if (!this.ctx) return;
    if (this._ambient) { try { this._ambient.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.2); } catch {} }
  }
}
