// OBELISK — orchestrator.
import { Board, ROWS } from './tetris.js';
import { FaceRenderer } from './render2d.js';
import { Stage } from './scene3d.js';
import { audio } from './audio.js';
import { scoreClear, scoreDrop, scoreEclipse, clearName, fmtScore } from './scoring.js';
import * as P from './profile.js';
import { FRAGMENTS, ACTS, pickWhisper, fragmentById } from './story.js';
import { DIFFICULTIES, loadDifficulty, saveDifficulty } from './difficulty.js';
import { createReckoningClock } from './reckoningclock.js';

const FACES = [
  { glyph: 'I',   accent: '#22d3ee' },
  { glyph: 'II',  accent: '#e879f9' },
  { glyph: 'III', accent: '#fbbf24' },
  { glyph: 'IV',  accent: '#34d399' },
];

// Faces around the obelisk in screen left-to-right (CW) order — verified
// against the render: from I, IV is to the right, II to the left, III behind.
// next in RING = the face physically on your right.
const RING = [0, 3, 2, 1];
function neighbours(face) {
  const i = RING.indexOf(face);
  return {
    current: face,
    right: RING[(i + 1) % 4],
    behind: RING[(i + 2) % 4],
    left: RING[(i + 3) % 4],
  };
}

const CLEAR_FLASH_MS = 320;
const BASE_GRAVITY = 820;
const THREE_MIN = 180_000;

// One shared intensity language — nothing else may touch these slots.
const HITSTOP = { lock: 0.03, 1: 0.04, 2: 0.06, 3: 0.08, 4: 0.12, tspin: 0.14, perfect: 0.20, death: 0.25, eclipse: 0.30 };
const TRAUMA  = { lock: 0.05, 1: 0.15, 2: 0.22, 3: 0.30, 4: 0.45, tspin: 0.35, perfect: 0.80, death: 1.00, spin: 0.30 };

const ECLIPSE_MIN = 3;    // minimum charge to invoke, regardless of difficulty

const MODES = {
  rite:      { title: 'RITE',         players: 1, spinDur: 0.72, ranked: true },
  sovereign: { title: 'SOVEREIGN',    players: 1, spinDur: 0.46, ranked: true },
  duel:      { title: 'DUEL',         players: 2, spinDur: 0.62, ranked: false, competitive: true },
  coop:      { title: 'TWIN VIGIL',   players: 2, spinDur: 0.62, ranked: true,  competitive: false },
  reckoning: { title: 'THE RECKONING', players: 1, spinDur: 0.72, ranked: true, durationMs: THREE_MIN },
  daily:     { title: 'THE SEAL',     players: 1, spinDur: 0.66, ranked: false, daily: true, durationMs: THREE_MIN },
};
const MODE_ORDER = ['rite', 'sovereign', 'duel', 'coop', 'reckoning', 'daily'];

const SOLO_KEYS = {
  moveL: ['ArrowLeft', 'KeyA'], moveR: ['ArrowRight', 'KeyD'], soft: ['ArrowDown', 'KeyS'],
  rotCW: ['ArrowUp', 'KeyX', 'KeyW'], rotCCW: ['KeyZ'], hard: ['Space'],
  hold: ['KeyC', 'ShiftLeft'], eclipse: ['ShiftRight', 'KeyF'],
  spinL: ['KeyQ'], spinR: ['KeyE'],
};
const DUEL_KEYS = [
  { moveL: ['KeyA'], moveR: ['KeyD'], soft: ['KeyS'], rotCW: ['KeyW'], rotCCW: ['KeyQ'], hard: ['Space'], hold: ['KeyE'], eclipse: ['KeyR'], spinL: [], spinR: [] },
  { moveL: ['ArrowLeft'], moveR: ['ArrowRight'], soft: ['ArrowDown'], rotCW: ['ArrowUp'], rotCCW: ['Slash'], hard: ['ShiftRight'], hold: ['Period'], eclipse: ['Comma'], spinL: [], spinR: [] },
];
// Twin Vigil: same layout as Duel, plus free-spin keys — only live during a
// shared ECLIPSE, when both Keepers may roam all four faces.
const COOP_KEYS = [
  { moveL: ['KeyA'], moveR: ['KeyD'], soft: ['KeyS'], rotCW: ['KeyW'], rotCCW: ['KeyQ'], hard: ['Space'], hold: ['KeyE'], eclipse: ['KeyR'], spinL: ['KeyZ'], spinR: ['KeyC'] },
  { moveL: ['ArrowLeft'], moveR: ['ArrowRight'], soft: ['ArrowDown'], rotCW: ['ArrowUp'], rotCCW: ['Slash'], hard: ['ShiftRight'], hold: ['Period'], eclipse: ['Comma'], spinL: ['BracketLeft'], spinR: ['BracketRight'] },
];

const HINTS = {
  rite: '<span><b>←→</b> move</span><span><b>↑</b> rotate</span><span><b>Z</b> ccw</span><span><b>C</b> hold</span><span><b>SPACE</b> drop</span><span><b>R-SHIFT</b> eclipse</span><span><b>P</b> pause</span>',
  sovereign: '<span><b>Q</b>/<b>E</b> TURN THE STONE</span><span><b>←→</b> move</span><span><b>↑</b> rotate</span><span><b>C</b> hold</span><span><b>SPACE</b> drop</span><span><b>R-SHIFT</b> eclipse</span>',
  duel: '<span>P1 <b>A/D/S</b> · <b>W</b> rot · <b>E</b> hold · <b>SPACE</b> drop · <b>R</b> eclipse</span><span>P2 <b>←↓→</b> · <b>↑</b> rot · <b>.</b> hold · <b>R-SHIFT</b> drop · <b>,</b> eclipse</span>',
  coop: '<span>FIRST WATCH <b>A/D/S</b> · <b>W</b> rot · <b>E</b> hold · <b>SPACE</b> drop · <b>R</b> eclipse</span><span>SECOND WATCH <b>←↓→</b> · <b>↑</b> rot · <b>.</b> hold · <b>R-SHIFT</b> drop · <b>,</b> eclipse</span><span>free-spin only inside a shared ECLIPSE</span>',
  reckoning: '<span>THREE MINUTES · SCORE ATTACK</span><span><b>←→</b> move</span><span><b>↑</b> rotate</span><span><b>C</b> hold</span><span><b>SPACE</b> drop</span><span><b>R-SHIFT</b> eclipse</span>',
  daily: '<span>THREE MINUTES</span><span><b>←→</b> move</span><span><b>↑</b> rotate</span><span><b>C</b> hold</span><span><b>SPACE</b> drop</span><span><b>R-SHIFT</b> eclipse</span>',
};

const PLAYER_NAMES = ['KEEPER ONE', 'KEEPER TWO'];
const COOP_NAMES = ['FIRST WATCH', 'SECOND WATCH'];
const PLAYER_COLORS = ['#7ceeff', '#ff9ab8'];

/* ---------------- handling ---------------- */
const HANDLING_DEF = [
  { key: 'das', name: 'DAS — delay before auto-shift', min: 40, max: 300, step: 10, unit: 'ms', def: 150 },
  { key: 'arr', name: 'ARR — auto-shift repeat rate', min: 0, max: 100, step: 5, unit: 'ms', def: 35 },
  { key: 'sdf', name: 'SDF — soft drop interval', min: 0, max: 120, step: 5, unit: 'ms', def: 25 },
  { key: 'ghost', name: 'Ghost piece', min: 0, max: 1, step: 1, unit: 'bool', def: 1 },
  { key: 'grain', name: 'Film grain', min: 0, max: 100, step: 10, unit: '%', def: 100 },
  { key: 'shake', name: 'Camera shake', min: 0, max: 150, step: 10, unit: '%', def: 100 },
];
function loadHandling() {
  let h = {};
  try { h = JSON.parse(localStorage.getItem('obelisk_handling') || '{}'); } catch {}
  const out = {};
  for (const d of HANDLING_DEF) out[d.key] = typeof h[d.key] === 'number' ? h[d.key] : d.def;
  return out;
}
function saveHandling() { try { localStorage.setItem('obelisk_handling', JSON.stringify(handling)); } catch {} }
let handling = loadHandling();

