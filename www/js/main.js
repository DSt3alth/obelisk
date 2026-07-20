// OBELISK — orchestrator: four synchronized boards, one commanded face,
// spin-on-clear, HUD, input, state machine.
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

/* ---------------- setup ---------------- */
const boards = FACES.map((_, i) => new Board(i));
const renderers = boards.map((b, i) => new FaceRenderer(b, FACES[i]));
const stage = new Stage(
  document.getElementById('gl'),
  renderers.map(r => r.canvas),
  FACES
);

const $ = id => document.getElementById(id);
const hud = $('hud'), timerEl = $('timer'), faceLinesEl = $('face-lines'),
  totalLinesEl = $('total-lines'), levelEl = $('level'), faceGlyphEl = $('face-glyph'),
  dangerEl = $('danger-vignette'), spinFlashEl = $('spin-flash');
const monitors = [...document.querySelectorAll('.monitor')];
const monCvs = monitors.map(m => m.querySelector('.mon-cv').getContext('2d'));
const monTags = monitors.map(m => m.querySelector('.mon-tag'));

/* ---------------- state ---------------- */
let state = 'title'; // title | countdown | playing | paused | gameover
let currentFace = 0;
let elapsed = 0;
let gravityAcc = 0;
let softAcc = 0;
let level = 1;
let totalLines = 0;
let pendingSpin = null;   // face index queued once the clear flash finishes
let lastTime = performance.now();
let pausedAt = 0;

const keys = {};
const DAS_DELAY = 150, DAS_RATE = 42;

function gravityMs() { return Math.max(95, BASE_GRAVITY * Math.pow(0.86, level - 1)); }
function fmtTime(ms, tenthsSep = true) {
  const t = Math.max(0, ms);
  const m = String(Math.floor(t / 60000)).padStart(2, '0');
  const s = String(Math.floor((t % 60000) / 1000)).padStart(2, '0');
  const d = Math.floor((t % 1000) / 100);
  return tenthsSep ? `${m}:${s}|${d}` : `${m}:${s}.${d}`;
}

function setAccent(faceIdx) {
  const { accent } = FACES[faceIdx];
  document.documentElement.style.setProperty('--accent', accent);
  document.documentElement.style.setProperty('--accent-dim', accent + '59');
  faceGlyphEl.textContent = FACES[faceIdx].glyph;
  stage.setAccent(accent);
}

