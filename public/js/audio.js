// Efeitos sonoros sintetizados com WebAudio (nenhum arquivo de áudio necessário).

const SHOT = {
  pistol:  { dur: 0.12, freq: 1800, q: 0.8, gain: 0.5, thump: 140 },
  smg:     { dur: 0.08, freq: 2400, q: 0.9, gain: 0.38, thump: 170 },
  shotgun: { dur: 0.32, freq: 900,  q: 0.6, gain: 0.75, thump: 80 },
  rifle:   { dur: 0.14, freq: 1400, q: 0.8, gain: 0.5, thump: 110 },
  sniper:  { dur: 0.55, freq: 1100, q: 0.5, gain: 0.85, thump: 60 },
};

export class Sfx {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.listener = { x: 0, y: 0 };
    this.planeOsc = null;
  }

  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.55;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate * 1.5;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  setEnabled(on) {
    this.enabled = on;
    if (this.master) this.master.gain.value = on ? 0.55 : 0;
  }

  // volume e pan conforme a distância até quem ouve
  spatial(x, y, range = 60) {
    if (x === undefined) return { vol: 1, pan: 0 };
    const dx = x - this.listener.x, dy = y - this.listener.y;
    const d = Math.hypot(dx, dy);
    if (d > range) return null;
    return { vol: Math.max(0, 1 - d / range) ** 1.5, pan: Math.max(-1, Math.min(1, dx / 25)) };
  }

  out(vol, pan) {
    const g = this.ctx.createGain();
    g.gain.value = vol;
    if (this.ctx.createStereoPanner) {
      const p = this.ctx.createStereoPanner();
      p.pan.value = pan;
      g.connect(p); p.connect(this.master);
    } else g.connect(this.master);
    return g;
  }

  noiseBurst(dest, { dur, freq, q = 1, type = 'bandpass', gain = 1, attack = 0.002, slide }) {
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = this.ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    if (slide) f.frequency.exponentialRampToValueAtTime(slide, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(dest);
    src.start(t, Math.random() * 0.5, dur + 0.05);
  }

  tone(dest, { freq, to, dur, type = 'sine', gain = 0.3, delay = 0 }) {
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest);
    o.start(t); o.stop(t + dur + 0.05);
  }

  ready() { return this.ctx && this.enabled; }

  shot(w, x, y) {
    if (!this.ready()) return;
    const s = this.spatial(x, y, w === 'sniper' ? 120 : 70);
    if (!s) return;
    const p = SHOT[w] || SHOT.pistol;
    const dest = this.out(s.vol, s.pan);
    this.noiseBurst(dest, { dur: p.dur, freq: p.freq, q: p.q, gain: p.gain, slide: p.freq * 0.3 });
    this.tone(dest, { freq: p.thump, to: 40, dur: p.dur * 1.2, type: 'triangle', gain: p.gain * 0.7 });
  }

  punch(x, y) {
    if (!this.ready()) return;
    const s = this.spatial(x, y, 30); if (!s) return;
    this.noiseBurst(this.out(s.vol, s.pan), { dur: 0.12, freq: 600, q: 0.7, gain: 0.35, slide: 200 });
  }

  impact(x, y) {
    if (!this.ready()) return;
    const s = this.spatial(x, y, 30); if (!s) return;
    this.noiseBurst(this.out(s.vol * 0.5, s.pan), { dur: 0.06, freq: 3000, q: 2, gain: 0.3 });
  }

  hitConfirm() {
    if (!this.ready()) return;
    this.tone(this.master, { freq: 1300, to: 1700, dur: 0.07, type: 'square', gain: 0.08 });
  }

  hurt() {
    if (!this.ready()) return;
    this.tone(this.master, { freq: 220, to: 90, dur: 0.18, type: 'sawtooth', gain: 0.18 });
    this.noiseBurst(this.master, { dur: 0.15, freq: 400, q: 0.5, gain: 0.3, type: 'lowpass' });
  }

  killConfirm() {
    if (!this.ready()) return;
    [880, 1175, 1568].forEach((f, i) => this.tone(this.master, { freq: f, dur: 0.18, type: 'triangle', gain: 0.18, delay: i * 0.07 }));
  }

  explosion(x, y) {
    if (!this.ready()) return;
    const s = this.spatial(x, y, 120); if (!s) return;
    const dest = this.out(s.vol, s.pan);
    this.noiseBurst(dest, { dur: 1.2, freq: 900, q: 0.4, gain: 1, type: 'lowpass', slide: 60, attack: 0.005 });
    this.tone(dest, { freq: 90, to: 30, dur: 0.9, type: 'sine', gain: 0.9 });
  }

  pickup() {
    if (!this.ready()) return;
    this.tone(this.master, { freq: 660, dur: 0.07, type: 'square', gain: 0.07 });
    this.tone(this.master, { freq: 990, dur: 0.09, type: 'square', gain: 0.07, delay: 0.06 });
  }

  reload() {
    if (!this.ready()) return;
    this.noiseBurst(this.master, { dur: 0.05, freq: 2500, q: 3, gain: 0.25 });
    setTimeout(() => this.ready() && this.noiseBurst(this.master, { dur: 0.06, freq: 1800, q: 3, gain: 0.3 }), 350);
  }

  swap() { if (this.ready()) this.noiseBurst(this.master, { dur: 0.05, freq: 2000, q: 2, gain: 0.2 }); }
  empty() { if (this.ready()) this.tone(this.master, { freq: 1900, dur: 0.03, type: 'square', gain: 0.06 }); }
  heal() {
    if (!this.ready()) return;
    [523, 659, 784].forEach((f, i) => this.tone(this.master, { freq: f, dur: 0.15, type: 'sine', gain: 0.15, delay: i * 0.08 }));
  }
  throwNade() { if (this.ready()) this.noiseBurst(this.master, { dur: 0.2, freq: 700, q: 0.8, gain: 0.25, slide: 1500 }); }
  jump() { if (this.ready()) this.noiseBurst(this.master, { dur: 0.7, freq: 500, q: 0.6, gain: 0.35, slide: 1800, attack: 0.15 }); }
  land(x, y) {
    if (!this.ready()) return;
    const s = this.spatial(x, y, 30); if (!s) return;
    this.noiseBurst(this.out(s.vol, s.pan), { dur: 0.2, freq: 250, q: 0.6, gain: 0.5, type: 'lowpass' });
  }
  zoneWarn() {
    if (!this.ready()) return;
    [0, 0.25].forEach((d) => this.tone(this.master, { freq: 440, to: 330, dur: 0.2, type: 'square', gain: 0.07, delay: d }));
  }
  victory() {
    if (!this.ready()) return;
    [523, 659, 784, 1047, 784, 1047].forEach((f, i) => this.tone(this.master, { freq: f, dur: 0.22, type: 'triangle', gain: 0.2, delay: i * 0.12 }));
  }
  defeat() {
    if (!this.ready()) return;
    [392, 330, 262].forEach((f, i) => this.tone(this.master, { freq: f, dur: 0.3, type: 'triangle', gain: 0.18, delay: i * 0.18 }));
  }

  planeDrone(on) {
    if (!this.ctx) return;
    if (on && !this.planeOsc) {
      const o = this.ctx.createOscillator();
      o.type = 'sawtooth'; o.frequency.value = 62;
      const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 280;
      const g = this.ctx.createGain(); g.gain.value = 0.09;
      o.connect(f); f.connect(g); g.connect(this.master);
      o.start();
      this.planeOsc = { o, g };
    } else if (!on && this.planeOsc) {
      const { o, g } = this.planeOsc;
      g.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + 0.6);
      o.stop(this.ctx.currentTime + 0.7);
      this.planeOsc = null;
    }
  }
}
