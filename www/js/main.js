// OBELISK — orchestrator: modes (RITE / SOVEREIGN / DUEL), players with their
// own obelisk stages, unified keyboard+gamepad input, leaderboards.
import { Board } from './tetris.js';
import { FaceRenderer } from './render2d.js';
import { Stage } from './scene3d.js';
import { audio } from './audio.js';

const FACES = [
  { glyph: 'I',   accent: '#22d3ee' },
  { glyph: 'II',  accent: '#e879f9' },
  { glyph: 'III', accent: '#fbbf24' },
  { glyph: 'IV',  accent: '#34d399' },
];

const CLEAR_FLASH_MS = 320;
const BASE_GRAVITY = 820;   // ms per row at velocity 1
const LEVEL_EVERY = 30_000; // ms per velocity step
const DAS_DELAY = 150, DAS_RATE = 42, SOFT_RATE = 45;

const MODES = {
  rite:      { title: 'RITE',      players: 1, spinDur: 0.72 },
  sovereign: { title: 'SOVEREIGN', players: 1, spinDur: 0.46 },
  duel:      { title: 'DUEL',      players: 2, spinDur: 0.62 },
};
const MODE_ORDER = ['rite', 'sovereign', 'duel'];

// keyboard maps by e.code
const SOLO_KEYS = {
  moveL: ['ArrowLeft', 'KeyA'], moveR: ['ArrowRight', 'KeyD'], soft: ['ArrowDown', 'KeyS'],
  rotCW: ['ArrowUp', 'KeyX', 'KeyW'], rotCCW: ['KeyZ'], hard: ['Space'],
  spinL: ['KeyQ'], spinR: ['KeyE'],
};
const DUEL_KEYS = [
  { moveL: ['KeyA'], moveR: ['KeyD'], soft: ['KeyS'], rotCW: ['KeyW'], rotCCW: ['KeyQ'], hard: ['Space'], spinL: [], spinR: [] },
  { moveL: ['ArrowLeft'], moveR: ['ArrowRight'], soft: ['ArrowDown'], rotCW: ['ArrowUp'], rotCCW: ['Slash'], hard: ['ShiftRight'], spinL: [], spinR: [] },
];

const HINTS = {
  rite: '<span><b>←→</b> move</span><span><b>↑</b>/<b>X</b> rotate</span><span><b>Z</b> ccw</span><span><b>↓</b> soft</span><span><b>SPACE</b> hard drop</span><span><b>P</b> pause</span><span><b>M</b> mute</span><span><b>F11</b> fullscreen</span><span>🎮 <b>✚</b> move · <b>A/B</b> rotate · <b>X</b> drop</span>',
  sovereign: '<span><b>Q</b>/<b>E</b> TURN THE OBELISK</span><span><b>←→</b> move</span><span><b>↑</b> rotate</span><span><b>Z</b> ccw</span><span><b>↓</b> soft</span><span><b>SPACE</b> hard</span><span><b>P</b> pause</span><span>🎮 <b>LB/RB</b> turn</span>',
  duel: '<span>P1 <b>A/D/S</b> move · <b>W</b> rot · <b>Q</b> ccw · <b>SPACE</b> drop</span><span>P2 <b>←↓→</b> move · <b>↑</b> rot · <b>/</b> ccw · <b>R-SHIFT</b> drop</span><span>🎮 pad 1 → P1 · pad 2 → P2</span>',
};

const PLAYER_NAMES = ['PLAYER ONE', 'PLAYER TWO'];
const PLAYER_COLORS = ['#7ceeff', '#ff9ab8'];

/* ---------------- dom ---------------- */
const $ = id => document.getElementById(id);
const panesEl = $('panes'), paneTpl = $('pane-tpl');
const timerEl = $('timer'), hudGlobal = $('hud-global'), hintEl = $('controls-hint');
const lbListEl = $('lb-list'), lbTitleEl = $('lb-title');
const nameInput = $('name-input');

/* ---------------- state ---------------- */
let state = 'title'; // title | countdown | playing | paused | dying | entry | gameover
let mode = 'rite';
let menuIdx = 0;
let players = [];
let elapsed = 0, gravityAcc = 0, level = 1;
let lastTime = performance.now();
let titleDemoAcc = 0;
let pendingResult = null; // solo result awaiting name entry
let padPrev = {};
let fpsAcc = 0, fpsFrames = 0;
const fpsEl = $('fps-meter'), fpsNumEl = $('fps-num');

