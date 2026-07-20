// OBELISK — core engine. One Board per obelisk face.
//
// Guideline-faithful where it matters for feel and skill ceiling:
//   · SRS rotation with the real TTC kick tables
//   · Lock delay 500ms with 15 move-resets (the single biggest feel upgrade)
//   · T-spin detection by the 3-corner rule, incl. kick-5 promotion
//   · 7-bag randomiser, hold piece, 5-piece preview
//   · Combo + back-to-back tracking
//   · Pluggable line disposal so ECLIPSE can restack instead of vanish

export const COLS = 10;
export const ROWS = 20;
export const LOCK_DELAY = 500;
export const MAX_LOCK_RESETS = 15;

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

const NAMES = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];

// Cell layouts per rotation state (0, R, 2, L), in a 4x4 (I) or 3x3 box.
const SHAPES = {
  I: [
    [[0,1],[1,1],[2,1],[3,1]],
    [[2,0],[2,1],[2,2],[2,3]],
    [[0,2],[1,2],[2,2],[3,2]],
    [[1,0],[1,1],[1,2],[1,3]],
  ],
  O: [
    [[1,0],[2,0],[1,1],[2,1]],
    [[1,0],[2,0],[1,1],[2,1]],
    [[1,0],[2,0],[1,1],[2,1]],
    [[1,0],[2,0],[1,1],[2,1]],
  ],
  T: [
    [[1,0],[0,1],[1,1],[2,1]],
    [[1,0],[1,1],[2,1],[1,2]],
    [[0,1],[1,1],[2,1],[1,2]],
    [[1,0],[0,1],[1,1],[1,2]],
  ],
  S: [
    [[1,0],[2,0],[0,1],[1,1]],
    [[1,0],[1,1],[2,1],[2,2]],
    [[1,1],[2,1],[0,2],[1,2]],
    [[0,0],[0,1],[1,1],[1,2]],
  ],
  Z: [
    [[0,0],[1,0],[1,1],[2,1]],
    [[2,0],[1,1],[2,1],[1,2]],
    [[0,1],[1,1],[1,2],[2,2]],
    [[1,0],[0,1],[1,1],[0,2]],
  ],
  J: [
    [[0,0],[0,1],[1,1],[2,1]],
    [[1,0],[2,0],[1,1],[1,2]],
    [[0,1],[1,1],[2,1],[2,2]],
    [[1,0],[1,1],[0,2],[1,2]],
  ],
  L: [
    [[2,0],[0,1],[1,1],[2,1]],
    [[1,0],[1,1],[1,2],[2,2]],
    [[0,1],[1,1],[2,1],[0,2]],
    [[0,0],[1,0],[1,1],[1,2]],
  ],
};

// SRS kick tables. Key "from>to" using states 0,1,2,3 = 0,R,2,L.
// Offsets are (x, y) with +y DOWN (screen space), so the wiki's +y-up values
// are negated here.
const KICKS_JLSTZ = {
  '0>1': [[0,0],[-1,0],[-1,-1],[0,2],[-1,2]],
  '1>0': [[0,0],[1,0],[1,1],[0,-2],[1,-2]],
  '1>2': [[0,0],[1,0],[1,1],[0,-2],[1,-2]],
  '2>1': [[0,0],[-1,0],[-1,-1],[0,2],[-1,2]],
  '2>3': [[0,0],[1,0],[1,-1],[0,2],[1,2]],
  '3>2': [[0,0],[-1,0],[-1,1],[0,-2],[-1,-2]],
  '3>0': [[0,0],[-1,0],[-1,1],[0,-2],[-1,-2]],
  '0>3': [[0,0],[1,0],[1,-1],[0,2],[1,2]],
};
const KICKS_I = {
  '0>1': [[0,0],[-2,0],[1,0],[-2,1],[1,-2]],
  '1>0': [[0,0],[2,0],[-1,0],[2,-1],[-1,2]],
  '1>2': [[0,0],[-1,0],[2,0],[-1,-2],[2,1]],
  '2>1': [[0,0],[1,0],[-2,0],[1,2],[-2,-1]],
  '2>3': [[0,0],[2,0],[-1,0],[2,-1],[-1,2]],
  '3>2': [[0,0],[-2,0],[1,0],[-2,1],[1,-2]],
  '3>0': [[0,0],[1,0],[-2,0],[1,2],[-2,-1]],
  '0>3': [[0,0],[-1,0],[2,0],[-1,-2],[2,1]],
};

