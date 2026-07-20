// OBELISK — draws one Board onto its face canvas (used as a CanvasTexture).
// Blocks are pre-rendered sprites (glow baked in) so every face can redraw at
// full frame rate; the falling piece is drawn at interpolated sub-cell
// positions for silk-smooth motion.
import { COLS, ROWS, PIECE_COLORS } from './tetris.js';

export const CELL = 46;
export const PAD_X = 42;
export const PAD_TOP = 118;
export const PAD_BOT = 46;
export const CV_W = COLS * CELL + PAD_X * 2;          // 552
export const CV_H = ROWS * CELL + PAD_TOP + PAD_BOT;  // 1084

const CLEAR_FLASH_MS = 320;
const GLOW = 18; // sprite padding so baked glow isn't clipped

function hexToRgb(hex) {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}
function rgba(hex, a) {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

/* ---------------- block sprite cache ---------------- */
let SPRITES = null;

function mkSprite(colorIdx, glow) {
  const color = PIECE_COLORS[colorIdx];
  const s = CELL - 4;
  const cv = document.createElement('canvas');
  cv.width = cv.height = CELL + GLOW * 2;
  const c = cv.getContext('2d');
  const x = GLOW + 2, y = GLOW + 2, r = 7;

  c.beginPath();
  c.roundRect(x, y, s, s, r);
  const g = c.createLinearGradient(x, y, x, y + s);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.18, color);
  g.addColorStop(1, rgba(color, 0.55));
  c.fillStyle = g;
  c.shadowColor = color;
  c.shadowBlur = 14 * glow;
  c.fill();
  c.shadowBlur = 0;

  c.beginPath();
  c.roundRect(x + 4, y + 4, s - 8, s - 8, r - 3);
  c.strokeStyle = 'rgba(255,255,255,0.28)';
  c.lineWidth = 2;
  c.stroke();
  return cv;
}

function buildSprites() {
  SPRITES = {};
  for (let i = 1; i <= 7; i++) {
    SPRITES[i] = { stack: mkSprite(i, 0.55), auto: mkSprite(i, 0.85), live: mkSprite(i, 1.5) };
  }
}

export class FaceRenderer {
  constructor(board, faceDef) {
    this.board = board;
    this.def = faceDef; // {glyph, accent}
    this.canvas = document.createElement('canvas');
    this.canvas.width = CV_W;
    this.canvas.height = CV_H;
    this.ctx = this.canvas.getContext('2d');
    this.bg = this.#makeBackground();
    if (!SPRITES) buildSprites();
    this.visX = 0;        // smooth horizontal position of the falling piece
    this.visY = 0;        // smooth vertical position (soft drop glides, not steps)
    this.lastSeq = -1;
  }

  #makeBackground() {
    const cv = document.createElement('canvas');
    cv.width = CV_W; cv.height = CV_H;
    const c = cv.getContext('2d');
    const { accent } = this.def;

    const g = c.createLinearGradient(0, 0, 0, CV_H);
    g.addColorStop(0, '#0b0f1d');
    g.addColorStop(0.5, '#05070f');
    g.addColorStop(1, '#0a0d1a');
    c.fillStyle = g;
    c.fillRect(0, 0, CV_W, CV_H);

    // faint accent aura behind the well
    const rg = c.createRadialGradient(CV_W / 2, CV_H * 0.45, 60, CV_W / 2, CV_H * 0.45, CV_H * 0.7);
    rg.addColorStop(0, rgba(accent, 0.10));
    rg.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = rg;
    c.fillRect(0, 0, CV_W, CV_H);

    // well
    const wx = PAD_X, wy = PAD_TOP, ww = COLS * CELL, wh = ROWS * CELL;
    c.fillStyle = 'rgba(2,3,8,0.85)';
    c.fillRect(wx, wy, ww, wh);

    // grid
    c.strokeStyle = 'rgba(150,180,255,0.055)';
    c.lineWidth = 1;
    c.beginPath();
    for (let x = 1; x < COLS; x++) { c.moveTo(wx + x * CELL, wy); c.lineTo(wx + x * CELL, wy + wh); }
    for (let y = 1; y < ROWS; y++) { c.moveTo(wx, wy + y * CELL); c.lineTo(wx + ww, wy + y * CELL); }
    c.stroke();

    // well frame
    c.strokeStyle = rgba(accent, 0.65);
    c.lineWidth = 3;
    c.shadowColor = accent;
    c.shadowBlur = 18;
    c.strokeRect(wx - 4, wy - 4, ww + 8, wh + 8);
    c.shadowBlur = 0;
    c.strokeStyle = 'rgba(255,255,255,0.12)';
    c.lineWidth = 1;
    c.strokeRect(wx - 8, wy - 8, ww + 16, wh + 16);

    // face glyph, top-left
    c.font = 'italic 700 64px Georgia, serif';
    c.textBaseline = 'middle';
    c.fillStyle = rgba(accent, 0.95);
    c.shadowColor = accent;
    c.shadowBlur = 24;
    c.fillText(this.def.glyph, PAD_X, PAD_TOP / 2 + 4);
    c.shadowBlur = 0;

