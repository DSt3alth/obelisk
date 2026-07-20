// OBELISK — scoring. Guideline base values, so skill transfers from any
// modern Tetris, with the obelisk's own names on the big payouts.

export const BASE = {
  1: 100, 2: 300, 3: 500, 4: 800,
};
export const TSPIN = {
  full: { 0: 400, 1: 800, 2: 1200, 3: 1600 },
  mini: { 0: 100, 1: 200, 2: 400, 3: 400 },
};
export const PERFECT = { 1: 800, 2: 1200, 3: 1800, 4: 2000 };

// A cleared course is named. Ordinary play tops out at TETRIS; the ritual
// names only appear when a single ECLIPSE payout lands them all at once.
const LADDER = [
  { at: 20, name: 'ASCENSION',  weight: 1.0 },
  { at: 18, name: 'MONOLITH',   weight: 0.92 },
  { at: 16, name: 'CATHEDRAL',  weight: 0.85 },
  { at: 12, name: 'COLONNADE',  weight: 0.72 },
  { at: 8,  name: 'BUTTRESS',   weight: 0.58 },
  { at: 4,  name: 'TETRIS',     weight: 0.4 },
  { at: 3,  name: 'TRIPLE',     weight: 0.28 },
  { at: 2,  name: 'DOUBLE',     weight: 0.18 },
  { at: 1,  name: 'SINGLE',     weight: 0.1 },
];

export function clearName(n) {
  for (const r of LADDER) if (n >= r.at) return r;
  return null;
}

// Score a single lock-down. Returns {points, label, difficult}.
export function scoreClear({ lines, tspin, b2b, combo, level, perfect }) {
  let points = 0;
  let label = null;
  const lvl = Math.max(1, level);

  if (tspin) {
    points += (TSPIN[tspin][Math.min(3, lines)] || 0);
    label = lines > 0
      ? `${tspin === 'mini' ? 'MINI ' : ''}T-SPIN ${['', 'SINGLE', 'DOUBLE', 'TRIPLE'][Math.min(3, lines)]}`
      : `${tspin === 'mini' ? 'MINI ' : ''}T-SPIN`;
  } else if (lines > 0) {
    points += BASE[Math.min(4, lines)] || 0;
    label = clearName(lines)?.name || null;
  }

  const difficult = lines >= 4 || (tspin && lines > 0);
  if (b2b && difficult) { points = Math.round(points * 1.5); label = 'B2B ' + label; }

  points *= lvl;
  if (combo > 0) points += 50 * combo * lvl;
  if (perfect && lines > 0) points += (PERFECT[Math.min(4, lines)] || 0) * lvl;

  return { points, label, difficult };
}

export function scoreDrop(cells, hard) { return cells * (hard ? 2 : 1); }

// ECLIPSE payout: every course banked during the stillness resolves at once.
// Superlinear so a big bank is worth the risk of holding.
export function scoreEclipse(lines, level) {
  if (lines <= 0) return { points: 0, name: null };
  const r = clearName(lines);
  const points = Math.round(lines * 150 * (1 + lines / 10) * Math.max(1, level));
  return { points, name: r?.name || 'COURSE', weight: r?.weight || 0.2 };
}

export function fmtScore(n) {
  return n.toLocaleString('en-US');
}