function gravityMs() { return Math.max(95, BASE_GRAVITY * Math.pow(0.86, level - 1)); }
function fmtTime(ms) {
  const t = Math.max(0, ms);
  const m = String(Math.floor(t / 60000)).padStart(2, '0');
  const s = String(Math.floor((t % 60000) / 1000)).padStart(2, '0');
  const d = Math.floor((t % 1000) / 100);
  return `${m}:${s}.${d}`;
}
function pop(el) { el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop'); }

/* ---------------- player ---------------- */
class Player {
  constructor(idx, pane) {
    this.idx = idx;
    this.pane = pane;
    const q = sel => pane.querySelector(sel);
    this.canvas = q('.gl');
    this.tagEl = q('.player-tag');
    this.glyphEl = q('.face-glyph');
    this.faceLinesEl = q('.face-lines');
    this.totalLinesEl = q('.total-lines');
    this.levelEl = q('.level');
    this.vignetteEl = q('.danger-vignette');
    this.flashEl = q('.spin-flash');
    this.monitors = [...pane.querySelectorAll('.monitor')];
    this.monCvs = this.monitors.map(m => m.querySelector('.mon-cv').getContext('2d'));
    this.monTags = this.monitors.map(m => m.querySelector('.mon-tag'));

    this.boards = FACES.map((_, i) => new Board(i));
    this.renderers = this.boards.map((b, i) => new FaceRenderer(b, FACES[i]));
    this.stage = new Stage(this.canvas, this.renderers.map(r => r.canvas), FACES);

    this.keymap = SOLO_KEYS;
    this.kb = {};        // held keyboard flags by action
    this.padHeld = {};   // held pad flags by action
    this.hold = { left: { down: false, t: 0 }, right: { down: false, t: 0 }, soft: { down: false, acc: 0 } };
    this.currentFace = 0;
    this.totalLines = 0;
    this.alive = true;
    this.lastWarnPing = 0;
    this.hiddenDrawAt = [0, 0, 0, 0]; // last 2D redraw of each off-camera face
    this.lastMonDraw = 0;
  }

  reset() {
    this.boards.forEach(b => b.reset());
    this.currentFace = 0;
    this.boards[0].controlled = true;
    this.totalLines = 0;
    this.alive = true;
    this.kb = {}; this.padHeld = {};
    this.hold = { left: { down: false, t: 0 }, right: { down: false, t: 0 }, soft: { down: false, acc: 0 } };
    this.stage.rotY = 0; this.stage.spinT = 1;
    this.faceLinesEl.textContent = '0';
    this.totalLinesEl.textContent = '0';
    this.levelEl.textContent = '1';
    this.setAccent(0);
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
    const options = [0, 1, 2, 3].filter(i => i !== this.currentFace);
    return options[(Math.random() * options.length) | 0];
  }

  spinTo(face) {
    this.flashEl.classList.remove('go'); void this.flashEl.offsetWidth; this.flashEl.classList.add('go');
    audio.spin();
    this.stage.spinToFace(face);
    this.stage.kick(0.55);
    this.switchControl(face);
  }

  drawMonitors(now) {
    const others = [0, 1, 2, 3].filter(i => i !== this.currentFace);
    let anyDanger = false;
    others.forEach((fi, mi) => {
      const b = this.boards[fi];
      const c = this.monCvs[mi];
      const src = this.renderers[fi].canvas;
      c.clearRect(0, 0, 90, 176);
      c.drawImage(src, 0, 0, src.width, src.height, 0, 0, 90, 176);
      this.monTags[mi].textContent = FACES[fi].glyph;
      this.monTags[mi].style.color = FACES[fi].accent;
      const danger = b.stackHeight() >= 15;
      this.monitors[mi].classList.toggle('warning', danger);
      if (danger) anyDanger = true;
    });
    const selfDanger = this.board.stackHeight() >= 15;
    this.vignetteEl.classList.toggle('on', anyDanger || selfDanger);
    if (anyDanger && now - this.lastWarnPing > 2500) { this.lastWarnPing = now; audio.warning(); }
  }

  dispose() {
    this.stage.dispose();
    this.pane.remove();
  }
}

/* ---------------- pane management ---------------- */
function ensurePanes(n) {
  if (players.length === n) return;
  players.forEach(p => p.dispose());
  players = [];
  panesEl.innerHTML = '';
  for (let i = 0; i < n; i++) {
    const pane = paneTpl.content.firstElementChild.cloneNode(true);
    panesEl.appendChild(pane);
    const p = new Player(i, pane);
    if (n === 2) {
      p.tagEl.textContent = PLAYER_NAMES[i];
      p.tagEl.style.color = PLAYER_COLORS[i];
      p.tagEl.style.textShadow = `0 0 14px ${PLAYER_COLORS[i]}`;
      p.tagEl.classList.remove('hidden');
      p.keymap = DUEL_KEYS[i];
    }
    players.push(p);
  }
  document.body.classList.toggle('duel', n === 2);
  // panes changed size — let layout settle, then size renderers
  requestAnimationFrame(() => players.forEach(p => p.stage.resize()));
}

/* ---------------- leaderboards ---------------- */
const LB_MAX = 10;
function lbLoad(m) {
  try { return JSON.parse(localStorage.getItem('obelisk_lb_' + m) || '[]'); } catch { return []; }
}
function lbSave(m, list) { localStorage.setItem('obelisk_lb_' + m, JSON.stringify(list)); }
function lbQualifies(m, ms) {
  const list = lbLoad(m);
  return list.length < LB_MAX || ms > list[list.length - 1].ms;
}
function lbInsert(m, entry) {
  const list = lbLoad(m);
  list.push(entry);
  list.sort((a, b) => b.ms - a.ms);
  const trimmed = list.slice(0, LB_MAX);
  lbSave(m, trimmed);
  return trimmed.indexOf(entry); // -1 if fell off (shouldn't when qualified)
}
function lbRow(e, i, cls = '') {
  return `<li class="${cls}"><span class="rk">${i + 1}</span><span class="nm">${e.name}</span><span class="tm">${fmtTime(e.ms)}</span><span class="ln">${e.lines} LN</span></li>`;
}
function renderTitleLb() {
  const m = MODE_ORDER[menuIdx];
  if (MODES[m].players === 2) {
    lbTitleEl.textContent = 'HEAD TO HEAD';
    lbListEl.innerHTML = '<div class="lb-empty">NO LEDGER — ONLY A WINNER</div>';
    return;
  }
  lbTitleEl.textContent = `ETCHED IN STONE — ${MODES[m].title}`;
  const list = lbLoad(m).slice(0, 5);
  lbListEl.innerHTML = list.length
    ? list.map((e, i) => lbRow(e, i)).join('')
    : '<div class="lb-empty">NO SURVIVORS YET</div>';
}

/* ---------------- menu ---------------- */
const modeCards = [...document.querySelectorAll('.mode-card')];
function renderMenu() {
  modeCards.forEach((el, i) => el.classList.toggle('sel', i === menuIdx));
  renderTitleLb();
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

/* ---------------- run flow ---------------- */
function startRun() {
  mode = MODE_ORDER[menuIdx];
  const m = MODES[mode];
  audio.ensure();
  ensurePanes(m.players);
  players.forEach((p, i) => {
    p.keymap = m.players === 2 ? DUEL_KEYS[i] : SOLO_KEYS;
    p.reset();
    p.stage.idleMode = false;
    p.stage.spinDur = m.spinDur;
    p.pane.classList.remove('hud-off');
  });
  elapsed = 0; gravityAcc = 0; level = 1;
  pendingResult = null;
  hintEl.innerHTML = HINTS[mode];

  $('title-screen').classList.add('hidden');
  $('gameover-screen').classList.add('hidden');
  $('entry-screen').classList.add('hidden');
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
      audio.startMusic();
    }
  };
  tick();
}

