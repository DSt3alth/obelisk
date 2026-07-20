// OBELISK — fully procedural WebAudio: dark synth score + SFX. No assets.
class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.musicGain = null;
    this.sfxGain = null;
    this.muted = false;
    this.musicOn = false;
    this.tempo = 108;
    this.step = 0;
    this.nextNoteTime = 0;
    this.intensity = 0; // 0..1, ramps with level
  }

  ensure() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.55;
    // gentle limiter
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 6;
    this.master.connect(comp).connect(this.ctx.destination);
    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = 0.5;
    this.musicGain.connect(this.master);
    this.sfxGain = this.ctx.createGain();
    this.sfxGain.gain.value = 0.9;
    this.sfxGain.connect(this.master);
  }

  toggleMute() {
    this.ensure();
    this.muted = !this.muted;
    this.master.gain.setTargetAtTime(this.muted ? 0 : 0.55, this.ctx.currentTime, 0.05);
    return this.muted;
  }

  /* ---------------- SFX ---------------- */
  #osc(type, freq, t0, dur, gainPeak, freqEnd = null, dest = null) {
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (freqEnd) o.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t0 + dur);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gainPeak, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(dest || this.sfxGain);
    o.start(t0); o.stop(t0 + dur + 0.05);
  }

  #noise(t0, dur, gainPeak, filterFreq, q = 1, freqEnd = null) {
    const n = this.ctx.sampleRate * dur;
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass'; f.Q.value = q;
    f.frequency.setValueAtTime(filterFreq, t0);
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t0 + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gainPeak, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(this.sfxGain);
    src.start(t0); src.stop(t0 + dur);
  }

  move()   { if (!this.ctx) return; this.#osc('square', 220, this.ctx.currentTime, 0.05, 0.06, 190); }
  rotate() { if (!this.ctx) return; this.#osc('square', 330, this.ctx.currentTime, 0.07, 0.07, 440); }
  softDrop() { if (!this.ctx) return; this.#osc('sine', 160, this.ctx.currentTime, 0.04, 0.05, 140); }
  lockPiece() { if (!this.ctx) return; const t = this.ctx.currentTime; this.#osc('sine', 120, t, 0.12, 0.16, 60); this.#noise(t, 0.07, 0.1, 900, 0.8, 300); }
  hardDrop() { if (!this.ctx) return; const t = this.ctx.currentTime; this.#osc('sine', 180, t, 0.16, 0.24, 45); this.#noise(t, 0.12, 0.2, 1400, 0.7, 250); }

  lineClear(n = 1) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const base = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6
    for (let i = 0; i < Math.min(4, 2 + n); i++) {
      this.#osc('triangle', base[i], t + i * 0.055, 0.5, 0.14);
      this.#osc('sine', base[i] * 2, t + i * 0.055, 0.35, 0.05);
    }
    this.#noise(t, 0.45, 0.14, 1800, 0.6, 5200);
  }

  spin() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.#noise(t, 0.75, 0.3, 300, 1.4, 2600);
    this.#osc('sawtooth', 80, t, 0.7, 0.1, 320);
  }

  warning() { if (!this.ctx) return; const t = this.ctx.currentTime; this.#osc('square', 880, t, 0.11, 0.1, 830); this.#osc('square', 880, t + 0.16, 0.11, 0.1, 830); }
  levelUp() { if (!this.ctx) return; const t = this.ctx.currentTime; [440, 554, 659, 880].forEach((f, i) => this.#osc('triangle', f, t + i * 0.07, 0.4, 0.1)); }

  fanfare() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const seq = [[523.25, 0], [659.25, 0.12], [783.99, 0.24], [1046.5, 0.36], [1318.5, 0.6]];
    for (const [f, dt] of seq) {
      this.#osc('triangle', f, t + dt, 0.55, 0.16);
      this.#osc('sine', f * 2, t + dt, 0.4, 0.05);
    }
    this.#noise(t + 0.6, 0.9, 0.12, 3000, 0.5, 8000);
  }

  gameOver() {
    if (!this.ctx) return;
    this.stopMusic();
    const t = this.ctx.currentTime;
    [392, 330, 262, 196, 131].forEach((f, i) => { this.#osc('sawtooth', f, t + i * 0.22, 0.55, 0.12, f * 0.97); });
    this.#noise(t + 1.0, 1.6, 0.18, 220, 0.8, 60);
  }

  /* ---------------- music ---------------- */
  startMusic() {
    this.ensure();
    if (this.musicOn) return;
    this.musicOn = true;
    this.step = 0;
    this.nextNoteTime = this.ctx.currentTime + 0.1;
    this.#schedule();
  }

  stopMusic() { this.musicOn = false; if (this.timer) clearTimeout(this.timer); }
  setIntensity(x) { this.intensity = Math.min(1, x); this.tempo = 108 + this.intensity * 44; }

  #schedule() {
    if (!this.musicOn) return;
    const spb = 60 / this.tempo / 2; // 8th notes
    while (this.nextNoteTime < this.ctx.currentTime + 0.25) {
      this.#playStep(this.step, this.nextNoteTime, spb);
      this.nextNoteTime += spb;
      this.step = (this.step + 1) % 64;
    }
    this.timer = setTimeout(() => this.#schedule(), 60);
  }

  #playStep(s, t, spb) {
    const g = this.musicGain;
    const bar = (s / 8) | 0;
    // kick: every beat
    if (s % 4 === 0) this.#osc('sine', 130, t, 0.22, 0.5, 42, g);
    // hats: offbeats, denser with intensity
    if (s % 2 === 1 || (this.intensity > 0.5 && s % 4 === 2)) this.#noise(t, 0.05, 0.05 + this.intensity * 0.04, 8000, 1.2, 6000);
    // bass line: A minor brood — A C E G walk, changes per bar
    const bassRoots = [55, 55, 65.4, 49, 55, 55, 73.4, 49];
    if (s % 4 === 0) this.#osc('sawtooth', bassRoots[bar % 8], t, spb * 3.4, 0.16, bassRoots[bar % 8], g);
    // arpeggio: sparse at low intensity, cascading at high
    const arp = [220, 261.6, 329.6, 392, 440, 392, 329.6, 261.6];
    const density = this.intensity < 0.3 ? 4 : this.intensity < 0.7 ? 2 : 1;
    if (s % density === 0 && bar % 2 === 1) {
      this.#osc('triangle', arp[s % 8] * (bar % 4 === 3 ? 1.5 : 1), t, spb * 1.8, 0.06 + this.intensity * 0.05, null, g);
    }
    // pad swells at bar starts
    if (s % 32 === 0) {
      [110, 164.8, 220].forEach(f => this.#osc('sine', f, t, spb * 28, 0.035, null, g));
    }
  }
}

export const audio = new AudioEngine();