export class Board {
  constructor(faceIndex, rng = Math.random) {
    this.face = faceIndex;
    this.rng = rng;
    this.reset();
  }

  setRng(rng) { this.rng = rng; }

  reset() {
    this.grid = Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
    this.bag = [];
    this.queue = [];
    this.#refill();
    this.piece = null;
    this.hold = null;
    this.holdUsed = false;
    this.lines = 0;
    this.toppedOut = false;
    this.controlled = false;
    this.autoPlan = null;
    this.clearing = null;
    this.dirty = true;
    this.pieceSeq = 0;

    // lock delay state
    this.landed = false;
    this.lockTimer = 0;
    this.lockResets = 0;

    // scoring state
    this.combo = -1;
    this.b2b = false;
    this.lastMoveWasRotation = false;
    this.lastKickIndex = 0;

    // eclipse: when true, cleared rows are banked instead of removed
    this.bankMode = false;
    this.banked = 0;

    this.spawn();
  }

  #makeBag() {
    const bag = [...NAMES];
    for (let i = bag.length - 1; i > 0; i--) {
      const j = (this.rng() * (i + 1)) | 0;
      [bag[i], bag[j]] = [bag[j], bag[i]];
    }
    return bag;
  }

  #refill() {
    while (this.queue.length < 6) {
      if (this.bag.length === 0) this.bag = this.#makeBag();
      this.queue.push(this.bag.pop());
    }
  }

  get nextName() { return this.queue[0]; }
  get preview() { return this.queue.slice(0, 5); }

  cells(piece = this.piece) {
    if (!piece) return [];
    const { name, rot, x, y } = piece;
    return SHAPES[name][rot].map(([cx, cy]) => [cx + x, cy + y]);
  }

  collides(piece) {
    for (const [cx, cy] of this.cells(piece)) {
      if (cx < 0 || cx >= COLS || cy >= ROWS) return true;
      if (cy >= 0 && this.grid[cy][cx]) return true;
    }
    return false;
  }

  spawn(name = null) {
    if (!name) { this.#refill(); name = this.queue.shift(); this.#refill(); }
    const piece = {
      name, rot: 0,
      x: name === 'I' ? 3 : 3,
      y: name === 'I' ? -1 : -1,
      color: NAMES.indexOf(name) + 1,
    };
    // Guideline: spawn above the field, drop in if blocked one row lower.
    if (this.collides(piece)) {
      piece.y -= 1;
      if (this.collides(piece)) {
        this.toppedOut = true;
        this.piece = piece;
        this.dirty = true;
        return;
      }
    }
    this.piece = piece;
    this.pieceSeq++;
    this.holdUsed = false;
    this.landed = false;
    this.lockTimer = 0;
    this.lockResets = 0;
    this.lastMoveWasRotation = false;
    if (!this.controlled) this.autoPlan = this.#planAuto();
    this.dirty = true;
  }

  holdPiece() {
    if (!this.piece || this.holdUsed || this.toppedOut || this.clearing) return false;
    const cur = this.piece.name;
    const swap = this.hold;
    this.hold = cur;
    this.holdUsed = true;
    if (swap) this.spawn(swap); else this.spawn();
    this.holdUsed = true; // spawn() cleared it
    this.dirty = true;
    return true;
  }

  #resetLock() {
    if (this.landed && this.lockResets < MAX_LOCK_RESETS) {
      this.lockTimer = 0;
      this.lockResets++;
    }
  }

  tryMove(dx, dy) {
    if (!this.piece || this.toppedOut || this.clearing) return false;
    const p = { ...this.piece, x: this.piece.x + dx, y: this.piece.y + dy };
    if (this.collides(p)) return false;
    this.piece = p;
    if (dx !== 0) { this.lastMoveWasRotation = false; this.#resetLock(); }
    if (dy > 0) { this.landed = false; this.lockTimer = 0; }
    this.dirty = true;
    return true;
  }

  tryRotate(dir) {
    if (!this.piece || this.toppedOut || this.clearing) return false;
    const from = this.piece.rot;
    const to = (from + dir + 4) % 4;
    if (this.piece.name === 'O') return false;
    const table = this.piece.name === 'I' ? KICKS_I : KICKS_JLSTZ;
    const kicks = table[`${from}>${to}`] || [[0, 0]];
    for (let i = 0; i < kicks.length; i++) {
      const [kx, ky] = kicks[i];
      const p = { ...this.piece, rot: to, x: this.piece.x + kx, y: this.piece.y + ky };
      if (!this.collides(p)) {
        this.piece = p;
        this.lastMoveWasRotation = true;
        this.lastKickIndex = i;
        this.#resetLock();
        this.dirty = true;
        return true;
      }
    }
    return false;
  }

  ghostY() {
    if (!this.piece) return 0;
    let y = this.piece.y;
    while (!this.collides({ ...this.piece, y: y + 1 })) y++;
    return y;
  }

  // 3-corner rule. Returns null | 'mini' | 'full'.
  #detectTSpin() {
    const p = this.piece;
    if (!p || p.name !== 'T' || !this.lastMoveWasRotation) return null;
    // T centre sits at (x+1, y+1) in every rotation state of our layout.
    const cx = p.x + 1, cy = p.y + 1;
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]]; // TL TR BR BL
    const occupied = corners.map(([dx, dy]) => {
      const gx = cx + dx, gy = cy + dy;
      if (gx < 0 || gx >= COLS || gy >= ROWS) return true; // walls & floor count
      if (gy < 0) return false;                            // above the field does not
      return !!this.grid[gy][gx];
    });
    const filled = occupied.filter(Boolean).length;
    if (filled < 3) return null;
    // Front corners depend on facing: 0=up,1=right,2=down,3=left
    const FRONT = { 0: [0, 1], 1: [1, 2], 2: [2, 3], 3: [3, 0] };
    const [a, b] = FRONT[p.rot];
    const full = occupied[a] && occupied[b];
    // last kick offset promotes a mini to a full spin (enables T-spin triples)
    if (!full && this.lastKickIndex === 4) return 'full';
    return full ? 'full' : 'mini';
  }

  hardDrop() {
    if (!this.piece || this.toppedOut || this.clearing) return { dist: 0 };
    const from = this.piece.y;
    this.piece = { ...this.piece, y: this.ghostY() };
    const dist = this.piece.y - from;
    if (dist > 0) this.lastMoveWasRotation = false;
    const res = this.lock();
    return { ...res, dist };
  }

  // One gravity tick. dtMs advances the lock-delay clock.
  step(dtMs = 0) {
    if (this.toppedOut || this.clearing) return { locked: false, cleared: 0 };
    if (!this.piece) { this.spawn(); return { locked: false, cleared: 0 }; }
    if (!this.controlled) this.#autoNudge();

    if (this.tryMove(0, 1)) {
      this.landed = false;
      return { locked: false, cleared: 0 };
    }
    // resting on the stack — start/continue lock delay
    this.landed = true;
    return { locked: false, cleared: 0, landed: true };
  }

  // Called every frame; owns the lock-delay countdown.
  tickLock(dtMs) {
    if (!this.piece || this.toppedOut || this.clearing) return null;
    const resting = this.collides({ ...this.piece, y: this.piece.y + 1 });
    if (!resting) { this.landed = false; this.lockTimer = 0; return null; }
    this.landed = true;
    this.lockTimer += dtMs;
    if (this.lockTimer >= LOCK_DELAY || this.lockResets >= MAX_LOCK_RESETS && this.lockTimer >= LOCK_DELAY * 0.35) {
      return this.lock();
    }
    return null;
  }

  lock() {
    const tspin = this.#detectTSpin();
    for (const [cx, cy] of this.cells()) {
      if (cy < 0) { this.toppedOut = true; break; }
      this.grid[cy][cx] = this.piece.color;
    }
    const wasControlled = this.controlled;
    this.piece = null;
    this.dirty = true;
    if (this.toppedOut) return { locked: true, cleared: 0, tspin, toppedOut: true };

    const rows = [];
    for (let y = 0; y < ROWS; y++) if (this.grid[y].every(v => v)) rows.push(y);

    const difficult = rows.length >= 4 || (tspin && rows.length > 0);
    let b2bApplied = false;
    if (rows.length > 0) {
      this.combo++;
      b2bApplied = difficult && this.b2b;
      this.b2b = difficult;
    } else {
      this.combo = -1;
      if (!tspin) this.b2b = this.b2b; // a spin with no lines preserves the chain
    }

    if (rows.length) {
      this.clearing = { rows, t0: performance.now(), wasControlled, tspin, b2b: b2bApplied, combo: this.combo };
      return { locked: true, cleared: rows.length, tspin, b2b: b2bApplied, combo: this.combo };
    }
    this.spawn();
    return { locked: true, cleared: 0, tspin };
  }

  // Disposal strategy is pluggable: normally rows vanish and the stack falls;
  // in bankMode (ECLIPSE) they are removed but counted, to be paid out later.
  finishClear() {
    if (!this.clearing) return 0;
    const { rows } = this.clearing;
    for (const y of rows) {
      this.grid.splice(y, 1);
      this.grid.unshift(new Array(COLS).fill(0));
    }
    this.lines += rows.length;
    if (this.bankMode) this.banked += rows.length;
    this.clearing = null;
    this.dirty = true;
    this.spawn();
    return rows.length;
  }

  isEmpty() {
    return this.grid.every(row => row.every(v => !v));
  }

  stackHeight() {
    for (let y = 0; y < ROWS; y++) if (this.grid[y].some(v => v)) return ROWS - y;
    return 0;
  }

  holes() {
    let h = 0;
    for (let x = 0; x < COLS; x++) {
      let seen = false;
      for (let y = 0; y < ROWS; y++) {
        if (this.grid[y][x]) seen = true;
        else if (seen) h++;
      }
    }
    return h;
  }

  /* ---------------- autopilot (unattended faces) ---------------- */
  #planAuto() {
    if (this.rng() < 0.13) {
      return { rot: (this.rng() * 4) | 0, x: (this.rng() * (COLS - 2)) | 0 };
    }
    let best = null, bestScore = Infinity;
    for (let i = 0; i < 6; i++) {
      const rot = (this.rng() * 4) | 0;
      const x = (this.rng() * COLS) | 0;
      const p = { ...this.piece, rot, x };
      if (this.collides(p)) continue;
      let drop = { ...p };
      while (!this.collides({ ...drop, y: drop.y + 1 })) drop.y++;
      let maxH = 0, holes = 0;
      const cells = this.cells(drop);
      for (const [cx, cy] of cells) {
        maxH = Math.max(maxH, ROWS - cy);
        if (cy + 1 < ROWS && !this.grid[cy + 1][cx]) {
          if (!cells.some(([ox, oy]) => ox === cx && oy === cy + 1)) holes++;
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
  debugFillBottom(n = 1) {
    for (let i = 0; i < n; i++) {
      const y = ROWS - 1 - i;
      for (let x = 0; x < COLS; x++) this.grid[y][x] = ((x % 7) + 1);
    }
    const rows = [];
    for (let i = 0; i < n; i++) rows.push(ROWS - 1 - i);
    this.combo++;
    this.clearing = { rows, t0: performance.now(), wasControlled: this.controlled, tspin: null, b2b: false, combo: this.combo };
    this.piece = null;
    this.dirty = true;
  }

  debugStack(h = 14) {
    for (let y = ROWS - h; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) this.grid[y][x] = x === COLS - 1 ? 0 : ((x % 7) + 1);
    }
    this.dirty = true;
  }
}