function toTitle() {
  state = 'title';
  audio.stopMusic();
  ['gameover-screen', 'entry-screen', 'pause-screen', 'countdown'].forEach(id => $(id).classList.add('hidden'));
  hudGlobal.classList.add('hidden');
  $('title-screen').classList.remove('hidden');
  ensurePanes(1);
  players[0].boards.forEach(b => { b.controlled = false; b.reset(); b.controlled = false; });
  players[0].stage.idleMode = true;
  players[0].pane.classList.add('hud-off');
  document.documentElement.style.setProperty('--accent', '#22d3ee');
  document.documentElement.style.setProperty('--accent-dim', '#22d3ee59');
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

/* ---------------- game over ---------------- */
function endRun(loser, deadFace) {
  if (state !== 'playing') return;
  state = 'dying';
  audio.gameOver();
  players.forEach(p => p.stage.kick(1.1));

  if (MODES[mode].players === 2) {
    const winner = players[1 - loser.idx];
    setTimeout(() => {
      buildDuelGameover(winner, loser, deadFace);
      $('gameover-screen').classList.remove('hidden');
      audio.fanfare();
      state = 'gameover';
    }, 900);
    return;
  }

  const result = { ms: elapsed, lines: players[0].totalLines, level, deadFace };
  if (lbQualifies(mode, result.ms)) {
    pendingResult = result;
    setTimeout(() => {
      $('entry-sub').textContent = `${MODES[mode].title} — ${fmtTime(result.ms)} · ${result.lines} LINES`;
      nameInput.value = localStorage.getItem('obelisk_name') || '';
      $('entry-screen').classList.remove('hidden');
      nameInput.focus();
      state = 'entry';
    }, 900);
  } else {
    setTimeout(() => {
      buildSoloGameover(result, null);
      $('gameover-screen').classList.remove('hidden');
      state = 'gameover';
    }, 900);
  }
}

function submitEntry(skip = false) {
  if (state !== 'entry' || !pendingResult) return;
  const raw = skip ? '' : nameInput.value.trim().toUpperCase().replace(/[^A-Z0-9 \-_.!?]/g, '');
  const name = raw || 'WANDERER';
  if (!skip) localStorage.setItem('obelisk_name', name);
  const entry = { name, ms: Math.floor(pendingResult.ms), lines: pendingResult.lines, date: Date.now() };
  const rank = lbInsert(mode, entry);
  $('entry-screen').classList.add('hidden');
  buildSoloGameover(pendingResult, rank);
  $('gameover-screen').classList.remove('hidden');
  pendingResult = null;
  state = 'gameover';
  audio.lineClear(2);
}

function buildSoloGameover(result, rank) {
  const p = players[0];
  const list = lbLoad(mode);
  const lbHtml = list.length
    ? `<ol class="go-lb" style="margin-top:26px">${list.map((e, i) =>
        lbRow(e, i, (i === rank ? 'you' : '') + (i === 0 ? ' top' : ''))).join('')}</ol>`
    : '';
  $('go-content').innerHTML = `
    <div class="go-head">THE OBELISK FALLS</div>
    <div class="go-cause">FACE ${FACES[result.deadFace].glyph} WAS OVERRUN — ${MODES[mode].title}</div>
    <div class="go-stats">
      <div class="go-stat"><div class="hud-label">SURVIVED</div><div class="go-num">${fmtTime(result.ms)}</div></div>
      <div class="go-stat"><div class="hud-label">TOTAL LINES</div><div class="go-num">${result.lines}</div></div>
      <div class="go-stat"><div class="hud-label">VELOCITY</div><div class="go-num">${result.level}</div></div>
    </div>
    <div class="go-faces">${p.boards.map((b, i) =>
      `<div class="go-face" style="color:${FACES[i].accent}"><span class="glyph">${FACES[i].glyph}</span>${b.lines}</div>`).join('')}</div>
    ${rank !== null && rank >= 0 ? `<div class="best" style="margin-top:22px">★ RANK ${rank + 1} — ETCHED IN STONE ★</div>` : ''}
    ${lbHtml}
    <div class="press">ENTER — RISE AGAIN &middot; ESC — MODES</div>`;
}

function buildDuelGameover(winner, loser, deadFace) {
  const wc = PLAYER_COLORS[winner.idx];
  $('go-content').innerHTML = `
    <div class="go-head" style="color:${wc};text-shadow:0 0 30px ${wc}">${PLAYER_NAMES[winner.idx]} CONQUERS</div>
    <div class="go-cause">${PLAYER_NAMES[loser.idx]}'S FACE ${FACES[deadFace].glyph} WAS OVERRUN</div>
    <div class="go-stats">
      <div class="go-stat"><div class="hud-label">MATCH TIME</div><div class="go-num">${fmtTime(elapsed)}</div></div>
      <div class="go-stat"><div class="hud-label">${PLAYER_NAMES[0]}</div><div class="go-num" style="color:${PLAYER_COLORS[0]}">${players[0].totalLines} LN</div></div>
      <div class="go-stat"><div class="hud-label">${PLAYER_NAMES[1]}</div><div class="go-num" style="color:${PLAYER_COLORS[1]}">${players[1].totalLines} LN</div></div>
    </div>
    <div class="press">ENTER — REMATCH &middot; ESC — MODES</div>`;
}

/* ---------------- actions ---------------- */
function canAct(p) {
  return state === 'playing' && p.alive && !p.stage.spinning && p.board.piece && !p.board.clearing;
}
function doRotate(p, dir) { if (canAct(p) && p.board.tryRotate(dir)) audio.rotate(); }
function doHard(p) {
  if (!canAct(p)) return;
  p.board.hardDrop();
  audio.hardDrop();
  p.stage.kick(0.35);
  if (p.board.toppedOut) endRun(p, p.currentFace);
}
function doSpin(p, dir) {
  if (mode !== 'sovereign' || state !== 'playing' || !p.alive || p.stage.spinning) return;
  p.spinTo((p.currentFace + dir + 4) % 4);
}
function doMove(p, dx) { if (canAct(p) && p.board.tryMove(dx, 0)) audio.move(); }

/* ---------------- input: keyboard ---------------- */
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
      if (state === 'paused' || state === 'gameover') toTitle();
      return;
    case 'p': case 'P': togglePause(); return;
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
    if (['ArrowUp', 'KeyW', 'ArrowLeft', 'KeyA'].includes(e.code)) menuMove(-1);
    else if (['ArrowDown', 'KeyS', 'ArrowRight', 'KeyD'].includes(e.code)) menuMove(1);
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

/* ---------------- input: gamepads ---------------- */
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
        if (edge(2) || edge(3)) doHard(p);
        if (edge(4)) doSpin(p, -1);
        if (edge(5)) doSpin(p, 1);
      }
      if (edge(9)) togglePause();
    } else if (state === 'title') {
      if (edge(12) || edge(14)) menuMove(-1);
      if (edge(13) || edge(15)) menuMove(1);
      if (edge(0) || edge(9)) startRun();
    } else if (state === 'gameover') {
      if (edge(0) || edge(9)) startRun();
      if (edge(1)) toTitle();
    } else if (state === 'entry') {
      if (edge(0)) submitEntry();
      if (edge(1)) submitEntry(true);
    }
    padPrev[gp.index] = gp.buttons.map(b => b.pressed);
  }
}