/* ---------------- dom ---------------- */
const $ = id => document.getElementById(id);
const panesEl = $('panes'), paneTpl = $('pane-tpl');
const timerEl = $('timer'), hudGlobal = $('hud-global'), hintEl = $('controls-hint');
const lbListEl = $('lb-list'), lbTitleEl = $('lb-title');
const nameInput = $('name-input'), whisperEl = $('whisper');
const eclOverlay = $('eclipse-overlay'), eclTimerFill = document.querySelector('.ecl-timer-fill');
const eclBankNum = $('ecl-bank-num');
const payoutEl = $('payout');
const fpsEl = $('fps-meter'), fpsNumEl = $('fps-num');
const reckoningClock = createReckoningClock($('reckoning-clock'));
const diffPills = [...document.querySelectorAll('.diff-pill')];
const diffTaglineEl = $('diff-tagline');

/* ---------------- state ---------------- */
let state = 'title';
let mode = 'rite';
let menuIdx = 0;
let difficultyIdx = loadDifficulty();
let players = [];
let paneKind = null; // 'solo' | 'duel' | 'coop' — tracks the LAST shape ensurePanes built
let profile = P.load();
let elapsed = 0, gravityAcc = 0, level = 1;
let lastTime = performance.now();
let titleDemoAcc = 0;
let pendingResult = null;
let padPrev = {};
let fpsAcc = 0, fpsFrames = 0;
let hitstop = 0;            // global sim freeze (seconds)
let lastWhisperAt = 0;
let runStats = null;
let codexIdx = 0, handlingIdx = 0;
let lastCountdownSec = null;    // THE RECKONING: last whole second we beeped
let reckoningRiserFired = false;

// Effective duty level for the CURRENT mode. The Seal is always DUTY-paced,
// whatever the player has selected, so every Keeper's daily is comparable.
function DIFF() { return mode === 'daily' ? DIFFICULTIES[1] : DIFFICULTIES[difficultyIdx]; }
// Leaderboards are scoped per mode *and* duty level (except the fixed-pace Seal).
function lbScopeFor(m) {
  const d = m === 'daily' ? 'duty' : DIFFICULTIES[difficultyIdx].id;
  return m + ':' + d;
}

