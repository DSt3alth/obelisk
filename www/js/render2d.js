// OBELISK — draws one Board onto its face canvas (used as a CanvasTexture).
// Block sprites are pre-baked with layered crystal glass, internal refraction and
// restrained bloom so every visible face can still redraw at display refresh.
import { COLS, ROWS, PIECE_COLORS, LOCK_DELAY } from './tetris.js';

export const CELL = 46;
export const PAD_X = 42;
export const PAD_TOP = 182;
export const PAD_BOT = 62;
export const CV_W = COLS * CELL + PAD_X * 2;
export const CV_H = ROWS * CELL + PAD_TOP + PAD_BOT;

const CLEAR_FLASH_MS = 320;
const GLOW = 22;

function rgba(hex, a) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${a})`;
}

function roundedRect(c, x, y, w, h, r) {
  c.beginPath();
  c.roundRect(x, y, w, h, r);
}

/* ---------------- sprite cache ---------------- */
let SPRITES = null;

function mkSprite(colorIdx, glow, size = CELL) {
  const color = PIECE_COLORS[colorIdx];
  const s = size - 6;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size + GLOW * 2;
  const c = cv.getContext('2d');
  const x = GLOW + 3;
  const y = GLOW + 3;
  const r = Math.max(5, size * 0.16);

  // Wide aura: subtle for settled blocks, stronger for live pieces.
  c.save();
  c.shadowColor = color;
  c.shadowBlur = 18 * glow;
  c.fillStyle = rgba(color, 0.34);
  roundedRect(c, x, y, s, s, r);
  c.fill();
  c.restore();

  // Dark translucent glass body.
  const body = c.createLinearGradient(x, y, x + s, y + s);
  body.addColorStop(0, 'rgba(255,255,255,0.72)');
  body.addColorStop(0.10, rgba(color, 0.78));
  body.addColorStop(0.42, rgba(color, 0.36));
  body.addColorStop(0.72, rgba(color, 0.18));
  body.addColorStop(1, rgba(color, 0.58));
  c.fillStyle = body;
  roundedRect(c, x, y, s, s, r);
  c.fill();

  // Internal depth tint.
  const depth = c.createRadialGradient(
    x + s * 0.34, y + s * 0.24, 1,
    x + s * 0.52, y + s * 0.55, s * 0.72,
  );
  depth.addColorStop(0, 'rgba(255,255,255,0.48)');
  depth.addColorStop(0.28, rgba(color, 0.14));
  depth.addColorStop(1, 'rgba(0,0,0,0.36)');
  c.fillStyle = depth;
  roundedRect(c, x + 2, y + 2, s - 4, s - 4, Math.max(2, r - 2));
  c.fill();

  // Crystal bevel.
  const edge = c.createLinearGradient(x, y, x + s, y + s);
  edge.addColorStop(0, 'rgba(255,255,255,0.98)');
  edge.addColorStop(0.28, rgba(color, 0.82));
  edge.addColorStop(0.68, rgba(color, 0.44));
  edge.addColorStop(1, 'rgba(255,255,255,0.78)');
  c.strokeStyle = edge;
  c.lineWidth = Math.max(2, size * 0.065);
  roundedRect(c, x + 1, y + 1, s - 2, s - 2, r);
  c.stroke();

  // Inset bevel.
  c.strokeStyle = 'rgba(255,255,255,0.30)';
  c.lineWidth = 1.4;
  roundedRect(c, x + 5, y + 5, s - 10, s - 10, Math.max(2, r - 4));
  c.stroke();

  // Faceted diagonals give the blocks a cut-gem silhouette.
  c.save();
  c.strokeStyle = 'rgba(255,255,255,0.24)';
  c.lineWidth = 1;
  c.beginPath();
  c.moveTo(x + 6, y + 6);
  c.lineTo(x + s * 0.50, y + s * 0.50);
  c.lineTo(x + s - 6, y + 6);
  c.moveTo(x + 6, y + s - 6);
  c.lineTo(x + s * 0.50, y + s * 0.50);
  c.lineTo(x + s - 6, y + s - 6);
  c.stroke();
  c.restore();

  // Top-left specular streak.
  const shine = c.createLinearGradient(x + 5, y + 5, x + s * 0.76, y + s * 0.58);
  shine.addColorStop(0, 'rgba(255,255,255,0.95)');
  shine.addColorStop(0.16, 'rgba(255,255,255,0.46)');
  shine.addColorStop(0.42, 'rgba(255,255,255,0.05)');
  shine.addColorStop(1, 'rgba(255,255,255,0)');
  c.strokeStyle = shine;
  c.lineWidth = Math.max(2, size * 0.06);
  c.beginPath();
  c.moveTo(x + 8, y + s * 0.28);
  c.quadraticCurveTo(x + s * 0.28, y + 4, x + s * 0.62, y + 7);
  c.stroke();

  // Small hot glint to sell polished glass.
  c.save();
  c.globalCompositeOperation = 'lighter';
  c.fillStyle = 'rgba(255,255,255,0.92)';
  c.shadowColor = '#ffffff';
  c.shadowBlur = 7 + 8 * glow;
  c.beginPath();
  c.arc(x + s * 0.22, y + s * 0.18, Math.max(1.2, size * 0.035), 0, Math.PI * 2);
  c.fill();
  c.restore();

  return cv;
}

function buildSprites() {
  SPRITES = {};
  for (let i = 1; i <= 7; i++) {
    SPRITES[i] = {
      stack: mkSprite(i, 0.46),
      auto: mkSprite(i, 0.72),
      live: mkSprite(i, 1.25),
      inert: (() => {
        const cv = mkSprite(i, 0.16);
        const c = cv.getContext('2d');
        c.globalCompositeOperation = 'saturation';
        c.fillStyle = '#808080';
        c.fillRect(0, 0, cv.width, cv.height);
        c.globalCompositeOperation = 'source-over';
        c.fillStyle = 'rgba(4,7,14,0.36)';
        c.fillRect(0, 0, cv.width, cv.height);
        return cv;
      })(),
    };
  }
}

const MINI = {
  I: { cells: [[0, 1], [1, 1], [2, 1], [3, 1]], w: 4, h: 2 },
  O: { cells: [[1, 0], [2, 0], [1, 1], [2, 1]], w: 4, h: 2 },
  T: { cells: [[1, 0], [0, 1], [1, 1], [2, 1]], w: 3, h: 2 },
  S: { cells: [[1, 0], [2, 0], [0, 1], [1, 1]], w: 3, h: 2 },
  Z: { cells: [[0, 0], [1, 0], [1, 1], [2, 1]], w: 3, h: 2 },
  J: { cells: [[0, 0], [0, 1], [1, 1], [2, 1]], w: 3, h: 2 },
  L: { cells: [[2, 0], [0, 1], [1, 1], [2, 1]], w: 3, h: 2 },
};

export class FaceRenderer {
  constructor(board, faceDef) {
    this.board = board;
    this.def = faceDef;
    this.canvas = document.createElement('canvas');
    this.canvas.width = CV_W;
    this.canvas.height = CV_H;
    this.ctx = this.canvas.getContext('2d');
    this.bg = this.#makeBackground();
    if (!SPRITES) buildSprites();
    this.visX = 0;
    this.visY = 0;
    this.lastSeq = -1;
    this.flashLines = 0;
  }

  #makeBackground() {
    const cv = document.createElement('canvas');
    cv.width = CV_W;
    cv.height = CV_H;
    const c = cv.getContext('2d');
    const { accent } = this.def;

    const g = c.createLinearGradient(0, 0, 0, CV_H);
    g.addColorStop(0, '#07111d');
    g.addColorStop(0.48, '#03070f');
    g.addColorStop(1, '#08111c');
    c.fillStyle = g;
    c.fillRect(0, 0, CV_W, CV_H);

    const rg = c.createRadialGradient(CV_W / 2, CV_H * 0.44, 40, CV_W / 2, CV_H * 0.44, CV_H * 0.68);
    rg.addColorStop(0, rgba(accent, 0.13));
    rg.addColorStop(0.52, rgba(accent, 0.035));
    rg.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = rg;
    c.fillRect(0, 0, CV_W, CV_H);

    const wx = PAD_X;
    const wy = PAD_TOP;
    const ww = COLS * CELL;
    const wh = ROWS * CELL;

    const well = c.createLinearGradient(wx, wy, wx + ww, wy + wh);
    well.addColorStop(0, 'rgba(3,9,18,0.98)');
    well.addColorStop(0.55, 'rgba(1,3,8,0.99)');
    well.addColorStop(1, rgba(accent, 0.055));
    c.fillStyle = well;
    c.fillRect(wx, wy, ww, wh);

    // Faint glass-panel reflection within the playfield.
    const reflection = c.createLinearGradient(wx, wy, wx + ww, wy + wh);
    reflection.addColorStop(0, 'rgba(255,255,255,0.045)');
    reflection.addColorStop(0.18, 'rgba(255,255,255,0.012)');
    reflection.addColorStop(0.50, 'rgba(255,255,255,0)');
    reflection.addColorStop(1, 'rgba(255,255,255,0.018)');
    c.fillStyle = reflection;
    c.fillRect(wx, wy, ww, wh);

    c.strokeStyle = rgba(accent, 0.075);
    c.lineWidth = 1;
    c.beginPath();
    for (let x = 1; x < COLS; x++) {
      c.moveTo(wx + x * CELL, wy);
      c.lineTo(wx + x * CELL, wy + wh);
    }
    for (let y = 1; y < ROWS; y++) {
      c.moveTo(wx, wy + y * CELL);
      c.lineTo(wx + ww, wy + y * CELL);
    }
    c.stroke();

    // Layered frame: coloured energy edge plus bright crystal bevel.
    c.strokeStyle = rgba(accent, 0.78);
    c.lineWidth = 3;
    c.shadowColor = accent;
    c.shadowBlur = 22;
    c.strokeRect(wx - 4, wy - 4, ww + 8, wh + 8);
    c.shadowBlur = 0;
    c.strokeStyle = 'rgba(225,245,255,0.22)';
    c.lineWidth = 1;
    c.strokeRect(wx - 8, wy - 8, ww + 16, wh + 16);
    c.strokeStyle = rgba(accent, 0.24);
    c.strokeRect(wx - 12, wy - 12, ww + 24, wh + 24);

    c.font = 'italic 700 58px Georgia, serif';
    c.textBaseline = 'middle';
    c.fillStyle = rgba(accent, 0.98);
    c.shadowColor = accent;
    c.shadowBlur = 26;
    c.fillText(this.def.glyph, PAD_X, 44);
    c.shadowBlur = 0;

    const boxes = [[PAD_X, 96, 104, 70], [CV_W - PAD_X - 300, 96, 300, 70]];
    for (const [x, y, w, h] of boxes) {
      c.fillStyle = 'rgba(4,10,20,0.42)';
      roundedRect(c, x, y, w, h, 8);
      c.fill();
      c.strokeStyle = 'rgba(255,255,255,0.12)';
      c.lineWidth = 1;
      roundedRect(c, x, y, w, h, 8);
      c.stroke();
      c.strokeStyle = rgba(accent, 0.14);
      roundedRect(c, x + 3, y + 3, w - 6, h - 6, 6);
      c.stroke();
    }

    c.font = '600 11px "Segoe UI", sans-serif';
    c.fillStyle = 'rgba(220,235,255,0.40)';
    c.fillText('H O L D', PAD_X + 6, 88);
    c.fillText('N E X T', CV_W - PAD_X - 294, 88);
    return cv;
  }

  #mini(c, name, cx, cy, cell, alpha = 1, inert = false) {
    const m = MINI[name];
    if (!m) return;
    const idx = 'IOTSZJL'.indexOf(name) + 1;
    const spr = SPRITES[idx][inert ? 'inert' : 'auto'];
    const scale = cell / CELL;
    const ox = cx - (m.w * cell) / 2;
    const oy = cy - (m.h * cell) / 2;
    c.save();
    c.globalAlpha = alpha;
    for (const [bx, by] of m.cells) {
      c.drawImage(spr, ox + bx * cell - GLOW * scale, oy + by * cell - GLOW * scale, spr.width * scale, spr.height * scale);
    }
    c.restore();
  }

  draw(now, fallFrac = 0, dtSec = 0.016, extra = {}) {
    const { ctx: c, board } = this;
    const { accent } = this.def;
    const { eclipse = false, score = 0 } = extra;
    c.clearRect(0, 0, CV_W, CV_H);
    c.drawImage(this.bg, 0, 0);

    const wx = PAD_X;
    const wy = PAD_TOP;

    c.font = '700 46px Consolas, monospace';
    c.textBaseline = 'middle';
    c.textAlign = 'left';
    c.fillStyle = '#ffffff';
    c.shadowColor = accent;
    c.shadowBlur = 16;
    c.fillText(String(board.lines), PAD_X + 84, 42);
    c.shadowBlur = 0;
    c.font = '600 12px "Segoe UI", sans-serif';
    c.fillStyle = 'rgba(220,235,255,0.38)';
    c.fillText('C O U R S E S', PAD_X + 86, 68);

    if (score > 0) {
      c.textAlign = 'right';
      c.font = '700 34px Consolas, monospace';
      c.fillStyle = 'rgba(255,255,255,0.92)';
      c.shadowColor = accent;
      c.shadowBlur = 12;
      c.fillText(score.toLocaleString('en-US'), CV_W - PAD_X, 40);
      c.shadowBlur = 0;
      c.font = '600 11px "Segoe UI", sans-serif';
      c.fillStyle = 'rgba(220,235,255,0.32)';
      c.fillText('S C O R E', CV_W - PAD_X, 64);
      c.textAlign = 'left';
    }

    if (board.hold) this.#mini(c, board.hold, PAD_X + 52, 131, 20, board.holdUsed ? 0.35 : 1, board.holdUsed);

    const prev = board.preview;
    let nx = CV_W - PAD_X - 264;
    prev.forEach((name, i) => {
      const cell = i === 0 ? 19 : 14;
      this.#mini(c, name, nx, 131, cell, i === 0 ? 1 : 0.55 - i * 0.07);
      nx += i === 0 ? 66 : 50;
    });

    for (let y = 0; y < ROWS; y++) {
      if (board.clearing && board.clearing.rows.includes(y)) continue;
      const row = board.grid[y];
      for (let x = 0; x < COLS; x++) {
        const v = row[x];
        if (v) c.drawImage(SPRITES[v].stack, wx + x * CELL - GLOW, wy + y * CELL - GLOW);
      }
    }

    if (board.clearing) {
      const t = Math.min(1, (now - board.clearing.t0) / CLEAR_FLASH_MS);
      for (const y of board.clearing.rows) {
        c.save();
        c.globalAlpha = 1 - t * 0.85;
        c.fillStyle = '#ffffff';
        c.shadowColor = accent;
        c.shadowBlur = 40;
        const inset = t * (COLS * CELL * 0.5);
        c.fillRect(wx + inset, wy + y * CELL + 2, COLS * CELL - inset * 2, CELL - 4);
        c.restore();
      }
    }

    if (board.piece && !board.toppedOut) {
      const p = board.piece;
      const gy = board.ghostY();
      const targetY = Math.min(p.y + Math.max(0, Math.min(1, eclipse ? 0 : fallFrac)), gy);
      if (board.pieceSeq !== this.lastSeq) {
        this.lastSeq = board.pieceSeq;
        this.visX = p.x;
        this.visY = targetY;
      }
      this.visX += (p.x - this.visX) * Math.min(1, dtSec * 26);
      if (Math.abs(p.x - this.visX) < 0.02) this.visX = p.x;
      this.visY += (targetY - this.visY) * Math.min(1, dtSec * 24);
      if (targetY - this.visY > 0.9) this.visY = targetY - 0.9;
      if (Math.abs(targetY - this.visY) < 0.01) this.visY = targetY;
      this.visY = Math.min(this.visY, gy);

      const dx = (this.visX - p.x) * CELL;
      const dy = (this.visY - p.y) * CELL;

      c.save();
      c.beginPath();
      c.rect(wx - GLOW, wy - 6, COLS * CELL + GLOW * 2, ROWS * CELL + GLOW + 6);
      c.clip();

      if (board.controlled && gy > p.y) {
        c.setLineDash([5, 5]);
        c.strokeStyle = rgba(PIECE_COLORS[p.color], 0.62);
        c.lineWidth = 2;
        c.shadowColor = PIECE_COLORS[p.color];
        c.shadowBlur = 8;
        for (const [cx, cy] of board.cells({ ...p, y: gy })) {
          if (cy < 0) continue;
          c.beginPath();
          c.roundRect(wx + cx * CELL + 4, wy + cy * CELL + 4, CELL - 8, CELL - 8, 8);
          c.stroke();
        }
        c.shadowBlur = 0;
        c.setLineDash([]);
      }

      const lockP = board.landed ? Math.min(1, board.lockTimer / LOCK_DELAY) : 0;
      const spr = board.controlled ? 'live' : 'auto';
      for (const [cx, cy] of board.cells()) {
        if (cy * CELL + dy < -CELL) continue;
        c.drawImage(SPRITES[p.color][spr], wx + cx * CELL + dx - GLOW, wy + cy * CELL + dy - GLOW);
      }

      if (lockP > 0.15) {
        c.save();
        c.globalAlpha = (lockP - 0.15) * 0.62 * (0.6 + 0.4 * Math.sin(now / 45));
        c.globalCompositeOperation = 'lighter';
        c.fillStyle = '#ffffff';
        for (const [cx, cy] of board.cells()) {
          if (cy < 0) continue;
          c.beginPath();
          c.roundRect(wx + cx * CELL + dx + 5, wy + cy * CELL + dy + 5, CELL - 10, CELL - 10, 8);
          c.fill();
        }
        c.restore();
      }
      c.restore();
    }

    if (eclipse) {
      c.save();
      c.globalCompositeOperation = 'lighter';
      const pulse = 0.05 + 0.03 * Math.sin(now / 240);
      c.fillStyle = `rgba(120,180,255,${pulse})`;
      c.fillRect(wx, wy, COLS * CELL, ROWS * CELL);
      c.restore();

      const banked = board.banked;
      if (banked > 0) {
        const barH = 5;
        const gap = 2;
        const maxBars = Math.floor((PAD_BOT - 14) / (barH + gap));
        for (let i = 0; i < Math.min(banked, maxBars * 3); i++) {
          const col = Math.floor(i / maxBars);
          const row = i % maxBars;
          const by = CV_H - PAD_BOT + 8 + row * (barH + gap);
          const bw = (COLS * CELL) / 3 - 8;
          c.fillStyle = `rgba(180,230,255,${0.85 - col * 0.2})`;
          c.shadowColor = '#9fe8ff';
          c.shadowBlur = 10;
          c.fillRect(wx + col * (bw + 8), by, bw, barH);
          c.shadowBlur = 0;
        }
      }
    }

    const h = board.stackHeight();
    if (h >= 13 && !board.toppedOut) {
      const a = Math.min(0.4, (h - 12) * 0.06) * (0.7 + 0.3 * Math.sin(now / 160));
      c.fillStyle = `rgba(255,30,40,${a})`;
      c.fillRect(wx, wy, COLS * CELL, 5 * CELL);
    }

    if (board.toppedOut) {
      c.fillStyle = 'rgba(120,0,10,0.55)';
      c.fillRect(wx, wy, COLS * CELL, ROWS * CELL);
      c.font = '700 54px Georgia, serif';
      c.textAlign = 'center';
      c.fillStyle = '#ffd7d7';
      c.shadowColor = '#ff2233';
      c.shadowBlur = 30;
      c.fillText('OVERRUN', CV_W / 2, CV_H / 2);
      c.shadowBlur = 0;
      c.textAlign = 'left';
    }

    board.dirty = false;
  }
}