/* ---------------- per-frame gameplay ---------------- */
function processHeld(p, dtMs) {
  for (const [dir, dx] of [['left', -1], ['right', 1]]) {
    const down = p.kb[dir] || p.padHeld[dir];
    const h = p.hold[dir];
    if (down && !h.down) { h.down = true; h.t = 0; doMove(p, dx); }
    else if (down) {
      h.t += dtMs;
      while (h.t >= DAS_DELAY) { h.t -= DAS_RATE; doMove(p, dx); }
    } else h.down = false;
  }
  const soft = p.kb.soft || p.padHeld.soft;
  const s = p.hold.soft;
  if (soft) {
    if (!s.down) { s.down = true; s.acc = SOFT_RATE; }
    s.acc += dtMs;
    while (s.acc >= SOFT_RATE) {
      s.acc -= SOFT_RATE;
      if (canAct(p) && p.board.tryMove(0, 1)) audio.softDrop();
    }
  } else s.down = false;
}

function stepGravity() {
  const g = gravityMs();
  while (gravityAcc >= g) {
    gravityAcc -= g;
    for (const p of players) {
      if (!p.alive) continue;
      for (const b of p.boards) {
        const r = b.step();
        if (r.locked && b.controlled) audio.lockPiece();
        if (b.toppedOut) { endRun(p, b.face); return; }
      }
    }
  }
}

