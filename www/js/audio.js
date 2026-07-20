// OBELISK — procedural darksynth engine. No assets, all synthesis.
//
// The tune is unchanged from v1 (same A-minor brood, same bass walk, same
// arpeggio contour). What changed is the PRODUCTION: detuned supersaws,
// resonant filter envelopes, convolution reverb, stereo feedback delay,
// sidechain pumping off the kick, layered drums, bus saturation, and an
// arrangement that adds stems as intensity climbs.
//
// Signal flow:
//   voices ─┬─> musicBus -> duck(sidechain) ─┐
//           ├─> reverbSend -> convolver ─────┼─> master -> saturator -> comp -> out
//           └─> delaySend  -> pingpong ──────┘
//   sfx ─────────────────────────────────────┘

const A = 220;                       // A3 — the tonal home
const MINOR = [0, 2, 3, 5, 7, 8, 10]; // natural minor scale degrees

// same bass walk as v1: A A C G A A D G (one root per bar)
const BASS_ROOTS = [55, 55, 65.41, 49, 55, 55, 73.42, 49];
// same arpeggio contour as v1
const ARP = [220, 261.63, 329.63, 392, 440, 392, 329.63, 261.63];
// same pad voicing as v1
const PAD = [110, 164.81, 220];

class AudioEngine {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.musicOn = false;
    this.tempo = 108;
    this.step = 0;
    this.nextNoteTime = 0;
    this.intensity = 0;
    this.eclipse = false;
    this.timer = null;
    this.beatAt = 0;      // audio-clock time of the last kick (visual sync)
    this.barAt = 0;
  }

  /* ================= graph ================= */
  ensure() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC({ latencyHint: 'interactive' });
    const ctx = this.ctx;

    // ---- master chain: saturation -> glue compression -> out
    this.master = ctx.createGain();
    this.master.gain.value = 0.62;

    const sat = ctx.createWaveShaper();
    sat.curve = this.#satCurve(1.6);
    sat.oversample = '4x';

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 12;
    comp.ratio.value = 4;
    comp.attack.value = 0.004;
    comp.release.value = 0.18;

    this.master.connect(sat).connect(comp).connect(ctx.destination);

    // ---- reverb send (procedural impulse response)
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.#impulse(3.4, 2.6);
    this.reverbGain = ctx.createGain();
    this.reverbGain.gain.value = 0.9;
    const revDamp = ctx.createBiquadFilter();
    revDamp.type = 'lowpass';
    revDamp.frequency.value = 3200;   // dark tail
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 1;
    this.reverbSend.connect(this.reverb).connect(revDamp).connect(this.reverbGain).connect(this.master);

    // ---- stereo feedback delay (dotted-8th ping pong)
    this.delaySend = ctx.createGain();
    const dL = ctx.createDelay(2), dR = ctx.createDelay(2);
    const fb = ctx.createGain(); fb.gain.value = 0.36;
    const dampD = ctx.createBiquadFilter();
    dampD.type = 'lowpass'; dampD.frequency.value = 2400;
    const panL = ctx.createStereoPanner(); panL.pan.value = -0.75;
    const panR = ctx.createStereoPanner(); panR.pan.value = 0.75;
    this.delayL = dL; this.delayR = dR;
    this.setDelayTime(108);
    this.delayGain = ctx.createGain();
    this.delayGain.gain.value = 0.5;
    this.delaySend.connect(dL);
    dL.connect(panL).connect(this.delayGain);
    dL.connect(dampD).connect(fb).connect(dR);
    dR.connect(panR).connect(this.delayGain);
    dR.connect(dL);
    this.delayGain.connect(this.master);

    // ---- music bus with sidechain duck
    this.duck = ctx.createGain();
    this.duck.gain.value = 1;
    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = 0.5;
    this.musicBus.connect(this.duck).connect(this.master);

    // stems (so the arrangement can breathe)
    this.stem = {};
    for (const name of ['drums', 'bass', 'arp', 'pad', 'lead']) {
      const g = ctx.createGain();
      g.gain.value = name === 'lead' ? 0 : 1;
      g.connect(this.musicBus);
      this.stem[name] = g;
    }

    // ---- sfx bus (never ducked — player feedback must always cut through)
    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = 0.9;
    this.sfxBus.connect(this.master);
  }

  #satCurve(amount) {
    const n = 1024, curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i * 2) / n - 1;
      curve[i] = Math.tanh(x * amount) / Math.tanh(amount);
    }
    return curve;
  }

  #impulse(dur, decay) {
    const rate = this.ctx.sampleRate;
    const len = Math.floor(rate * dur);
    const buf = this.ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        // slight pre-delay shimmer + exponential decay
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay) * (i < rate * 0.01 ? t * 100 : 1);
      }
    }
    return buf;
  }

  setDelayTime(bpm) {
    const beat = 60 / bpm;
    const t = beat * 0.75; // dotted 8th
    if (this.delayL) {
      this.delayL.delayTime.setTargetAtTime(t, this.ctx.currentTime, 0.1);
      this.delayR.delayTime.setTargetAtTime(t, this.ctx.currentTime, 0.1);
    }
  }

  toggleMute() {
    this.ensure();
    this.muted = !this.muted;
    this.master.gain.setTargetAtTime(this.muted ? 0 : 0.62, this.ctx.currentTime, 0.04);
    return this.muted;
  }

  /* ================= voice primitives ================= */

  // Rich detuned saw/any-wave voice with a resonant filter envelope.
  #voice(t, {
    freq, dur, type = 'sawtooth', gain = 0.1, detune = 0, voices = 1,
    cutoff = 1800, cutEnv = 0, q = 6, dest = null, attack = 0.008,
    release = null, send = 0, delay = 0, pan = 0, glideFrom = null,
  }) {
    const ctx = this.ctx;
    const out = ctx.createGain();
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.Q.value = q;
    filt.frequency.setValueAtTime(Math.max(60, cutoff), t);
    if (cutEnv) {
      filt.frequency.linearRampToValueAtTime(Math.max(60, cutoff + cutEnv), t + 0.012);
      filt.frequency.exponentialRampToValueAtTime(Math.max(60, cutoff), t + dur * 0.85);
    }

    const rel = release ?? dur;
    out.gain.setValueAtTime(0, t);
    out.gain.linearRampToValueAtTime(gain, t + attack);
    out.gain.exponentialRampToValueAtTime(0.0001, t + rel);

    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;

    for (let i = 0; i < voices; i++) {
      const o = ctx.createOscillator();
      o.type = type;
      const spread = voices > 1 ? (i - (voices - 1) / 2) * detune : 0;
      if (glideFrom) {
        o.frequency.setValueAtTime(glideFrom, t);
        o.frequency.exponentialRampToValueAtTime(freq, t + Math.min(0.18, dur));
      } else {
        o.frequency.setValueAtTime(freq, t);
      }
      o.detune.setValueAtTime(spread, t);
      o.connect(filt);
      o.start(t);
      o.stop(t + rel + 0.08);
    }

    filt.connect(out).connect(panner);
    panner.connect(dest || this.sfxBus);
    if (send > 0) { const s = ctx.createGain(); s.gain.value = send; panner.connect(s).connect(this.reverbSend); }
    if (delay > 0) { const s = ctx.createGain(); s.gain.value = delay; panner.connect(s).connect(this.delaySend); }
    return out;
  }

  #noise(t, { dur, gain = 0.1, freq = 1200, q = 1, type = 'bandpass', freqEnd = null, dest = null, send = 0, pan = 0 }) {
    const ctx = this.ctx;
    const n = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(freq, t);
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(Math.max(40, freqEnd), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const p = ctx.createStereoPanner(); p.pan.value = pan;
    src.connect(f).connect(g).connect(p);
    p.connect(dest || this.sfxBus);
    if (send > 0) { const s = ctx.createGain(); s.gain.value = send; p.connect(s).connect(this.reverbSend); }
    src.start(t); src.stop(t + dur + 0.02);
  }

  /* ================= drums ================= */
  #kick(t, hard = false) {
    // layered: sine body sweep + click transient
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(hard ? 165 : 140, t);
    o.frequency.exponentialRampToValueAtTime(38, t + 0.14);
    g.gain.setValueAtTime(0.85, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    o.connect(g).connect(this.stem.drums);
    o.start(t); o.stop(t + 0.34);
    this.#noise(t, { dur: 0.02, gain: 0.18, freq: 2600, q: 0.6, dest: this.stem.drums });
    // sidechain pump
    this.duck.gain.cancelScheduledValues(t);
    this.duck.gain.setValueAtTime(1, t);
    this.duck.gain.linearRampToValueAtTime(0.42, t + 0.012);
    this.duck.gain.setTargetAtTime(1, t + 0.02, 0.09);
    this.beatAt = t;
  }

  #snare(t, gain = 0.34) {
    this.#noise(t, { dur: 0.17, gain, freq: 1900, q: 0.8, freqEnd: 900, dest: this.stem.drums, send: 0.3 });
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(190, t);
    o.frequency.exponentialRampToValueAtTime(120, t + 0.1);
    g.gain.setValueAtTime(0.16, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
    o.connect(g).connect(this.stem.drums);
    o.start(t); o.stop(t + 0.16);
  }

  #hat(t, open = false) {
    this.#noise(t, {
      dur: open ? 0.18 : 0.035,
      gain: (open ? 0.055 : 0.05) + this.intensity * 0.03,
      freq: 9000, q: 1.4, type: 'highpass',
      dest: this.stem.drums,
      pan: (Math.random() - 0.5) * 0.4,
    });
  }

  /* ================= the score ================= */
  startMusic() {
    this.ensure();
    if (this.musicOn) return;
    this.musicOn = true;
    this.step = 0;
    this.nextNoteTime = this.ctx.currentTime + 0.12;
    this.#schedule();
  }

  stopMusic() {
    this.musicOn = false;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
  }

  setIntensity(x) {
    this.intensity = Math.max(0, Math.min(1, x));
    this.tempo = 108 + this.intensity * 40;
    if (this.ctx) {
      this.setDelayTime(this.tempo);
      // the lead stem fades in only when things get hairy
      this.stem.lead.gain.setTargetAtTime(this.intensity > 0.45 ? 0.9 : 0, this.ctx.currentTime, 1.2);
      this.reverbGain.gain.setTargetAtTime(0.9 - this.intensity * 0.35, this.ctx.currentTime, 1.5);
    }
  }

  // ECLIPSE: everything drops away into a filtered, reverb-drenched hush.
  setEclipse(on) {
    if (!this.ctx) return;
    this.eclipse = on;
    const t = this.ctx.currentTime;
    this.stem.drums.gain.setTargetAtTime(on ? 0.12 : 1, t, 0.12);
    this.stem.arp.gain.setTargetAtTime(on ? 0.25 : 1, t, 0.12);
    this.stem.bass.gain.setTargetAtTime(on ? 0.5 : 1, t, 0.12);
    this.reverbGain.gain.setTargetAtTime(on ? 1.8 : 0.9 - this.intensity * 0.35, t, 0.2);
    this.musicBus.gain.setTargetAtTime(on ? 0.34 : 0.5, t, 0.2);
    if (on) {
      // a deep swelling drone under the frozen time
      this.#voice(t, { freq: 55, dur: 9, type: 'sawtooth', gain: 0.12, voices: 3, detune: 14, cutoff: 300, cutEnv: 500, q: 8, dest: this.musicBus, attack: 0.6, send: 0.8 });
      this.#voice(t, { freq: 82.41, dur: 9, type: 'sine', gain: 0.09, dest: this.musicBus, attack: 0.9, send: 0.9 });
    }
  }

  #schedule() {
    if (!this.musicOn) return;
    const spb = 60 / this.tempo / 2; // 8th notes
    while (this.nextNoteTime < this.ctx.currentTime + 0.22) {
      this.#playStep(this.step, this.nextNoteTime, spb);
      this.nextNoteTime += spb;
      this.step = (this.step + 1) % 64;
    }
    this.timer = setTimeout(() => this.#schedule(), 45);
  }

  #playStep(s, t, spb) {
    const bar = (s / 8) | 0;
    const I = this.intensity;
    const ecl = this.eclipse;

    /* ---- drums ---- */
    if (s % 4 === 0) { this.#kick(t, bar % 2 === 1); if (s === 0) this.barAt = t; }
    if (I > 0.25 && s % 8 === 4) this.#snare(t, 0.3);                 // backbeat enters
    if (I > 0.6 && s % 16 === 14) this.#snare(t, 0.18);               // ghost note
    if (!ecl) {
      if (s % 2 === 1) this.#hat(t, false);
      if (I > 0.45 && s % 8 === 6) this.#hat(t, true);
      if (I > 0.75 && s % 4 === 2) this.#hat(t, false);
    }

    /* ---- bass: same walk, now a detuned saw + sub ---- */
    if (s % 4 === 0) {
      const f = BASS_ROOTS[bar % 8];
      this.#voice(t, {
        freq: f, dur: spb * 3.6, type: 'sawtooth', gain: 0.16,
        voices: 3, detune: 11, cutoff: 220 + I * 260, cutEnv: 900 + I * 700, q: 9,
        dest: this.stem.bass, release: spb * 3.9,
      });
      this.#voice(t, { freq: f / 2, dur: spb * 3.4, type: 'sine', gain: 0.2, cutoff: 400, q: 0.5, dest: this.stem.bass });
    }

    /* ---- arpeggio: same notes, now with filter movement + delay ---- */
    const density = I < 0.3 ? 4 : I < 0.7 ? 2 : 1;
    if (s % density === 0 && bar % 2 === 1) {
      const f = ARP[s % 8] * (bar % 4 === 3 ? 1.5 : 1);
      this.#voice(t, {
        freq: f, dur: spb * 1.9, type: 'sawtooth',
        gain: (0.055 + I * 0.045) * (ecl ? 0.5 : 1),
        voices: 2, detune: 9,
        cutoff: 900 + I * 1400 + Math.sin(s * 0.7) * 400, cutEnv: 1600, q: 7,
        dest: this.stem.arp, send: 0.35, delay: 0.5,
        pan: ((s % 4) - 1.5) * 0.22,
      });
    }

    /* ---- pads: same voicing, now wide and evolving ---- */
    if (s % 32 === 0) {
      PAD.forEach((f, i) => {
        this.#voice(t, {
          freq: f, dur: spb * 30, type: 'sawtooth', gain: 0.032,
          voices: 3, detune: 16,
          cutoff: 420 + I * 380, cutEnv: 620, q: 3,
          dest: this.stem.pad, attack: spb * 6, release: spb * 30,
          send: 0.9, pan: (i - 1) * 0.5,
        });
      });
    }

    /* ---- lead: a slow mournful counter-melody, only when it's getting bad ---- */
    if (s % 16 === 0 && I > 0.45) {
      const notes = [440, 523.25, 493.88, 392];
      const f = notes[(bar / 2 | 0) % 4];
      this.#voice(t, {
        freq: f, dur: spb * 12, type: 'triangle', gain: 0.075,
        voices: 2, detune: 7, cutoff: 1500, cutEnv: 900, q: 4,
        dest: this.stem.lead, attack: spb * 2, release: spb * 14,
        send: 1.0, delay: 0.4, pan: -0.2,
      });
    }
  }

  /* ================= SFX (synesthesia: everything sings in key) ================= */

  // Quantize an arbitrary step to the A-minor scale, in Hz.
  #scale(deg, octave = 0) {
    const semis = MINOR[((deg % 7) + 7) % 7] + 12 * (octave + Math.floor(deg / 7));
    return A * Math.pow(2, semis / 12);
  }

  move() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.#voice(t, { freq: this.#scale(0, -1), dur: 0.05, type: 'square', gain: 0.045, cutoff: 1400, q: 2, release: 0.06 });
  }

  rotate() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.#voice(t, { freq: this.#scale(4, 0), dur: 0.09, type: 'triangle', gain: 0.07, cutoff: 2600, cutEnv: 1800, q: 4, send: 0.2, release: 0.12 });
  }

  softDrop() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.#voice(t, { freq: this.#scale(0, -2), dur: 0.04, type: 'sine', gain: 0.05, cutoff: 900, release: 0.05 });
  }

  lockPiece(heightFrac = 0.5) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    // the higher the stack, the higher (more anxious) the pitch
    const deg = Math.round(heightFrac * 6);
    this.#voice(t, { freq: this.#scale(deg, -2), dur: 0.14, type: 'sine', gain: 0.16, cutoff: 700, cutEnv: 400, release: 0.2, send: 0.2 });
    this.#noise(t, { dur: 0.06, gain: 0.08, freq: 900, q: 0.8, freqEnd: 320 });
  }

  hardDrop(dist = 10) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const p = Math.min(1, dist / 18);
    this.#voice(t, { freq: 200, glideFrom: 480, dur: 0.18, type: 'sine', gain: 0.2 + p * 0.12, cutoff: 900, release: 0.24, send: 0.25 });
    this.#noise(t, { dur: 0.14, gain: 0.16 + p * 0.1, freq: 1600, q: 0.6, freqEnd: 200, send: 0.3 });
  }

  // Line clear sings an ascending chord — more lines, richer chord.
  lineClear(n = 1, combo = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const degs = [0, 2, 4, 6].slice(0, Math.max(2, Math.min(4, n)));
    const lift = Math.min(8, combo); // combos climb the scale
    degs.forEach((d, i) => {
      this.#voice(t + i * 0.045, {
        freq: this.#scale(d + lift, n >= 4 ? 1 : 0),
        dur: 0.7, type: 'triangle', gain: 0.13,
        voices: 2, detune: 6, cutoff: 2600, cutEnv: 2400, q: 3,
        send: 0.7, delay: 0.35, release: 0.9, pan: (i - 1) * 0.3,
      });
    });
    this.#noise(t, { dur: 0.5, gain: 0.1, freq: 1600, q: 0.5, freqEnd: 7000, send: 0.5 });
    if (n >= 4) {
      // TETRIS — a bell that rings out over everything
      this.#voice(t, { freq: this.#scale(0, 2), dur: 1.8, type: 'sine', gain: 0.14, cutoff: 4000, send: 1.0, delay: 0.5, release: 2.2 });
    }
  }

  combo(n) {
    if (!this.ctx || n < 2) return;
    const t = this.ctx.currentTime;
    this.#voice(t, { freq: this.#scale(Math.min(11, n), 1), dur: 0.3, type: 'square', gain: 0.06, cutoff: 3000, cutEnv: 2000, q: 5, send: 0.5, delay: 0.4, release: 0.4 });
  }

  spin() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.#noise(t, { dur: 0.7, gain: 0.22, freq: 260, q: 1.6, freqEnd: 3000, send: 0.6 });
    this.#voice(t, { freq: 300, glideFrom: 70, dur: 0.6, type: 'sawtooth', gain: 0.08, voices: 3, detune: 20, cutoff: 700, cutEnv: 2200, q: 8, send: 0.5, release: 0.7 });
  }

  warning() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (let i = 0; i < 2; i++) {
      this.#voice(t + i * 0.17, { freq: this.#scale(6, 1), dur: 0.1, type: 'square', gain: 0.075, cutoff: 2400, q: 3, release: 0.13 });
    }
  }

  levelUp() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    [0, 2, 4, 7].forEach((d, i) => {
      this.#voice(t + i * 0.07, { freq: this.#scale(d, 0), dur: 0.45, type: 'triangle', gain: 0.09, voices: 2, detune: 8, cutoff: 2600, cutEnv: 1800, q: 4, send: 0.7, delay: 0.4, release: 0.6 });
    });
  }

  eclipseStart() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    // reversed-swell impact: sub boom + rising shimmer + choir-ish stack
    this.#voice(t, { freq: 44, glideFrom: 120, dur: 1.4, type: 'sine', gain: 0.4, cutoff: 400, release: 1.6, send: 0.5 });
    this.#noise(t, { dur: 1.2, gain: 0.2, freq: 200, q: 0.7, freqEnd: 9000, send: 0.9 });
    [0, 3, 7].forEach((d, i) => {
      this.#voice(t + i * 0.02, { freq: this.#scale(d, 0), dur: 2.4, type: 'sawtooth', gain: 0.07, voices: 3, detune: 18, cutoff: 900, cutEnv: 1400, q: 6, send: 1.2, release: 2.8, pan: (i - 1) * 0.5 });
    });
  }

  eclipseEnd(lines = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const big = Math.min(1, lines / 12);
    this.#voice(t, { freq: 55, glideFrom: 40, dur: 1.8, type: 'sine', gain: 0.35, cutoff: 500, release: 2.0, send: 0.6 });
    this.#noise(t, { dur: 1.0, gain: 0.22, freq: 9000, q: 0.5, freqEnd: 300, send: 0.8 });
    [0, 2, 4, 7, 9].forEach((d, i) => {
      this.#voice(t + i * 0.06, {
        freq: this.#scale(d, 1), dur: 1.6, type: 'triangle', gain: 0.08 + big * 0.05,
        voices: 2, detune: 7, cutoff: 3000, cutEnv: 2600, q: 3,
        send: 1.0, delay: 0.5, release: 2.0, pan: (i - 2) * 0.25,
      });
    });
  }

  fanfare() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    [[0, 0], [2, 0.12], [4, 0.24], [7, 0.36], [11, 0.6]].forEach(([d, dt]) => {
      this.#voice(t + dt, { freq: this.#scale(d, 0), dur: 0.7, type: 'triangle', gain: 0.14, voices: 3, detune: 10, cutoff: 3000, cutEnv: 2200, q: 4, send: 0.8, delay: 0.4, release: 0.9 });
    });
    this.#noise(t + 0.6, { dur: 1.0, gain: 0.1, freq: 3000, q: 0.5, freqEnd: 9000, send: 0.7 });
  }

  gameOver() {
    if (!this.ctx) return;
    this.stopMusic();
    const t = this.ctx.currentTime;
    // the tune collapses: same notes, detuning and falling
    [[7, 0], [4, 0.22], [2, 0.44], [0, 0.66], [-3, 0.9]].forEach(([d, dt]) => {
      this.#voice(t + dt, {
        freq: this.#scale(d, -1), dur: 1.1, type: 'sawtooth', gain: 0.12,
        voices: 3, detune: 26 + dt * 40, cutoff: 900 - dt * 500, cutEnv: 300, q: 7,
        send: 1.0, release: 1.4,
      });
    });
    this.#voice(t + 1.0, { freq: 27.5, glideFrom: 55, dur: 3.2, type: 'sine', gain: 0.3, cutoff: 300, release: 3.6, send: 0.7 });
    this.#noise(t + 1.0, { dur: 2.4, gain: 0.14, freq: 400, q: 0.6, freqEnd: 50, send: 0.8 });
    if (this.duck) this.duck.gain.setTargetAtTime(1, t, 0.3);
  }

  // A single whispered tone for lore beats.
  whisper() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.#noise(t, { dur: 1.6, gain: 0.05, freq: 700, q: 3, freqEnd: 1800, send: 1.2, pan: Math.random() - 0.5 });
    this.#voice(t, { freq: this.#scale(0, -1), dur: 2.0, type: 'sine', gain: 0.05, cutoff: 700, attack: 0.5, release: 2.4, send: 1.4 });
  }

  /* ---- visual sync helpers ---- */
  // 0..1 sawtooth phase within the current beat. beatAt is scheduled slightly
  // ahead of the audio clock, so wrap negatives back into the previous beat.
  get beatPhase() {
    if (!this.ctx || !this.musicOn) return 0;
    const beat = 60 / this.tempo;
    let since = this.ctx.currentTime - this.beatAt;
    while (since < 0) since += beat;
    return (since % beat) / beat;
  }

  // 1 -> 0 decaying pulse right after each kick; ideal for visual thumps.
  get beatPulse() {
    const p = this.beatPhase;
    return p === 0 ? 0 : Math.pow(1 - p, 3);
  }
}

export const audio = new AudioEngine();
