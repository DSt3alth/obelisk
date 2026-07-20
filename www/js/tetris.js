// OBELISK — core Tetris engine. One Board per obelisk face.
// All boards share the same external gravity clock (main.js drives step()).

export const COLS = 10;
export const ROWS = 20;

// Neon block palette, shared across faces (index 1..7 stored in the grid).
export const PIECE_COLORS = [
  null,
  '#38e8ff', // I
  '#ffd23e', // O
  '#c77bff', // T
  '#5dff8a', // S
  '#ff5d7e', // Z
  '#5d8bff', // J
  '#ff9a3d', // L
];

const BASE_SHAPES = {
  I: [[0,1],[1,1],[2,1],[3,1]],
  O: [[1,0],[2,0],[1,1],[2,1]],
  T: [[1,0],[0,1],[1,1],[2,1]],
  S: [[1,0],[2,0],[0,1],[1,1]],
  Z: [[0,0],[1,0],[1,1],[2,1]],
  J: [[0,0],[0,1],[1,1],[2,1]],
  L: [[2,0],[0,1],[1,1],[2,1]],
};
const NAMES = ['I','O','T','S','Z','J','L'];

// Precompute the 4 rotation states for each piece as cell-offset lists.
function rotateCells(cells, size) {
  return cells.map(([x, y]) => [size - 1 - y, x]);
}
const ROTATIONS = {};
for (const name of NAMES) {
  const size = name === 'I' ? 4 : 3;
  const states = [BASE_SHAPES[name]];
  for (let i = 1; i < 4; i++) states.push(rotateCells(states[i - 1], size));
  ROTATIONS[name] = states;
}

const KICKS = [[0, 0], [-1, 0], [1, 0], [-2, 0], [2, 0], [0, -1], [-1, -1], [1, -1]];

function makeBag() {
  const bag = [...NAMES];
  for (let i = bag.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [bag[i], bag[j]] = [bag[j], bag[i]];
  }
  return bag;
}

export class Board {
  constructor(faceIndex) {
    this.face = faceIndex;
    this.reset();
  }

  reset() {
    this.grid = Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
    this.bag = makeBag();
    this.nextBag = makeBag();
    this.piece = null;       // {name, rot, x, y, color}
    this.nextName = this.#draw();
    this.lines = 0;
    this.toppedOut = false;
    this.controlled = false;
    this.autoPlan = null;    // {rot, x} target for autopilot
    this.clearing = null;    // {rows, t0, wasControlled} — flash animation state
    this.dirty = true;       // needs 2D redraw
    this.justLocked = false;
    this.pieceSeq = 0;       // bumps every spawn (renderer resets its smoothing)
    this.spawn();
  }