function resolveClears(now) {
  for (const p of players) {
    for (const b of p.boards) {
      if (!b.clearing || now - b.clearing.t0 < CLEAR_FLASH_MS) continue;
      const { rows, wasControlled } = b.clearing;
      const n = rows.length;
      const rows01 = rows.map(y => y / 19);
      b.finishClear();
      p.totalLines += n;
      p.totalLinesEl.textContent = p.totalLines;
      pop(p.totalLinesEl);
      if (b.face === p.currentFace) {
        p.faceLinesEl.textContent = b.lines;
        rows01.forEach(r => p.stage.burst(r, FACES[b.face].accent, 90 + n * 40));
      }
      if (wasControlled) {
        audio.lineClear(n);
        p.stage.kick(0.3 + n * 0.12);
        if (mode === 'rite') p.spinTo(p.randomOther());
        else if (mode === 'duel') {
          const foe = players[1 - p.idx];
          if (foe?.alive) foe.spinTo(foe.randomOther());
        }
        // sovereign: the turns are yours alone
      }
    }
  }
}

/* ---------------- title demo (autopilot keeps the obelisk alive) ---------------- */
function titleDemo(now, dtMs) {
  titleDemoAcc += dtMs;
  const p = players[0];
  while (titleDemoAcc >= 620) {
    titleDemoAcc -= 620;
    for (const b of p.boards) {
      b.controlled = false;
      b.step();
      if (b.toppedOut) { b.reset(); b.controlled = false; }
    }
  }
  for (const b of p.boards) {
    if (b.clearing && now - b.clearing.t0 >= CLEAR_FLASH_MS) { b.finishClear(); }
  }
}

