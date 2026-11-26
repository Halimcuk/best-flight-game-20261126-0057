// Skyline Courier — tiny WebAudio bleeps. Created lazily on the first user
// gesture (browsers block audio before one) and guarded so a missing audio
// device can never break the game.
export class Sfx {
  constructor() {
    this.ctx = null;
  }

  unlock() {
    if (this.ctx) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
    } catch {
      this.ctx = null;
    }
  }

  _tone(freq, dur, type = 'sine', gain = 0.08, slideTo = null) {
    if (!this.ctx) return;
    try {
      const t0 = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t0);
      if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
      g.gain.setValueAtTime(gain, t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(g).connect(this.ctx.destination);
      osc.start(t0);
      osc.stop(t0 + dur + 0.02);
    } catch {
      // Audio is decoration; never let it break the game.
    }
  }

  ring() {
    this._tone(880, 0.18, 'sine', 0.09);
    setTimeout(() => this._tone(1318, 0.22, 'sine', 0.08), 90);
  }

  click() {
    this._tone(660, 0.07, 'square', 0.04);
  }

  warn() {
    this._tone(220, 0.25, 'sawtooth', 0.05, 180);
  }

  crash() {
    this._tone(160, 0.5, 'sawtooth', 0.12, 40);
  }

  done() {
    [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => this._tone(f, 0.25, 'sine', 0.09), i * 120));
  }
}