/* ---------------- game flow ---------------- */
function startGame() {
  boards.forEach(b => b.reset());
  currentFace = 0;
  boards[0].controlled = true;
  elapsed = 0; gravityAcc = 0; level = 1; totalLines = 0; pendingSpin = null;
  setAccent(0);
  stage.idleMode = false;
  stage.rotY = 0; stage.spinT = 1;
  totalLinesEl.textContent = '0';
  faceLinesEl.textContent = '0';
  levelEl.textContent = '1';

  $('title-screen').classList.add('hidden');
  $('gameover-screen').classList.add('hidden');
  hud.classList.remove('hidden');

  state = 'countdown';
  let n = 3;
  const cd = $('countdown');
  cd.classList.remove('hidden');
  const tick = () => {
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

function switchControl(to) {
  boards[currentFace].controlled = false;
  // the abandoned face's in-flight piece gets an autopilot plan
  if (boards[currentFace].piece) boards[currentFace].autoPlan = null;
  currentFace = to;
  const b = boards[to];
  b.controlled = true;
  b.autoPlan = null;
  b.dirty = true;
  setAccent(to);
  faceLinesEl.textContent = b.lines;
  faceLinesEl.classList.remove('pop'); void faceLinesEl.offsetWidth; faceLinesEl.classList.add('pop');
}

function queueSpin() {
  const options = [0, 1, 2, 3].filter(i => i !== currentFace);
  pendingSpin = options[(Math.random() * options.length) | 0];
}

function executeSpin() {
  const to = pendingSpin;
  pendingSpin = null;
  spinFlashEl.classList.remove('go'); void spinFlashEl.offsetWidth; spinFlashEl.classList.add('go');
  audio.spin();
  stage.spinToFace(to);
  stage.kick(0.55);
  switchControl(to);
}

function gameOver(deadFace) {
  state = 'gameover';
  audio.gameOver();
  stage.kick(1.1);

  $('go-cause').textContent = `FACE ${FACES[deadFace].glyph} WAS OVERRUN`;
  $('go-time').textContent = fmtTime(elapsed, false);
  $('go-lines').textContent = totalLines;
  $('go-level').textContent = level;
  $('go-faces').innerHTML = boards.map((b, i) =>
    `<div class="go-face" style="color:${FACES[i].accent}"><span class="glyph">${FACES[i].glyph}</span>${b.lines}</div>`
  ).join('');

  const best = Number(localStorage.getItem('obelisk_best_ms') || 0);
  if (elapsed > best) {
    localStorage.setItem('obelisk_best_ms', String(Math.floor(elapsed)));
    localStorage.setItem('obelisk_best_lines', String(totalLines));
    $('go-best').textContent = '★ NEW BEST SURVIVAL ★';
  } else {
    $('go-best').textContent = `BEST — ${fmtTime(best, false)}`;
  }

  setTimeout(() => $('gameover-screen').classList.remove('hidden'), 900);
}

/* ---------------- per-frame logic ---------------- */
function resolveClears(now) {
  for (const b of boards) {
    if (b.clearing && now - b.clearing.t0 >= CLEAR_FLASH_MS) {
      const n = b.clearing.rows.length;
      const rows01 = b.clearing.rows.map(y => y / 19);
      b.finishClear();
      totalLines += n;
      totalLinesEl.textContent = totalLines;
      totalLinesEl.classList.remove('pop'); void totalLinesEl.offsetWidth; totalLinesEl.classList.add('pop');
      if (b.face === currentFace) {
        faceLinesEl.textContent = b.lines;
        rows01.forEach(r => stage.burst(r, FACES[b.face].accent, 90 + n * 40));
        audio.lineClear(n);
        stage.kick(0.3 + n * 0.12);
        if (pendingSpin !== null) executeSpin();
      }
    }
  }
}

function stepGravity(now) {
  const g = gravityMs();
  gravityAcc += now - lastTime;
  while (gravityAcc >= g) {
    gravityAcc -= g;
    for (const b of boards) {
      const r = b.step();
      if (r.locked && b.controlled) audio.lockPiece();
      if (r.cleared > 0) {
        if (b.controlled) queueSpin();
        // unattended clears just count (handled in resolveClears)
      }
      if (b.toppedOut) { gameOver(b.face); return; }
    }
  }
}

/* DAS: initial move on keydown, then delayed auto-repeat */
const rep = { left: null, right: null };
function pressMove(dir) {
  const b = boards[currentFace];
  const dx = dir === 'left' ? -1 : 1;
  if (state === 'playing' && !stage.spinning && b.tryMove(dx, 0)) audio.move();
  clearTimeout(rep[dir]?.t1); clearInterval(rep[dir]?.t2);
  const t1 = setTimeout(() => {
    const t2 = setInterval(() => {
      if (state !== 'playing' || !keys[dir]) { clearInterval(t2); return; }
      const bb = boards[currentFace];
      if (!stage.spinning && bb.tryMove(dx, 0)) audio.move();
    }, DAS_RATE);
    rep[dir].t2 = t2;
  }, DAS_DELAY);
  rep[dir] = { t1, t2: null };
}
function releaseMove(dir) {
  if (rep[dir]) { clearTimeout(rep[dir].t1); clearInterval(rep[dir].t2); rep[dir] = null; }
}

/* ---------------- monitors + danger ---------------- */
function drawMonitors() {
  const others = [0, 1, 2, 3].filter(i => i !== currentFace);
  let anyDanger = false;
  others.forEach((fi, mi) => {
    const b = boards[fi];
    const c = monCvs[mi];
    const src = renderers[fi].canvas;
    c.clearRect(0, 0, 90, 176);
    c.drawImage(src, 0, 0, src.width, src.height, 0, 0, 90, 176);
    monTags[mi].textContent = FACES[fi].glyph;
    monTags[mi].style.color = FACES[fi].accent;
    const danger = b.stackHeight() >= 15;
    monitors[mi].classList.toggle('warning', danger);
    if (danger) anyDanger = true;
  });
  const selfDanger = boards[currentFace].stackHeight() >= 15;
  dangerEl.classList.toggle('on', anyDanger || selfDanger);
  return anyDanger;
}

let lastWarnPing = 0;
let lastLevel = 1;

/* ---------------- main loop ---------------- */
function frame(now) {
  requestAnimationFrame(frame);
  const dtMs = Math.min(100, now - lastTime);
  const dt = dtMs / 1000;

  if (state === 'playing') {
    elapsed += dtMs;
    const newLevel = 1 + Math.floor(elapsed / LEVEL_EVERY);
    if (newLevel !== level) {
      level = newLevel;
      levelEl.textContent = level;
      levelEl.classList.remove('pop'); void levelEl.offsetWidth; levelEl.classList.add('pop');
      audio.levelUp();
      audio.setIntensity((level - 1) / 8);
    }

    stepGravity(now);
    if (state === 'playing') {
      if (keys.down) {
        softAcc += dtMs;
        if (softAcc >= 45) {
          softAcc = 0;
          const b = boards[currentFace];
          if (!stage.spinning && b.tryMove(0, 1)) { audio.softDrop(); gravityAcc = Math.min(gravityAcc, 20); }
        }
      }
      resolveClears(now);
      const warn = drawMonitors();
      if (warn && now - lastWarnPing > 2500) { lastWarnPing = now; audio.warning(); }

      const t = fmtTime(elapsed).split('|');
      timerEl.innerHTML = `${t[0]}<span class="tenths">.${t[1]}</span>`;
    }
  }

  // redraw dirty faces (clear-flash and danger pulse need continuous redraw)
  boards.forEach((b, i) => {
    if (b.dirty || b.clearing || b.stackHeight() >= 13 || b.toppedOut) {
      renderers[i].draw(now);
      stage.markFaceDirty(i);
    }
  });

  stage.update(dt, now);
  lastTime = now;
}

/* ---------------- input ---------------- */
window.addEventListener('keydown', e => {
  if (e.repeat) {
    if (['ArrowLeft', 'ArrowRight', 'ArrowDown', ' '].includes(e.key)) e.preventDefault();
    return;
  }
  audio.ensure();
  const b = boards[currentFace];

  switch (e.key) {
    case 'Enter':
      if (state === 'title' || state === 'gameover') startGame();
      break;
    case 'p': case 'P':
      if (state === 'playing') {
        state = 'paused'; pausedAt = performance.now();
        $('pause-screen').classList.remove('hidden');
        audio.stopMusic();
      } else if (state === 'paused') {
        state = 'playing';
        lastTime = performance.now();
        $('pause-screen').classList.add('hidden');
        audio.startMusic();
      }
      break;
    case 'm': case 'M': audio.toggleMute(); break;
    case 'F11': {
      e.preventDefault();
      const win = window.__TAURI__?.window?.getCurrentWindow?.();
      if (win) win.isFullscreen().then(f => win.setFullscreen(!f));
      else if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
      else document.exitFullscreen?.();
      break;
    }
    case 'ArrowLeft': case 'a': case 'A':
      e.preventDefault(); keys.left = true;
      if (state === 'playing') pressMove('left');
      break;
    case 'ArrowRight': case 'd': case 'D':
      e.preventDefault(); keys.right = true;
      if (state === 'playing') pressMove('right');
      break;
    case 'ArrowDown': case 's': case 'S':
      e.preventDefault(); keys.down = true; softAcc = 45;
      break;
    case 'ArrowUp': case 'x': case 'X':
      e.preventDefault();
      if (state === 'playing' && !stage.spinning && b.tryRotate(1)) audio.rotate();
      break;
    case 'z': case 'Z':
      if (state === 'playing' && !stage.spinning && b.tryRotate(-1)) audio.rotate();
      break;
    case ' ': {
      e.preventDefault();
      if (state === 'playing' && !stage.spinning && b.piece && !b.clearing) {
        b.hardDrop();
        audio.hardDrop();
        stage.kick(0.35);
        // hardDrop -> lock may have set clearing / topped out
        if (b.clearing) queueSpin();
        if (b.toppedOut) gameOver(b.face);
        gravityAcc = 0;
      }
      break;
    }
  }
});

window.addEventListener('keyup', e => {
  switch (e.key) {
    case 'ArrowLeft': case 'a': case 'A': keys.left = false; releaseMove('left'); break;
    case 'ArrowRight': case 'd': case 'D': keys.right = false; releaseMove('right'); break;
    case 'ArrowDown': case 's': case 'S': keys.down = false; break;
  }
});

window.addEventListener('blur', () => {
  keys.left = keys.right = keys.down = false;
  releaseMove('left'); releaseMove('right');
  if (state === 'playing') {
    state = 'paused';
    $('pause-screen').classList.remove('hidden');
    audio.stopMusic();
  }
});

/* ---------------- title bootstrap ---------------- */
{
  const best = Number(localStorage.getItem('obelisk_best_ms') || 0);
  if (best > 0) {
    $('best-line').textContent = `BEST SURVIVAL — ${fmtTime(best, false)} · ${localStorage.getItem('obelisk_best_lines') || 0} LINES`;
  }
}

/* ---------------- debug hooks (harmless in prod) ---------------- */
window.QDBG = {
  state: () => state,
  boards,
  stage,
  renderers,
  start: () => startGame(),
  clear: () => { const b = boards[currentFace]; b.debugFillBottom(); queueSpin(); },
  face: () => currentFace,
  resolve: () => resolveClears(performance.now() + 10_000),
  stepAll: (n = 1) => { for (let i = 0; i < n; i++) boards.forEach(b => b.step()); },
  // headless single frame: draw all faces + render the stage once
  tick: (dt = 0.016) => {
    const now = performance.now();
    boards.forEach((b, i) => { renderers[i].draw(now); stage.markFaceDirty(i); });
    stage.update(dt, now);
  },
  snap: (w = 720, q = 0.7) => {
    const gl = document.getElementById('gl');
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = Math.round(w * gl.height / gl.width);
    cv.getContext('2d').drawImage(gl, 0, 0, cv.width, cv.height);
    return cv.toDataURL('image/jpeg', q);
  },
};

requestAnimationFrame(frame);