/* ---------------- main loop ---------------- */
function frame(now) {
  requestAnimationFrame(frame);
  const dtMs = Math.min(100, now - lastTime);
  const dt = dtMs / 1000;
  lastTime = now;

  pollPads();

  if (state === 'playing') {
    elapsed += dtMs;
    const newLevel = 1 + Math.floor(elapsed / LEVEL_EVERY);
    if (newLevel !== level) {
      level = newLevel;
      players.forEach(p => { p.levelEl.textContent = level; pop(p.levelEl); });
      audio.levelUp();
      audio.setIntensity((level - 1) / 8);
    }
    gravityAcc += dtMs;
    stepGravity();
    if (state === 'playing') {
      players.forEach(p => processHeld(p, dtMs));
      resolveClears(now);
      players.forEach(p => {
        if (now - p.lastMonDraw > 33) { p.lastMonDraw = now; p.drawMonitors(now); }
      });
      const t = fmtTime(elapsed);
      timerEl.innerHTML = `${t.slice(0, 5)}<span class="tenths">${t.slice(5)}</span>`;
    }
  } else if (state === 'title' && players.length) {
    titleDemo(now, dtMs);
  }

  // Draw at full display rate. Only faces the camera can see are uploaded to
  // the GPU each frame; off-camera faces redraw at 20Hz purely to keep the
  // mini-monitors fresh (no texture upload).
  const frac = state === 'playing' || state === 'dying' ? Math.min(1, gravityAcc / gravityMs()) : 0;
  for (const p of players) {
    const vis = p.stage.visibleFaces();
    p.boards.forEach((b, i) => {
      if (vis.has(i)) {
        p.renderers[i].draw(now, frac, dt);
        p.stage.markFaceDirty(i);
      } else if (now - p.hiddenDrawAt[i] > 50) {
        p.hiddenDrawAt[i] = now;
        p.renderers[i].draw(now, frac, dt);
      }
    });
    p.stage.update(dt, now);
  }

  // fps meter
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
ensurePanes(1);
players[0].stage.idleMode = true;
players[0].boards.forEach(b => { b.controlled = false; });
players[0].pane.classList.add('hud-off');
renderMenu();
requestAnimationFrame(frame);

/* ---------------- debug hooks ---------------- */
window.QDBG = {
  state: () => state,
  mode: () => mode,
  players: () => players,
  get boards() { return players[0]?.boards; },
  get stage() { return players[0]?.stage; },
  face: (pi = 0) => players[pi]?.currentFace,
  start: m => { if (m) menuIdx = MODE_ORDER.indexOf(m); startRun(); },
  clear: (pi = 0) => { const p = players[pi]; p.boards[p.currentFace].debugFillBottom(); },
  resolve: () => resolveClears(performance.now() + 10_000),
  stepAll: (n = 1) => { for (let i = 0; i < n; i++) players.forEach(p => p.boards.forEach(b => b.step())); },
  tick: (dt = 0.016) => {
    const now = performance.now();
    for (const p of players) {
      p.boards.forEach((b, i) => { p.renderers[i].draw(now, 0, dt); p.stage.markFaceDirty(i); });
      p.stage.update(dt, now);
    }
  },
  snap: (w = 720, q = 0.7, pi = 0) => {
    const gl = players[pi].canvas;
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = Math.round(w * gl.height / gl.width);
    cv.getContext('2d').drawImage(gl, 0, 0, cv.width, cv.height);
    return cv.toDataURL('image/jpeg', q);
  },
};