    c.font = '600 20px "Segoe UI", sans-serif';
    c.fillStyle = 'rgba(220,235,255,0.4)';
    c.fillText('L I N E S', PAD_X + 96, PAD_TOP / 2 + 22);
    return cv;
  }

  // fallFrac: 0..1 progress toward the next gravity row (sub-cell interpolation)
  draw(now, fallFrac = 0, dtSec = 0.016) {
    const { ctx: c, board } = this;
    const { accent } = this.def;
    c.clearRect(0, 0, CV_W, CV_H);
    c.drawImage(this.bg, 0, 0);

    const wx = PAD_X, wy = PAD_TOP;

    // live line count on the face itself
    c.font = '700 58px Consolas, monospace';
    c.textBaseline = 'middle';
    c.fillStyle = '#ffffff';
    c.shadowColor = accent;
    c.shadowBlur = 16;
    c.fillText(String(board.lines), PAD_X + 96, PAD_TOP / 2 - 12);
    c.shadowBlur = 0;

    // NEXT preview, top-right
    c.font = '600 18px "Segoe UI", sans-serif';
    c.fillStyle = 'rgba(220,235,255,0.4)';
    c.fillText('N E X T', CV_W - PAD_X - 150, PAD_TOP / 2 - 30);
    if (board.nextName) {
      const mini = 22, scale = mini / CELL;
      const baseX = CV_W - PAD_X - 150, baseY = PAD_TOP / 2 - 14;
      const cells = PREVIEW_CELLS[board.nextName];
      const idx = 'IOTSZJL'.indexOf(board.nextName) + 1;
      const spr = SPRITES[idx].auto;
      for (const [cx, cy] of cells) {
        c.drawImage(spr, baseX + cx * mini - GLOW * scale, baseY + cy * mini - GLOW * scale, spr.width * scale, spr.height * scale);
      }
    }

    // settled stack
    for (let y = 0; y < ROWS; y++) {
      const isClearing = board.clearing && board.clearing.rows.includes(y);
      if (isClearing) continue;
      const row = board.grid[y];
      for (let x = 0; x < COLS; x++) {
        const v = row[x];
        if (v) c.drawImage(SPRITES[v].stack, wx + x * CELL - GLOW, wy + y * CELL - GLOW);
      }
    }

    // clearing rows: white-hot flash sweeping out
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

    // ghost + falling piece (interpolated for smoothness)
    if (board.piece && !board.toppedOut) {
      const p = board.piece;
      const gy = board.ghostY();
      const targetY = Math.min(p.y + Math.max(0, Math.min(1, fallFrac)), gy);
      if (board.pieceSeq !== this.lastSeq) {
        this.lastSeq = board.pieceSeq;
        this.visX = p.x;
        this.visY = targetY;
      }
      this.visX += (p.x - this.visX) * Math.min(1, dtSec * 26);
      if (Math.abs(p.x - this.visX) < 0.02) this.visX = p.x;

      // vertical: chase the logical position so soft drop GLIDES instead of
      // stepping a whole cell every repeat tick
      this.visY += (targetY - this.visY) * Math.min(1, dtSec * 24);
      if (targetY - this.visY > 0.9) this.visY = targetY - 0.9; // cap the lag
      if (Math.abs(targetY - this.visY) < 0.01) this.visY = targetY;
      this.visY = Math.min(this.visY, gy);

      const dx = (this.visX - p.x) * CELL;
      const dy = (this.visY - p.y) * CELL;

      c.save();
      c.beginPath();
      c.rect(wx - GLOW, wy - 6, COLS * CELL + GLOW * 2, ROWS * CELL + GLOW + 6);
      c.clip();

      if (board.controlled && gy > p.y) {
        for (const [cx, cy] of board.cells({ ...p, y: gy })) {
          if (cy < 0) continue;
          c.beginPath();
          c.roundRect(wx + cx * CELL + 2, wy + cy * CELL + 2, CELL - 4, CELL - 4, 7);
          c.strokeStyle = rgba(PIECE_COLORS[p.color], 0.5);
          c.lineWidth = 2;
          c.setLineDash([6, 5]);
          c.stroke();
          c.setLineDash([]);
        }
      }

      const spr = board.controlled ? 'live' : 'auto';
      for (const [cx, cy] of board.cells()) {
        if (cy * CELL + dy < -CELL) continue;
        c.drawImage(SPRITES[p.color][spr], wx + cx * CELL + dx - GLOW, wy + cy * CELL + dy - GLOW);
      }
      c.restore();
    }

    // danger tint when the stack runs high
    const h = board.stackHeight();
    if (h >= 13 && !board.toppedOut) {
      const a = Math.min(0.4, (h - 12) * 0.06) * (0.7 + 0.3 * Math.sin(now / 160));
      c.fillStyle = `rgba(255,30,40,${a})`;
      c.fillRect(wx, wy, COLS * CELL, 5 * CELL);
    }

    // topped-out shroud
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

// tiny preview shapes (normalized, unit cells)
const PREVIEW_CELLS = {
  I: [[0, 0.5], [1, 0.5], [2, 0.5], [3, 0.5]],
  O: [[1, 0], [2, 0], [1, 1], [2, 1]],
  T: [[1, 0], [0, 1], [1, 1], [2, 1]],
  S: [[1, 0], [2, 0], [0, 1], [1, 1]],
  Z: [[0, 0], [1, 0], [1, 1], [2, 1]],
  J: [[0, 0], [0, 1], [1, 1], [2, 1]],
  L: [[2, 0], [0, 1], [1, 1], [2, 1]],
};
