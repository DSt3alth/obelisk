// OBELISK — draws one Board onto its face canvas (used as a CanvasTexture).
import { COLS, ROWS, PIECE_COLORS } from './tetris.js';

export const CELL = 46;
export const PAD_X = 42;
export const PAD_TOP = 118;
export const PAD_BOT = 46;
export const CV_W = COLS * CELL + PAD_X * 2;          // 552
export const CV_H = ROWS * CELL + PAD_TOP + PAD_BOT;  // 1084

const CLEAR_FLASH_MS = 320;

function hexToRgb(hex) {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}
function rgba(hex, a) {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
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

    // "LINES" caption under glyph area (right side holds NEXT box, drawn live)
    c.font = '600 20px "Segoe UI", sans-serif';
    c.fillStyle = 'rgba(220,235,255,0.4)';
    c.fillText('L I N E S', PAD_X + 96, PAD_TOP / 2 + 22);
    return cv;
  }

  #block(c, px, py, colorIdx, { ghost = false, glow = 1, alpha = 1 } = {}) {
    const color = PIECE_COLORS[colorIdx];
    const s = CELL - 4;
    const x = px + 2, y = py + 2, r = 7;

    c.save();
    c.globalAlpha = alpha;
    c.beginPath();
    c.roundRect(x, y, s, s, r);

    if (ghost) {
      c.strokeStyle = rgba(color, 0.5);
      c.lineWidth = 2;
      c.setLineDash([6, 5]);
      c.stroke();
      c.restore();
      return;
    }

    const g = c.createLinearGradient(x, y, x, y + s);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.18, color);
    g.addColorStop(1, rgba(color, 0.55));
    c.fillStyle = g;
    c.shadowColor = color;
    c.shadowBlur = 14 * glow;
    c.fill();
    c.shadowBlur = 0;

    // inner bevel
    c.beginPath();
    c.roundRect(x + 4, y + 4, s - 8, s - 8, r - 3);
    c.strokeStyle = 'rgba(255,255,255,0.28)';
    c.lineWidth = 2;
    c.stroke();
    c.restore();
  }

  draw(now) {
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
      const mini = 22;
      const baseX = CV_W - PAD_X - 150, baseY = PAD_TOP / 2 - 14;
      const cells = PREVIEW_CELLS[board.nextName];
      const idx = 'IOTSZJL'.indexOf(board.nextName) + 1;
      for (const [cx, cy] of cells) {
        const color = PIECE_COLORS[idx];
        c.fillStyle = rgba(color, 0.9);
        c.shadowColor = color;
        c.shadowBlur = 8;
        c.beginPath();
        c.roundRect(baseX + cx * mini, baseY + cy * mini, mini - 3, mini - 3, 4);
        c.fill();
        c.shadowBlur = 0;
      }
    }

    // settled stack
    for (let y = 0; y < ROWS; y++) {
      const isClearing = board.clearing && board.clearing.rows.includes(y);
      for (let x = 0; x < COLS; x++) {
        const v = board.grid[y][x];
        if (!v) continue;
        if (isClearing) continue; // drawn as flash below
        this.#block(c, wx + x * CELL, wy + y * CELL, v, { glow: 0.55 });
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

    // ghost + active piece
    if (board.piece && !board.toppedOut) {
      if (board.controlled) {
        const gy = board.ghostY();
        for (const [cx, cy] of board.cells({ ...board.piece, y: gy })) {
          if (cy >= 0) this.#block(c, wx + cx * CELL, wy + cy * CELL, board.piece.color, { ghost: true });
        }
      }
      for (const [cx, cy] of board.cells()) {
        if (cy >= 0) this.#block(c, wx + cx * CELL, wy + cy * CELL, board.piece.color, { glow: board.controlled ? 1.4 : 0.8 });
      }
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