function gravityMs() {
  const d = DIFF();
  return Math.max(95, BASE_GRAVITY * d.gravityMul * Math.pow(d.rampPow, level - 1));
}
function fmtTime(ms) {
  const t = Math.max(0, ms);
  const m = String(Math.floor(t / 60000)).padStart(2, '0');
  const s = String(Math.floor((t % 60000) / 1000)).padStart(2, '0');
  return `${m}:${s}.${Math.floor((t % 1000) / 100)}`;
}
function pop(el) { el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop'); }

function whisper(key, force = false) {
  const now = performance.now();
  if (!force && now - lastWhisperAt < 9000) return;
  const line = pickWhisper(key);
  if (!line) return;
  lastWhisperAt = now;
  whisperEl.textContent = line;
  whisperEl.classList.remove('show'); void whisperEl.offsetWidth; whisperEl.classList.add('show');
  audio.whisper();
}

/* ---------------- player ---------------- */
// opts.team / opts.boards / opts.renderers / opts.pair are how TWIN VIGIL
// wires two Players into one shared obelisk — see ensurePanes(). Every
// other mode leaves them unset and each Player is fully independent, exactly
// as before.
class Player {
  constructor(idx, pane, opts = {}) {
    this.idx = idx;
    this.pane = pane;
    const q = s => pane.querySelector(s);
    this.canvas = q('.gl');
    this.tagEl = q('.player-tag');
    this.glyphEl = q('.face-glyph');
    this.faceLinesEl = q('.face-lines');
    this.totalLinesEl = q('.total-lines');
    this.scoreEl = q('.score-num');
    this.levelEl = q('.level');
    this.vignetteEl = q('.danger-vignette');
    this.flashEl = q('.spin-flash');
    this.nearMissEl = q('.near-miss');
    this.comboEl = q('.combo-cluster');
    this.comboNum = q('.combo-num');
    this.comboLabel = q('.combo-label');
    this.popupsEl = q('.popups');
    this.eclFill = q('.ecl-fill');
    this.leftPanel = q('.side-panel.left');
    this.mon = {};
    for (const role of ['behind', 'left', 'current', 'right']) {
      const el = pane.querySelector('.monitor.' + role);
      const canvas = el.querySelector('.mon-cv');
      this.mon[role] = { el, canvas, cv: canvas.getContext('2d'), tag: el.querySelector('.mon-tag') };
    }

    // TWIN VIGIL shares one obelisk between two Players: same 4 boards, same
    // 4 face-canvases (a canvas can back more than one CanvasTexture), but
    // each Player still gets its own camera (Stage) and own currentFace.
    this.boards = opts.boards || FACES.map((_, i) => new Board(i));
    this.renderers = opts.renderers || this.boards.map((b, i) => new FaceRenderer(b, FACES[i]));
    this.stage = new Stage(this.canvas, this.renderers.map(r => r.canvas), FACES);
    this.team = opts.team || {
      score: 0, totalLines: 0, charge: 0, eclipseOn: false, eclipseT: 0, eclipseDur: 0,
      eclipseBank: 0, eclipsesUsed: 0, tetrises: 0, bestCombo: 0,
    };
    this.pair = opts.pair || null; // TWIN VIGIL: the two faces this Keeper answers for

    this.keymap = SOLO_KEYS;
    this.kb = {}; this.padHeld = {};
    this.hold = { left: { down: false, t: 0, rep: 0 }, right: { down: false, t: 0, rep: 0 }, soft: { down: false, acc: 0 } };
    this.currentFace = 0;
    this.alive = true;
    this.lastWarnPing = 0;
    this.hiddenDrawAt = [0, 0, 0, 0];
    this.lastMonDraw = 0;
    this.eclipseMax = 12; // set from the duty level at run start
  }

  // Score/lines/eclipse* all live on `team` — by default a private object
  // (identical to a plain field), but shared between both TWIN VIGIL
  // Players so a clear by either one updates both panes at once.
  get score() { return this.team.score; } set score(v) { this.team.score = v; }
  get totalLines() { return this.team.totalLines; } set totalLines(v) { this.team.totalLines = v; }
  get charge() { return this.team.charge; } set charge(v) { this.team.charge = v; }
  get eclipseOn() { return this.team.eclipseOn; } set eclipseOn(v) { this.team.eclipseOn = v; }
  get eclipseT() { return this.team.eclipseT; } set eclipseT(v) { this.team.eclipseT = v; }
  get eclipseDur() { return this.team.eclipseDur; } set eclipseDur(v) { this.team.eclipseDur = v; }
  get eclipseBank() { return this.team.eclipseBank; } set eclipseBank(v) { this.team.eclipseBank = v; }
  get eclipsesUsed() { return this.team.eclipsesUsed; } set eclipsesUsed(v) { this.team.eclipsesUsed = v; }
  get tetrises() { return this.team.tetrises; } set tetrises(v) { this.team.tetrises = v; }
  get bestCombo() { return this.team.bestCombo; } set bestCombo(v) { this.team.bestCombo = v; }

  // Full reset for a Player that owns its boards outright (solo/duel).
  reset(rng) {
    this.boards.forEach(b => { if (rng) b.setRng(rng); b.reset(); });
    this._resetViewState();
  }

  // TWIN VIGIL: the shared boards are reset once, externally, by startRun();
  // each camera only resets its own view/HUD state.
  resetView() { this._resetViewState(); }

  _resetViewState() {
    this.currentFace = this.pair ? this.pair[0] : 0;
    this.boards[this.currentFace].controlled = true;
    this.totalLines = 0; this.score = 0; this.alive = true;
    this.charge = 0; this.eclipseOn = false; this.eclipseBank = 0;
    this.eclipsesUsed = 0; this.tetrises = 0; this.bestCombo = 0;
    this.kb = {}; this.padHeld = {};
    this.hold = { left: { down: false, t: 0, rep: 0 }, right: { down: false, t: 0, rep: 0 }, soft: { down: false, acc: 0 } };
    // TWIN VIGIL's second Keeper starts on face II, not face I — the camera
    // must match, not just the board-control flag.
    this.stage.rotY = this.currentFace * Math.PI / 2;
    this.stage.spinT = 1;
    this.stage.setEclipse(false);
    this.faceLinesEl.textContent = '0';
    this.totalLinesEl.textContent = '0';
    this.scoreEl.textContent = '0';
    this.levelEl.textContent = '1';
    this.setAccent(this.currentFace);
    this.updateEclipseUI();
  }

  get board() { return this.boards[this.currentFace]; }

  setAccent(faceIdx) {
    const { accent } = FACES[faceIdx];
    this.pane.style.setProperty('--accent', accent);
    this.pane.style.setProperty('--accent-dim', accent + '59');
    this.glyphEl.textContent = FACES[faceIdx].glyph;
    this.stage.setAccent(accent);
    if (players.length === 1) {
      document.documentElement.style.setProperty('--accent', accent);
      document.documentElement.style.setProperty('--accent-dim', accent + '59');
    }
  }

  switchControl(to) {
    this.boards[this.currentFace].controlled = false;
    this.currentFace = to;
    const b = this.boards[to];
    b.controlled = true;
    b.autoPlan = null;
    this.setAccent(to);
    this.faceLinesEl.textContent = b.lines;
    pop(this.faceLinesEl);
  }

  randomOther() {
    const o = [0, 1, 2, 3].filter(i => i !== this.currentFace);
    return o[(Math.random() * o.length) | 0];
  }

  spinTo(face) {
    this.flashEl.classList.remove('go'); void this.flashEl.offsetWidth; this.flashEl.classList.add('go');
    audio.spin();
    this.stage.spinToFace(face);
    this.stage.kick(TRAUMA.spin);
    this.switchControl(face);
  }

  addScore(n) {
    if (n <= 0) return;
    this.score += n;
    this.scoreEl.textContent = fmtScore(this.score);
  }

  popup(label, value) {
    const el = document.createElement('div');
    el.className = 'pop-item';
    el.innerHTML = `${label ? `<span class="pl">${label}</span>` : ''}${value ? `<span class="pv">+${fmtScore(value)}</span>` : ''}`;
    this.popupsEl.appendChild(el);
    setTimeout(() => el.remove(), 1250);
  }

  showCombo(n) {
    if (n >= 1) {
      this.comboNum.textContent = `${n + 1}×`;
      this.comboLabel.textContent = 'COURSES IN SUCCESSION';
      this.comboEl.classList.add('on');
      this.bestCombo = Math.max(this.bestCombo, n);
    } else {
      this.comboEl.classList.remove('on');
    }
  }

  /* ---- eclipse ---- */
  get armed() { return this.charge >= ECLIPSE_MIN && !this.eclipseOn; }

  addCharge(n) {
    if (this.eclipseOn) return;
    const before = this.armed;
    this.charge = Math.min(this.eclipseMax, this.charge + n);
    this.updateEclipseUI();
    if (!before && this.armed) audio.combo(3);
  }

  updateEclipseUI() {
    const f = this.charge / this.eclipseMax;
    this.eclFill.style.right = `${(1 - f) * 100}%`;
    this.leftPanel.classList.toggle('armed', this.armed);
  }

  // A shared eclipse (TWIN VIGIL) is dramatic enough to earn the same
  // fullscreen takeover solo play gets — it is, after all, shared.
  get soloSpectacle() { return players.length === 1 || mode === 'coop'; }

  startEclipse() {
    if (!this.armed || !this.alive) return false;
    this.eclipseOn = true;
    this.eclipseDur = 3.5 + (this.charge / this.eclipseMax) * 8.5;
    this.eclipseT = this.eclipseDur;
    this.eclipseBank = 0;
    this.charge = 0;
    this.eclipsesUsed++;
    this.boards.forEach(b => { b.bankMode = true; b.banked = 0; });
    this.stage.setEclipse(true);
    this.stage.impact(0.55);
    this.stage.kick(0.5);
    this.updateEclipseUI();
    if (this.soloSpectacle) {
      eclOverlay.classList.remove('hidden');
      eclBankNum.textContent = '0';
      audio.eclipseStart();
      audio.setEclipse(true);
      whisper('eclipse', true);
    } else {
      audio.eclipseStart();
    }
    hitstop = Math.max(hitstop, HITSTOP.eclipse);
    return true;
  }

  endEclipse() {
    if (!this.eclipseOn) return;
    this.eclipseOn = false;
    this.boards.forEach(b => { b.bankMode = false; });
    this.stage.setEclipse(false);
    if (this.soloSpectacle) { eclOverlay.classList.add('hidden'); audio.setEclipse(false); }

    const banked = this.eclipseBank;
    if (banked > 0) {
      const { points, name, weight } = scoreEclipse(banked, level);
      this.addScore(points);
      this.stage.impact(0.5 + weight * 0.5);
      this.stage.kick(0.35 + weight * 0.65);
      this.stage.shockwave('#bfe9ff', 0.6 + weight, this.stage.group.position.y, true);
      this.stage.shockwave('#7cc4ff', 0.5 + weight, null, false);
      hitstop = Math.max(hitstop, 0.12 + weight * 0.12);
      audio.eclipseEnd(banked);
      if (this.soloSpectacle) showPayout(name, banked, points);
      whisper('eclipseEnd', true);
    } else {
      audio.eclipseEnd(0);
    }
    this.eclipseBank = 0;
  }

  tickEclipse(dt) {
    if (!this.eclipseOn) return;
    this.eclipseT -= dt;
    if (this.soloSpectacle) {
      eclTimerFill.style.transform = `scaleX(${Math.max(0, this.eclipseT / this.eclipseDur)})`;
      eclBankNum.textContent = this.eclipseBank;
    }
    if (this.eclipseT <= 0) this.endEclipse();
  }

  /* ---- monitors + danger ---- */
  drawMonitors(now) {
    // Compass: current face dead-centre, neighbours in their true positions,
    // so a spin never disorients — the layout is spatially stable.
    const map = neighbours(this.currentFace);
    let worstHidden = 0;
    for (const role of ['behind', 'left', 'current', 'right']) {
      const fi = map[role];
      const b = this.boards[fi];
      const m = this.mon[role];
      const src = this.renderers[fi].canvas;
      const cw = m.canvas.width, ch = m.canvas.height;
      m.cv.clearRect(0, 0, cw, ch);
      m.cv.drawImage(src, 0, 0, src.width, src.height, 0, 0, cw, ch);
      m.tag.textContent = FACES[fi].glyph;
      m.tag.style.color = FACES[fi].accent;
      const h = b.stackHeight();
      if (role !== 'current') {
        worstHidden = Math.max(worstHidden, h);
        m.el.classList.toggle('warning', h >= 15);
      }
    }
    const selfH = this.board.stackHeight();
    const worst = Math.max(worstHidden, selfH);
    const danger = Math.max(0, Math.min(1, (worst - 12) / 7));
    this.vignetteEl.classList.toggle('on', worst >= 15);
    this.stage.setDanger(this.eclipseOn ? 0 : danger);
    if (worst >= 16 && now - this.lastWarnPing > 2500) {
      this.lastWarnPing = now;
      audio.warning();
      if (worst >= 18) whisper('nearDeath');
    }
    // honest near-miss: a well one row deep from a big clear
    this.nearMissEl.classList.toggle('on', this.#nearMiss());
  }

  // True when exactly one column is keeping a 3+ row block from clearing —
  // surfaced, never manufactured.
  #nearMiss() {
    const g = this.board.grid;
    let run = 0;
    for (let y = ROWS - 1; y >= 0; y--) {
      const empty = g[y].reduce((a, v) => a + (v ? 0 : 1), 0);
      if (empty === 1) run++;
      else if (empty === 0) continue;
      else break;
    }
    return run >= 3;
  }

  dispose() { this.stage.dispose(); this.pane.remove(); }
}

/* ---------------- panes ---------------- */
// kind: 'solo' (default for n=1) | 'duel' (default for n=2) | 'coop'.
// duel and coop both use 2 panes but need DIFFERENT Player wiring (duel:
// each Player owns its own 4 boards; coop: both share one set) — paneKind
// lets us tell them apart even though the pane COUNT is identical, so
// switching duel <-> coop always rebuilds rather than silently reusing the
// wrong shape.
function ensurePanes(n, kind = n === 2 ? 'duel' : 'solo') {
  if (players.length === n && paneKind === kind) return;
  players.forEach(p => p.dispose());
  players = [];
  panesEl.innerHTML = '';

  let sharedBoards = null, sharedRenderers = null, sharedTeam = null;
  if (kind === 'coop') {
    sharedBoards = FACES.map((_, i) => new Board(i));
    sharedRenderers = sharedBoards.map((b, i) => new FaceRenderer(b, FACES[i]));
    sharedTeam = {
      score: 0, totalLines: 0, charge: 0, eclipseOn: false, eclipseT: 0, eclipseDur: 0,
      eclipseBank: 0, eclipsesUsed: 0, tetrises: 0, bestCombo: 0,
    };
  }

  for (let i = 0; i < n; i++) {
    const pane = paneTpl.content.firstElementChild.cloneNode(true);
    panesEl.appendChild(pane);
    const opts = kind === 'coop'
      ? { boards: sharedBoards, renderers: sharedRenderers, team: sharedTeam, pair: i === 0 ? [0, 2] : [1, 3] }
      : {};
    const p = new Player(i, pane, opts);
    if (n === 2) {
      const names = kind === 'coop' ? COOP_NAMES : PLAYER_NAMES;
      p.tagEl.textContent = names[i];
      p.tagEl.style.color = PLAYER_COLORS[i];
      p.tagEl.style.textShadow = `0 0 14px ${PLAYER_COLORS[i]}`;
      p.tagEl.classList.remove('hidden');
      p.keymap = kind === 'coop' ? COOP_KEYS[i] : DUEL_KEYS[i];
    }
    players.push(p);
  }
  document.body.classList.toggle('duel', n === 2);
  paneKind = kind;
  requestAnimationFrame(() => players.forEach(p => p.stage.resize()));
}

/* ---------------- payout card ---------------- */
let payoutTimer = null;
function showPayout(name, lines, points) {
  clearTimeout(payoutTimer);
  $('payout-name').textContent = name;
  $('payout-lines').textContent = `${lines} COURSES SEALED AT ONCE`;
  $('payout-score').textContent = '';
  payoutEl.classList.remove('hidden', 'out');
  void payoutEl.offsetWidth;
  // staged reveal — never resolve a score in one number
  let shown = 0;
  const stepMs = 22, steps = 26;
  const inc = points / steps;
  let i = 0;
  const roll = () => {
    i++; shown = Math.min(points, Math.round(inc * i));
    $('payout-score').textContent = '+' + fmtScore(shown);
    if (i < steps) payoutTimer = setTimeout(roll, stepMs);
    else payoutTimer = setTimeout(() => {
      payoutEl.classList.add('out');
      payoutTimer = setTimeout(() => payoutEl.classList.add('hidden'), 500);
    }, 900);
  };
  payoutTimer = setTimeout(roll, 260);
}

/* ---------------- title UI ---------------- */
const modeCards = [...document.querySelectorAll('.mode-card')];

function renderKeeperStrip() {
  const { rank, next, progress } = P.rankOf(profile.lifetimeLines);
  $('rank-name').textContent = rank.name;
  $('rank-fill').style.width = `${progress * 100}%`;
  $('rank-next').textContent = next
    ? `${fmtScore(profile.lifetimeLines)} / ${fmtScore(next.at)} COURSES → ${next.name}`
    : `${fmtScore(profile.lifetimeLines)} COURSES LAID`;
  const fp = P.fragmentProgress(profile);
  $('frag-count').textContent = `RECORD ${fp.have} / ${fp.total}`;
}

function renderTitleLb() {
  const m = MODE_ORDER[menuIdx];
  if (m === 'duel') {
    lbTitleEl.textContent = 'HEAD TO HEAD';
    lbListEl.innerHTML = '<div class="lb-empty">NO LEDGER — ONLY A SURVIVOR</div>';
    return;
  }
  if (m === 'coop') {
    lbTitleEl.textContent = `THE TWIN VIGIL — ${DIFFICULTIES[difficultyIdx].name}`;
    const list = P.lbLoad(lbScopeFor(m)).slice(0, 6);
    lbListEl.innerHTML = list.length
      ? list.map((e, i) => lbRow(e, i)).join('')
      : '<div class="lb-empty">NO WATCH HAS BEEN KEPT</div>';
    return;
  }
  if (m === 'daily') {
    const k = P.todayKey();
    const best = profile.dailyBest[k];
    lbTitleEl.textContent = `THE SEAL — ${k}`;
    lbListEl.innerHTML = best
      ? `<li><span class="rk">✓</span><span class="nm">TODAY</span><span class="tm">${fmtScore(best.score)}</span><span class="ln">${best.lines} CS</span></li>`
      : '<div class="lb-empty">UNBROKEN. ONE ATTEMPT.</div>';
    return;
  }
  lbTitleEl.textContent = `ETCHED IN STONE — ${MODES[m].title} · ${DIFFICULTIES[difficultyIdx].name}`;
  const list = P.lbLoad(lbScopeFor(m)).slice(0, 6);
  lbListEl.innerHTML = list.length
    ? list.map((e, i) => lbRow(e, i)).join('')
    : '<div class="lb-empty">NO KEEPER HAS HELD THIS POST</div>';
}
function lbRow(e, i, cls = '') {
  return `<li class="${cls}"><span class="rk">${i + 1}</span><span class="nm">${e.name}</span>` +
    `<span class="tm">${fmtScore(e.score ?? 0)}</span><span class="ln">${e.lines} CS · ${fmtTime(e.ms)}</span></li>`;
}

function renderDailyBadge() {
  const badge = $('daily-badge');
  if (P.dailyDoneToday(profile)) { badge.textContent = 'SEALED'; badge.className = 'mode-badge done'; }
  else { badge.textContent = 'OPEN'; badge.className = 'mode-badge'; }
}

function renderDifficulty() {
  diffPills.forEach((el, i) => el.classList.toggle('sel', i === difficultyIdx));
  diffTaglineEl.textContent = DIFFICULTIES[difficultyIdx].tagline;
}
function setDifficulty(i) {
  difficultyIdx = ((i % DIFFICULTIES.length) + DIFFICULTIES.length) % DIFFICULTIES.length;
  saveDifficulty(difficultyIdx);
  audio.ensure(); audio.move();
  renderDifficulty();
  renderTitleLb();
}
diffPills.forEach((el, i) => el.addEventListener('click', () => setDifficulty(i)));

function renderMenu() {
  modeCards.forEach((el, i) => el.classList.toggle('sel', i === menuIdx));
  renderTitleLb();
  renderKeeperStrip();
  renderDailyBadge();
  renderDifficulty();
}
function menuMove(d) {
  menuIdx = (menuIdx + d + MODE_ORDER.length) % MODE_ORDER.length;
  audio.ensure(); audio.move();
  renderMenu();
}
modeCards.forEach((el, i) => {
  el.addEventListener('click', () => { menuIdx = i; renderMenu(); startRun(); });
  el.addEventListener('mouseenter', () => { if (state === 'title') { menuIdx = i; renderMenu(); } });
});

/* ---------------- codex ---------------- */
function openCodex() {
  state = 'codex';
  $('title-screen').classList.add('hidden');
  $('codex-screen').classList.remove('hidden');
  const fp = P.fragmentProgress(profile);
  $('codex-sub').textContent = `${fp.have} OF ${fp.total} RECOVERED`;
  renderCodexList();
  const first = FRAGMENTS.findIndex(f => profile.fragments.includes(f.id));
  codexIdx = first >= 0 ? first : 0;
  renderCodexRead();
}
function renderCodexList() {
  let html = '';
  for (const act of ACTS) {
    html += `<div class="codex-act">${act.id}. ${act.name}</div>`;
    FRAGMENTS.filter(f => f.act === act.id).forEach(f => {
      const i = FRAGMENTS.indexOf(f);
      const have = profile.fragments.includes(f.id);
      html += `<div class="codex-item ${have ? '' : 'locked'} ${i === codexIdx ? 'sel' : ''}" data-i="${i}">` +
        `${have ? f.title : '— — — — —'}</div>`;
    });
  }
  $('codex-list').innerHTML = html;
  $('codex-list').querySelectorAll('.codex-item:not(.locked)').forEach(el => {
    el.addEventListener('click', () => { codexIdx = +el.dataset.i; renderCodexList(); renderCodexRead(); });
  });
  const sel = $('codex-list').querySelector('.codex-item.sel');
  sel?.scrollIntoView({ block: 'nearest' });
}
function renderCodexRead() {
  const f = FRAGMENTS[codexIdx];
  const have = f && profile.fragments.includes(f.id);
  $('codex-read').innerHTML = have
    ? `<h3>${f.title}</h3><pre>${f.text}</pre>`
    : `<div class="codex-placeholder">This page is not yet yours.<br><br>Lay more courses.</div>`;
}
function codexMove(d) {
  const unlocked = FRAGMENTS.map((f, i) => profile.fragments.includes(f.id) ? i : -1).filter(i => i >= 0);
  if (!unlocked.length) return;
  const at = unlocked.indexOf(codexIdx);
  codexIdx = unlocked[(at + d + unlocked.length) % unlocked.length];
  audio.move();
  renderCodexList(); renderCodexRead();
}

/* ---------------- handling screen ---------------- */
function openHandling() {
  state = 'handling';
  $('title-screen').classList.add('hidden');
  $('handling-screen').classList.remove('hidden');
  renderHandling();
}
function renderHandling() {
  $('handling-list').innerHTML = HANDLING_DEF.map((d, i) => {
    const v = handling[d.key];
    const shown = d.unit === 'bool' ? (v ? 'ON' : 'OFF') : `${v}${d.unit === 'ms' ? ' ms' : d.unit === '%' ? '%' : ''}`;
    return `<div class="h-row ${i === handlingIdx ? 'sel' : ''}"><span class="h-name">${d.name}</span>` +
      `<span class="h-val">${shown}</span><span class="h-hint">${d.unit === 'ms' ? 'lower = faster' : ''}</span></div>`;
  }).join('');
}
function handlingAdjust(dir) {
  const d = HANDLING_DEF[handlingIdx];
  handling[d.key] = Math.max(d.min, Math.min(d.max, handling[d.key] + dir * d.step));
  saveHandling(); renderHandling(); audio.move();
  applyHandling();
}
function applyHandling() {
  players.forEach(p => {
    p.stage.atmos.uniforms.uGrain.value = 0.05 * (handling.grain / 100);
  });
}

/* ---------------- run flow ---------------- */
function startRun() {
  mode = MODE_ORDER[menuIdx];
  const m = MODES[mode];
  if (m.daily && P.dailyDoneToday(profile) && !confirmPractice()) return;
  audio.ensure();

  const kind = mode === 'coop' ? 'coop' : (m.players === 2 ? 'duel' : 'solo');
  ensurePanes(m.players, kind);

  const diff = DIFF();
  if (kind === 'coop') {
    // shared boards reset exactly once, regardless of pane reuse
    players[0].boards.forEach(b => b.reset());
    players.forEach(p => {
      p.keymap = COOP_KEYS[p.idx];
      p.eclipseMax = diff.eclipseMax;
      p.boards.forEach(b => b.configure({ maxLockResets: diff.lockResets, blunderRate: diff.blunderRate }));
      p.resetView();
      p.stage.idleMode = false;
      p.stage.spinDur = m.spinDur;
      p.pane.classList.remove('hud-off');
    });
  } else {
    const rng = m.daily ? P.makeRng(P.dailySeed()) : Math.random;
    players.forEach((p, i) => {
      p.keymap = m.players === 2 ? DUEL_KEYS[i] : SOLO_KEYS;
      p.reset(m.daily ? P.makeRng(P.dailySeed() + i * 7919) : null);
      p.eclipseMax = diff.eclipseMax;
      p.boards.forEach(b => b.configure({ maxLockResets: diff.lockResets, blunderRate: diff.blunderRate }));
      p.stage.idleMode = false;
      p.stage.spinDur = m.spinDur;
      p.pane.classList.remove('hud-off');
    });
  }
  applyHandling();

  elapsed = 0; gravityAcc = 0; level = 1; hitstop = 0;
  pendingResult = null;
  lastCountdownSec = null; reckoningRiserFired = false;
  runStats = { eclipses: 0, tetrises: 0, bestCombo: 0 };
  hintEl.innerHTML = HINTS[mode];
  document.body.classList.toggle('mode-reckoning', mode === 'reckoning');

  ['title-screen', 'gameover-screen', 'entry-screen', 'codex-screen', 'handling-screen'].forEach(id => $(id).classList.add('hidden'));
  hudGlobal.classList.remove('hidden');
  timerEl.innerHTML = '00:00<span class="tenths">.0</span>';

  state = 'countdown';
  let n = 3;
  const cd = $('countdown');
  cd.classList.remove('hidden');
  const tick = () => {
    if (state !== 'countdown') { cd.classList.add('hidden'); return; }
    if (n > 0) {
      cd.textContent = n;
      cd.classList.remove('tick'); void cd.offsetWidth; cd.classList.add('tick');
      audio.rotate();
      n--; setTimeout(tick, 800);
    } else {
      cd.classList.add('hidden');
      state = 'playing';
      lastTime = performance.now();
      audio.setTrack(mode === 'reckoning' ? 'reckoning' : 'main');
      audio.setIntensity(0);
      audio.startMusic();
    }
  };
  tick();
}
function confirmPractice() { return true; } // repeat attempts allowed, unscored

function toTitle() {
  state = 'title';
  audio.stopMusic();
  audio.setEclipse(false);
  document.body.classList.remove('mode-reckoning');
  ['gameover-screen', 'entry-screen', 'pause-screen', 'countdown', 'codex-screen', 'handling-screen'].forEach(id => $(id).classList.add('hidden'));
  eclOverlay.classList.add('hidden');
  payoutEl.classList.add('hidden');
  hudGlobal.classList.add('hidden');
  $('title-screen').classList.remove('hidden');
  ensurePanes(1, 'solo');
  players[0].boards.forEach(b => { b.controlled = false; b.reset(); b.controlled = false; });
  players[0].stage.idleMode = true;
  players[0].stage.setEclipse(false);
  players[0].stage.setDanger(0);
  players[0].pane.classList.add('hud-off');
  document.documentElement.style.setProperty('--accent', '#22d3ee');
  document.documentElement.style.setProperty('--accent-dim', '#22d3ee59');
  profile = P.load();
  renderMenu();
}

function togglePause() {
  if (state === 'playing') {
    state = 'paused';
    $('pause-screen').classList.remove('hidden');
    audio.stopMusic();
  } else if (state === 'paused') {
    state = 'playing';
    lastTime = performance.now();
    $('pause-screen').classList.add('hidden');
    audio.startMusic();
  }
}

/* ---------------- end of run ---------------- */
function endHeadline(result) {
  if (result.reason === 'time') {
    if (mode === 'reckoning') return { head: 'THE RECKONING IS PAID', cause: `THE COUNTDOWN REACHED ZERO — ${MODES[mode].title}` };
    return { head: 'THE SEAL HOLDS', cause: `THREE MINUTES SERVED — ${MODES[mode].title}` };
  }
  if (mode === 'coop') return { head: 'THE VIGIL ENDS', cause: `FACE ${FACES[result.deadFace].glyph} WAS OVERRUN — BOTH POSTS ARE VACANT` };
  return { head: 'THE POST IS VACANT', cause: `FACE ${FACES[result.deadFace].glyph} WAS OVERRUN — ${MODES[mode].title}` };
}

function endRun(loser, deadFace, reason = 'overrun') {
  if (state !== 'playing') return;
  state = 'dying';
  players.forEach(p => { if (p.eclipseOn) p.endEclipse(); });

  // Outlasting THE RECKONING's countdown is a triumph, not a death — it
  // gets the opposite audiovisual treatment from an overrun.
  const survived = reason === 'time' && mode === 'reckoning';
  if (survived) {
    audio.reckoningComplete();
    players.forEach(p => { p.stage.kick(0.55); p.stage.impact(0.6); p.stage.shockwave('#ffffff', 1.1, null, false); });
    hitstop = 0.22;
  } else {
    audio.gameOver();
    players.forEach(p => { p.stage.kick(TRAUMA.death); p.stage.impact(0.7); });
    hitstop = HITSTOP.death;
    whisper('gameOver', true);
  }

  if (MODES[mode].players === 2) {
    if (MODES[mode].competitive) {
      const winner = players[1 - loser.idx];
      setTimeout(() => {
        buildDuelGameover(winner, loser, deadFace);
        $('gameover-screen').classList.remove('hidden');
        audio.fanfare();
        state = 'gameover';
      }, 1000);
      return;
    }
    // TWIN VIGIL (non-competitive): shared fate, falls through to the same
    // ranked/solo pipeline below — players[0].score/totalLines already read
    // the shared team values, so it "just works".
  }

  const p = players[0];
  const result = {
    ms: elapsed, lines: p.totalLines, score: p.score, level, deadFace, reason,
    eclipses: p.eclipsesUsed, tetrises: p.tetrises, bestCombo: p.bestCombo,
  };

  if (mode === 'coop') profile.coopRuns = (profile.coopRuns || 0) + 1;

  // Every run pays: bank it immediately, before any UI.
  const { unlocked, rankUp } = P.commitRun(profile, result);
  if (MODES[mode].daily) P.markDailyDone(profile, result);

  setTimeout(() => {
    if (MODES[mode].ranked && P.lbQualifies(lbScopeFor(mode), result.score)) {
      pendingResult = { result, unlocked, rankUp };
      $('entry-sub').textContent = `${MODES[mode].title} — ${fmtScore(result.score)} · ${result.lines} COURSES · ${fmtTime(result.ms)}`;
      nameInput.value = profile.name || '';
      $('entry-screen').classList.remove('hidden');
      nameInput.focus();
      state = 'entry';
    } else {
      buildSoloGameover(result, null, unlocked, rankUp);
      $('gameover-screen').classList.remove('hidden');
      state = 'gameover';
    }
  }, 1000);
}

function submitEntry(skip = false) {
  if (state !== 'entry' || !pendingResult) return;
  const raw = skip ? '' : nameInput.value.trim().toUpperCase().replace(/[^A-Z0-9 \-_.!?]/g, '');
  const name = raw || 'KEEPER';
  if (!skip) { profile.name = name; P.save(profile); }
  const { result, unlocked, rankUp } = pendingResult;
  const entry = { name, ms: Math.floor(result.ms), lines: result.lines, score: result.score, date: Date.now() };
  const rank = P.lbInsert(lbScopeFor(mode), entry);
  $('entry-screen').classList.add('hidden');
  buildSoloGameover(result, rank, unlocked, rankUp);
  $('gameover-screen').classList.remove('hidden');
  pendingResult = null;
  state = 'gameover';
  audio.lineClear(2);
}

function buildSoloGameover(result, rank, unlocked = [], rankUp = null) {
  const p = players[0];
  const list = MODES[mode].ranked ? P.lbLoad(lbScopeFor(mode)) : [];
  const lbHtml = list.length
    ? `<ol class="go-lb" style="margin-top:24px">${list.map((e, i) =>
        lbRow(e, i, (i === rank ? 'you' : '') + (i === 0 ? ' top' : ''))).join('')}</ol>` : '';
  const frag = unlocked[0];
  const fragHtml = frag
    ? `<div class="go-frag"><div class="fh">A PAGE RECOVERED — ${frag.title}</div><div class="ft">${frag.text}</div></div>`
    : '';
  const more = unlocked.length > 1 ? `<div class="best" style="margin-top:12px">+${unlocked.length - 1} MORE IN THE RECORD (C)</div>` : '';
  const { head, cause } = endHeadline(result);

  $('go-content').innerHTML = `
    <div class="go-head">${head}</div>
    <div class="go-cause">${cause}</div>
    <div class="go-stats">
      <div class="go-stat"><div class="hud-label">SCORE</div><div class="go-num">${fmtScore(result.score)}</div></div>
      <div class="go-stat"><div class="hud-label">COURSES</div><div class="go-num">${result.lines}</div></div>
      <div class="go-stat"><div class="hud-label">AT THE POST</div><div class="go-num">${fmtTime(result.ms)}</div></div>
    </div>
    <div class="go-faces">${p.boards.map((b, i) =>
      `<div class="go-face" style="color:${FACES[i].accent}"><span class="glyph">${FACES[i].glyph}</span>${b.lines}</div>`).join('')}</div>
    ${rankUp ? `<div class="rankup">YOU ARE NOW ${rankUp}</div>` : ''}
    ${rank !== null && rank >= 0 ? `<div class="best" style="margin-top:18px">★ RANK ${rank + 1} — CUT INTO THE STONE ★</div>` : ''}
    ${fragHtml}${more}${lbHtml}
    <div class="press"><b>ENTER</b> TAKE THE POST AGAIN &middot; <b>ESC</b> LEAVE</div>`;
}

function buildDuelGameover(winner, loser, deadFace) {
  const wc = PLAYER_COLORS[winner.idx];
  $('go-content').innerHTML = `
    <div class="go-head" style="color:${wc};text-shadow:0 0 30px ${wc}">${PLAYER_NAMES[winner.idx]} STANDS</div>
    <div class="go-cause">${PLAYER_NAMES[loser.idx]}'S FACE ${FACES[deadFace].glyph} WAS OVERRUN</div>
    <div class="go-stats">
      <div class="go-stat"><div class="hud-label">DURATION</div><div class="go-num">${fmtTime(elapsed)}</div></div>
      <div class="go-stat"><div class="hud-label">${PLAYER_NAMES[0]}</div><div class="go-num" style="color:${PLAYER_COLORS[0]}">${fmtScore(players[0].score)}</div></div>
      <div class="go-stat"><div class="hud-label">${PLAYER_NAMES[1]}</div><div class="go-num" style="color:${PLAYER_COLORS[1]}">${fmtScore(players[1].score)}</div></div>
    </div>
    <div class="press"><b>ENTER</b> AGAIN &middot; <b>ESC</b> LEAVE</div>`;
}

/* ---------------- actions ---------------- */
function canAct(p) {
  return state === 'playing' && p.alive && !p.stage.spinning && p.board.piece && !p.board.clearing;
}
function doMove(p, dx) { if (canAct(p) && p.board.tryMove(dx, 0)) audio.move(); }
function doRotate(p, dir) { if (canAct(p) && p.board.tryRotate(dir)) audio.rotate(); }
function doHold(p) { if (canAct(p) && p.board.holdPiece()) audio.rotate(); }
function doHard(p) {
  if (!canAct(p)) return;
  const r = p.board.hardDrop();
  p.addScore(scoreDrop(r.dist, true));
  audio.hardDrop(r.dist);
  p.stage.kick(TRAUMA.lock);
  hitstop = Math.max(hitstop, HITSTOP.lock);
  afterLock(p, r);
}
function doSpin(p, dir) {
  const free = mode === 'sovereign' || p.eclipseOn;
  if (!free || state !== 'playing' || !p.alive || p.stage.spinning) return;
  p.spinTo((p.currentFace + dir + 4) % 4);
}
function doEclipse(p) {
  if (state !== 'playing') return;
  if (p.eclipseOn) return;
  p.startEclipse();
}

// Shared consequences of a lock-down, whatever caused it.
function afterLock(p, r) {
  if (!r || !r.locked) return;
  if (r.toppedOut) { endRun(p, p.board.face); return; }
  const b = p.board;
  if (r.cleared === 0) {
    audio.lockPiece(b.stackHeight() / ROWS);
    p.showCombo(-1);
    if (r.tspin) {
      const s = scoreClear({ lines: 0, tspin: r.tspin, b2b: false, combo: -1, level, perfect: false });
      p.addScore(s.points);
      p.popup(s.label, s.points);
      p.stage.kick(TRAUMA.tspin * 0.5);
    }
  }
}

/* ---------------- input ---------------- */
function actionOf(p, code) {
  for (const [act, codes] of Object.entries(p.keymap)) if (codes.includes(code)) return act;
  return null;
}

window.addEventListener('keydown', e => {
  if (e.target === nameInput) {
    if (e.key === 'Enter') submitEntry();
    else if (e.key === 'Escape') submitEntry(true);
    return;
  }
  if (['ArrowLeft', 'ArrowRight', 'ArrowDown', 'ArrowUp', 'Space'].includes(e.code)) e.preventDefault();
  if (e.repeat) return;
  audio.ensure();

  switch (e.key) {
    case 'Enter':
      if (state === 'title') { audio.rotate(); startRun(); }
      else if (state === 'gameover') startRun();
      return;
    case 'Escape':
      if (state === 'paused' || state === 'gameover' || state === 'codex' || state === 'handling') toTitle();
      return;
    case 'p': case 'P': if (state === 'playing' || state === 'paused') togglePause(); return;
    case 'm': case 'M': audio.toggleMute(); return;
    case 'F3': e.preventDefault(); fpsEl.classList.toggle('hidden'); return;
    case 'F11': {
      e.preventDefault();
      const win = window.__TAURI__?.window?.getCurrentWindow?.();
      if (win) win.isFullscreen().then(f => win.setFullscreen(!f));
      else if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
      else document.exitFullscreen?.();
      return;
    }
  }

  if (state === 'title') {
    if (['ArrowLeft', 'KeyA', 'ArrowUp'].includes(e.code)) menuMove(-1);
    else if (['ArrowRight', 'KeyD', 'ArrowDown'].includes(e.code)) menuMove(1);
    else if (e.code === 'BracketLeft') setDifficulty(difficultyIdx - 1);
    else if (e.code === 'BracketRight') setDifficulty(difficultyIdx + 1);
    else if (e.code === 'KeyC') openCodex();
    else if (e.code === 'KeyH') openHandling();
    return;
  }
  if (state === 'codex') {
    if (['ArrowUp', 'KeyW'].includes(e.code)) codexMove(-1);
    else if (['ArrowDown', 'KeyS'].includes(e.code)) codexMove(1);
    return;
  }
  if (state === 'handling') {
    if (['ArrowUp', 'KeyW'].includes(e.code)) { handlingIdx = (handlingIdx - 1 + HANDLING_DEF.length) % HANDLING_DEF.length; renderHandling(); audio.move(); }
    else if (['ArrowDown', 'KeyS'].includes(e.code)) { handlingIdx = (handlingIdx + 1) % HANDLING_DEF.length; renderHandling(); audio.move(); }
    else if (['ArrowLeft'].includes(e.code)) handlingAdjust(-1);
    else if (['ArrowRight'].includes(e.code)) handlingAdjust(1);
    return;
  }

  for (const p of players) {
    const act = actionOf(p, e.code);
    if (!act) continue;
    switch (act) {
      case 'moveL': p.kb.left = true; break;
      case 'moveR': p.kb.right = true; break;
      case 'soft': p.kb.soft = true; break;
      case 'rotCW': doRotate(p, 1); break;
      case 'rotCCW': doRotate(p, -1); break;
      case 'hard': doHard(p); break;
      case 'hold': doHold(p); break;
      case 'eclipse': doEclipse(p); break;
      case 'spinL': doSpin(p, -1); break;
      case 'spinR': doSpin(p, 1); break;
    }
  }
});

window.addEventListener('keyup', e => {
  for (const p of players) {
    const act = actionOf(p, e.code);
    if (act === 'moveL') p.kb.left = false;
    else if (act === 'moveR') p.kb.right = false;
    else if (act === 'soft') p.kb.soft = false;
  }
});

window.addEventListener('blur', () => {
  players.forEach(p => { p.kb = {}; });
  if (state === 'playing') togglePause();
});

function pollPads() {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  players.forEach(p => { p.padHeld = {}; });
  for (let i = 0; i < pads.length; i++) {
    const gp = pads[i];
    if (!gp) continue;
    const prev = padPrev[gp.index] || [];
    const btn = j => !!gp.buttons[j]?.pressed;
    const edge = j => btn(j) && !prev[j];
    const ax = gp.axes[0] || 0, ay = gp.axes[1] || 0;

    if (state === 'playing' || state === 'paused') {
      const p = players[MODES[mode].players === 2 ? Math.min(gp.index, 1) : 0];
      if (p && p.alive) {
        p.padHeld.left = p.padHeld.left || btn(14) || ax < -0.45;
        p.padHeld.right = p.padHeld.right || btn(15) || ax > 0.45;
        p.padHeld.soft = p.padHeld.soft || btn(13) || ay > 0.5;
        if (edge(0) || edge(12)) doRotate(p, 1);
        if (edge(1)) doRotate(p, -1);
        if (edge(2)) doHold(p);
        if (edge(3)) doHard(p);
        if (edge(6) || edge(7)) doEclipse(p);
        if (edge(4)) doSpin(p, -1);
        if (edge(5)) doSpin(p, 1);
      }
      if (edge(9)) togglePause();
    } else if (state === 'title') {
      if (edge(14) || edge(12)) menuMove(-1);
      if (edge(15) || edge(13)) menuMove(1);
      if (edge(0) || edge(9)) startRun();
      if (edge(3)) openCodex();
    } else if (state === 'gameover') {
      if (edge(0) || edge(9)) startRun();
      if (edge(1)) toTitle();
    } else if (state === 'entry') {
      if (edge(0)) submitEntry();
      if (edge(1)) submitEntry(true);
    } else if (state === 'codex' || state === 'handling') {
      if (edge(12)) state === 'codex' ? codexMove(-1) : null;
      if (edge(13)) state === 'codex' ? codexMove(1) : null;
      if (edge(1)) toTitle();
    }
    padPrev[gp.index] = gp.buttons.map(b => b.pressed);
  }
}

/* ---------------- per-frame ---------------- */
function processHeld(p, dtMs) {
  for (const [dir, dx] of [['left', -1], ['right', 1]]) {
    const down = p.kb[dir] || p.padHeld[dir];
    const h = p.hold[dir];
    if (down && !h.down) { h.down = true; h.t = 0; doMove(p, dx); }
    else if (down) {
      h.t += dtMs;
      if (h.t >= handling.das) {
        const rate = Math.max(1, handling.arr);
        h.rep += dtMs;
        while (h.rep >= rate) { h.rep -= rate; doMove(p, dx); }
      }
    } else { h.down = false; h.rep = 0; }
  }
  const soft = p.kb.soft || p.padHeld.soft;
  const s = p.hold.soft;
  if (soft) {
    const rate = Math.max(1, handling.sdf);
    if (!s.down) { s.down = true; s.acc = rate; }
    s.acc += dtMs;
    while (s.acc >= rate) {
      s.acc -= rate;
      if (canAct(p) && p.board.tryMove(0, 1)) { audio.softDrop(); p.addScore(scoreDrop(1, false)); }
    }
  } else s.down = false;
}

// TWIN VIGIL shares its 4 boards between two Players; without deduping,
// a shared board would be stepped/ticked twice per frame (once per Player
// iterating the same array) — silently doubling its gravity/lock speed.
// Solo/duel never share boards, so this Set is a no-op there.
function stepGravity(dtMs) {
  const g = gravityMs();
  while (gravityAcc >= g) {
    gravityAcc -= g;
    const seen = new Set();
    for (const p of players) {
      if (!p.alive) continue;
      if (p.eclipseOn) continue;         // time is stopped for this Keeper
      for (const b of p.boards) {
        if (seen.has(b)) continue;
        seen.add(b);
        b.step();
        if (b.toppedOut) { endRun(p, b.face); return; }
      }
    }
  }
}

function tickLocks(dtMs) {
  const seen = new Set();
  for (const p of players) {
    if (!p.alive) continue;
    for (const b of p.boards) {
      if (seen.has(b)) continue;
      seen.add(b);
      // during ECLIPSE the controlled board never auto-locks: the Keeper
      // places at their own pace. Unattended faces are frozen too.
      if (p.eclipseOn) continue;
      const r = b.tickLock(dtMs);
      if (r) {
        if (b === p.board) afterLock(p, r);
        else if (r.toppedOut) { endRun(p, b.face); return; }
        if (b.toppedOut) { endRun(p, b.face); return; }
      }
    }
  }
}

function resolveClears(now) {
  for (const p of players) {
    for (const b of p.boards) {
      if (!b.clearing || now - b.clearing.t0 < CLEAR_FLASH_MS) continue;
      const { rows, wasControlled, tspin, b2b, combo } = b.clearing;
      const n = rows.length;
      const rows01 = rows.map(y => y / (ROWS - 1));
      b.finishClear();
      const perfect = b.isEmpty();

      p.totalLines += n;
      p.totalLinesEl.textContent = p.totalLines;
      pop(p.totalLinesEl);
      if (b.face === p.currentFace) { p.faceLinesEl.textContent = b.lines; }

      if (!wasControlled) continue;   // autopilot clears are silent

      if (p.eclipseOn) {
        // banked: no score yet, no spin — it all resolves at once later
        p.eclipseBank += n;
        p.stage.burst(rows01[0], '#cfefff', 40 + n * 20);
        p.stage.kick(0.08);
        audio.lineClear(Math.min(2, n), 0);
        continue;
      }

      const s = scoreClear({ lines: n, tspin, b2b, combo, level, perfect });
      p.addScore(s.points);
      p.popup(s.label, s.points);
      p.showCombo(combo);
      p.addCharge(n);
      if (n >= 4) { p.tetrises++; whisper('tetris'); }
      else if (combo >= 2) whisper('combo');
      else if (p.totalLines === n) whisper('firstClear');

      // one shared intensity language
      const tier = Math.min(4, n);
      hitstop = Math.max(hitstop, perfect ? HITSTOP.perfect : tspin ? HITSTOP.tspin : HITSTOP[tier]);
      p.stage.kick(perfect ? TRAUMA.perfect : tspin ? TRAUMA.tspin : TRAUMA[tier]);
      p.stage.impact(0.12 + n * 0.09 + (perfect ? 0.5 : 0));
      rows01.forEach(r => p.stage.burst(r, FACES[b.face].accent, 90 + n * 45));
      p.stage.shockwave(FACES[b.face].accent, 0.3 + n * 0.22, p.stage.group.position.y + (0.5 - rows01[0]) * 3.2, true);
      if (n >= 4 || perfect) p.stage.shockwave('#ffffff', 0.6 + n * 0.1, null, false);
      audio.lineClear(n, combo);
      if (combo >= 1) audio.combo(combo + 1);

      if (mode === 'rite' || mode === 'daily' || mode === 'reckoning') {
        p.spinTo(p.randomOther());
      } else if (mode === 'duel') {
        const foe = players[1 - p.idx];
        if (foe?.alive) foe.spinTo(foe.randomOther());
      } else if (mode === 'coop') {
        p.spinTo(p.pair.find(f => f !== p.currentFace));
      }
      // sovereign: the turns are the player's own, no forced spin
    }
  }
}

function titleDemo(now, dtMs) {
  titleDemoAcc += dtMs;
  const p = players[0];
  while (titleDemoAcc >= 620) {
    titleDemoAcc -= 620;
    for (const b of p.boards) {
      b.controlled = false;
      b.step();
      if (b.landed) b.lock();
      if (b.toppedOut) { b.reset(); b.controlled = false; }
    }
  }
  for (const b of p.boards) if (b.clearing && now - b.clearing.t0 >= CLEAR_FLASH_MS) b.finishClear();
}

/* ---------------- main loop ---------------- */
function frame(now) {
  requestAnimationFrame(frame);
  let dtMs = Math.min(100, now - lastTime);
  lastTime = now;
  const dtReal = dtMs / 1000;

  pollPads();

  // Hitstop freezes the simulation but never input collection or rendering.
  let simMs = dtMs;
  if (hitstop > 0) { hitstop = Math.max(0, hitstop - dtReal); simMs = 0; }
  const dtSim = simMs / 1000;

  const pulse = audio.beatPulse; // musical pulse drives bloom + aberration + clock ping

  if (state === 'playing') {
    elapsed += simMs;
    const durationMs = MODES[mode].durationMs;
    if (durationMs != null && elapsed >= durationMs && !players[0].eclipseOn) {
      endRun(players[0], players[0].currentFace, 'time');
    }
    const newLevel = 1 + Math.floor(elapsed / DIFF().levelEvery);
    if (newLevel !== level) {
      level = newLevel;
      players.forEach(p => { p.levelEl.textContent = level; pop(p.levelEl); });
      audio.levelUp();
      whisper('levelUp');
      if (level === 5) whisper('longRun', true);
    }
    // continuous intensity: level-driven normally, countdown-driven in THE RECKONING
    if (mode === 'reckoning' && durationMs) {
      const frac = Math.max(0, Math.min(1, elapsed / durationMs));
      audio.setIntensity(Math.pow(frac, 1.7));
      const remainMs = durationMs - elapsed;
      if (!reckoningRiserFired && remainMs <= 12000 && remainMs > 10500) {
        reckoningRiserFired = true;
        audio.reckoningRiser(11);
      }
      const remainSec = Math.ceil(Math.max(0, remainMs) / 1000);
      if (remainMs <= 10500 && remainMs > 0 && remainSec !== lastCountdownSec) {
        lastCountdownSec = remainSec;
        audio.countdownBeep(remainSec);
      }
    } else {
      audio.setIntensity((level - 1) / 8);
    }
    if (simMs > 0) {
      gravityAcc += simMs;
      stepGravity(simMs);
    }
    if (state === 'playing' && simMs > 0) {
      players.forEach(p => processHeld(p, simMs));
      tickLocks(simMs);
    }
    if (state === 'playing') {
      const tickedTeams = new Set();
      players.forEach(p => { if (!tickedTeams.has(p.team)) { tickedTeams.add(p.team); p.tickEclipse(dtSim); } });
      resolveClears(now);
      players.forEach(p => {
        if (now - p.lastMonDraw > 33) { p.lastMonDraw = now; p.drawMonitors(now); }
      });
      if (mode === 'reckoning' && durationMs) {
        reckoningClock.draw({ remainMs: durationMs - elapsed, durationMs, beatPulse: pulse });
      } else {
        const remain = durationMs != null ? Math.max(0, durationMs - elapsed) : elapsed;
        const t = fmtTime(remain);
        timerEl.innerHTML = `${t.slice(0, 5)}<span class="tenths">${t.slice(5)}</span>`;
      }
    }
  } else if (state === 'title' && players.length) {
    titleDemo(now, dtMs);
  }

  const frac = state === 'playing' ? Math.min(1, gravityAcc / gravityMs()) : 0;
  for (const p of players) {
    p.stage.setPulse(pulse * (handling.shake / 100));
    const vis = p.stage.visibleFaces();
    const extra = { eclipse: p.eclipseOn, score: p.score };
    p.boards.forEach((b, i) => {
      if (vis.has(i)) {
        p.renderers[i].draw(now, frac, dtReal, extra);
        p.stage.markFaceDirty(i);
      } else if (now - p.hiddenDrawAt[i] > 50) {
        p.hiddenDrawAt[i] = now;
        p.renderers[i].draw(now, frac, dtReal, extra);
      }
    });
    p.stage.update(dtReal, now);
  }

  fpsAcc += dtMs; fpsFrames++;
  if (fpsAcc >= 500) {
    const fps = Math.round(1000 * fpsFrames / fpsAcc);
    fpsNumEl.textContent = fps;
    fpsEl.classList.toggle('good', fps >= 110);
    fpsEl.classList.toggle('mid', fps >= 58 && fps < 110);
    fpsEl.classList.toggle('bad', fps < 58);
    fpsAcc = 0; fpsFrames = 0;
  }
}

/* ---------------- boot ---------------- */
ensurePanes(1, 'solo');
players[0].stage.idleMode = true;
players[0].boards.forEach(b => { b.controlled = false; });
players[0].pane.classList.add('hud-off');
renderMenu();
requestAnimationFrame(frame);

/* ---------------- debug ---------------- */
window.QDBG = {
  state: () => state,
  mode: () => mode,
  players: () => players,
  profile: () => profile,
  difficulty: () => DIFFICULTIES[difficultyIdx].id,
  setDifficulty,
  get boards() { return players[0]?.boards; },
  get stage() { return players[0]?.stage; },
  face: (pi = 0) => players[pi]?.currentFace,
  start: m => { if (m) menuIdx = MODE_ORDER.indexOf(m); startRun(); },
  skipCountdown: () => { state = 'playing'; $('countdown').classList.add('hidden'); lastTime = performance.now(); },
  clear: (pi = 0, n = 1) => { const p = players[pi]; p.boards[p.currentFace].debugFillBottom(n); },
  resolve: () => resolveClears(performance.now() + 10_000),
  stepAll: (n = 1) => { for (let i = 0; i < n; i++) players.forEach(p => p.boards.forEach(b => { b.step(); if (b.landed) b.lock(); })); },
  charge: (n = 12, pi = 0) => players[pi].addCharge(n),
  eclipse: (pi = 0) => players[pi].startEclipse(),
  endEclipse: (pi = 0) => players[pi].endEclipse(),
  kill: (pi = 0, f = 0) => { players[pi].boards[f].toppedOut = true; },
  setElapsed: ms => { elapsed = ms; },
  tick: (dt = 0.016) => {
    const now = performance.now();
    for (const p of players) {
      p.boards.forEach((b, i) => { p.renderers[i].draw(now, 0, dt, { eclipse: p.eclipseOn, score: p.score }); p.stage.markFaceDirty(i); });
      p.stage.update(dt, now);
    }
  },
  snap: (w = 900, q = 0.8, pi = 0) => {
    const gl = players[pi].canvas;
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = Math.round(w * gl.height / gl.width);
    cv.getContext('2d').drawImage(gl, 0, 0, cv.width, cv.height);
    return cv.toDataURL('image/jpeg', q);
  },
  send: (name, w = 900) => fetch('http://localhost:4621/?name=' + name, { method: 'POST', body: window.QDBG.snap(w) }).then(r => r.text()),
};