  #draw() {
    if (this.bag.length === 0) { this.bag = this.nextBag; this.nextBag = makeBag(); }
    return this.bag.pop();
  }

  cells(piece = this.piece) {
    const { name, rot, x, y } = piece;
    return ROTATIONS[name][rot].map(([cx, cy]) => [cx + x, cy + y]);
  }

  collides(piece) {
    for (const [cx, cy] of this.cells(piece)) {
      if (cx < 0 || cx >= COLS || cy >= ROWS) return true;
      if (cy >= 0 && this.grid[cy][cx]) return true;
    }
    return false;
  }

  spawn() {
    const name = this.nextName;
    this.nextName = this.#draw();
    const piece = { name, rot: 0, x: name === 'O' ? 3 : 3, y: name === 'I' ? -1 : 0, color: NAMES.indexOf(name) + 1 };
    if (this.collides(piece)) {
      // Try one row higher before declaring death.
      piece.y -= 1;
      if (this.collides(piece)) { this.toppedOut = true; this.piece = piece; this.dirty = true; return; }
    }
    this.piece = piece;
    this.pieceSeq++;
    if (!this.controlled) this.autoPlan = this.#planAuto();
    this.dirty = true;
  }

  tryMove(dx, dy) {
    if (!this.piece || this.toppedOut || this.clearing) return false;
    const p = { ...this.piece, x: this.piece.x + dx, y: this.piece.y + dy };
    if (this.collides(p)) return false;
    this.piece = p;
    this.dirty = true;
    return true;
  }

  tryRotate(dir) {
    if (!this.piece || this.toppedOut || this.clearing) return false;
    const rot = (this.piece.rot + dir + 4) % 4;
    for (const [kx, ky] of KICKS) {
      const p = { ...this.piece, rot, x: this.piece.x + kx, y: this.piece.y + ky };
      if (!this.collides(p)) { this.piece = p; this.dirty = true; return true; }
    }
    return false;
  }

  ghostY() {
    if (!this.piece) return 0;
    let p = { ...this.piece };
    while (!this.collides({ ...p, y: p.y + 1 })) p.y++;
    return p.y;
  }

  hardDrop() {
    if (!this.piece || this.toppedOut || this.clearing) return 0;
    const from = this.piece.y;
    this.piece = { ...this.piece, y: this.ghostY() };
    const dist = this.piece.y - from;
    this.lock();
    return dist;
  }

  // One gravity step. Returns {locked, cleared} — cleared rows enter the flash
  // animation and are physically removed later by finishClear().
  step() {
    if (this.toppedOut || this.clearing) return { locked: false, cleared: 0 };
    if (!this.piece) { this.spawn(); return { locked: false, cleared: 0 }; }

    if (!this.controlled) this.#autoNudge();

    if (!this.tryMove(0, 1)) return this.lock();
    return { locked: false, cleared: 0 };
  }

  lock() {
    for (const [cx, cy] of this.cells()) {
      if (cy < 0) { this.toppedOut = true; break; }
      this.grid[cy][cx] = this.piece.color;
    }
    this.piece = null;
    this.justLocked = true;
    this.dirty = true;
    if (this.toppedOut) return { locked: true, cleared: 0 };

    const rows = [];
    for (let y = 0; y < ROWS; y++) if (this.grid[y].every(v => v)) rows.push(y);
    if (rows.length) {
      this.clearing = { rows, t0: performance.now(), wasControlled: this.controlled };
      return { locked: true, cleared: rows.length };
    }
    this.spawn();
    return { locked: true, cleared: 0 };
  }

  // Called by main.js once the flash animation has played out.
  finishClear() {
    if (!this.clearing) return;
    const { rows } = this.clearing;
    for (const y of rows) {
      this.grid.splice(y, 1);
      this.grid.unshift(new Array(COLS).fill(0));
    }
    this.lines += rows.length;
    this.clearing = null;
    this.dirty = true;
    this.spawn();
  }

  stackHeight() {
    for (let y = 0; y < ROWS; y++) if (this.grid[y].some(v => v)) return ROWS - y;
    return 0;
  }

  /* ---------------- autopilot (unattended faces) ---------------- */

  // Mediocre-on-purpose ghost player: samples a few placements, picks the
  // least-bad, occasionally blunders. Keeps unattended faces alive for a
  // while but guarantees slow decay — the pressure the game is built on.
  #planAuto() {
    if (Math.random() < 0.14) {
      return { rot: (Math.random() * 4) | 0, x: (Math.random() * (COLS - 2)) | 0 };
    }
    let best = null, bestScore = Infinity;
    for (let i = 0; i < 5; i++) {
      const rot = (Math.random() * 4) | 0;
      const x = (Math.random() * COLS) | 0;
      const p = { ...this.piece, rot, x };
      if (this.collides(p)) continue;
      let drop = { ...p };
      while (!this.collides({ ...drop, y: drop.y + 1 })) drop.y++;
      let maxH = 0, holes = 0;
      const cols = new Set();
      for (const [cx, cy] of this.cells(drop)) {
        maxH = Math.max(maxH, ROWS - cy);
        cols.add(cx);
        if (cy + 1 < ROWS && !this.grid[cy + 1][cx]) {
          let covered = true;
          for (const [ox, oy] of this.cells(drop)) if (ox === cx && oy === cy + 1) covered = false;
          if (covered) holes++;
        }
      }
      const score = maxH + holes * 2.5;
      if (score < bestScore) { bestScore = score; best = { rot, x }; }
    }
    return best || { rot: this.piece.rot, x: this.piece.x };
  }

  #autoNudge() {
    if (!this.autoPlan || !this.piece) return;
    if (this.piece.rot !== this.autoPlan.rot) { this.tryRotate(1); return; }
    if (this.piece.x < this.autoPlan.x) this.tryMove(1, 0);
    else if (this.piece.x > this.autoPlan.x) this.tryMove(-1, 0);
  }

  /* ---------------- debug ---------------- */
  debugFillBottom() {
    const y = ROWS - 1;
    for (let x = 0; x < COLS; x++) this.grid[y][x] = ((x % 7) + 1);
    this.clearing = { rows: [y], t0: performance.now(), wasControlled: this.controlled };
    this.piece = null;
    this.dirty = true;
  }
}
