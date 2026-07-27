// OBELISK — duty levels. Same engine, same rules, different mercy.
// Tuned across: base gravity, how fast the descent ramps with level,
// how often the unattended-face autopilot blunders, how many times a
// lock can be reset by moving, and how many courses ECLIPSE demands.
export const DIFFICULTIES = [
  {
    id: 'mercy', name: 'MERCY', tagline: 'The obelisk is patient. For now.',
    gravityMul: 1.32, rampPow: 0.90, levelEvery: 34000,
    blunderRate: 0.22, lockResets: 15, eclipseMax: 10,
  },
  {
    id: 'duty', name: 'DUTY', tagline: 'The post as written.',
    gravityMul: 1.00, rampPow: 0.86, levelEvery: 30000,
    blunderRate: 0.13, lockResets: 15, eclipseMax: 12,
  },
  {
    id: 'count', name: 'THE COUNT', tagline: 'It is watching more closely now.',
    gravityMul: 0.80, rampPow: 0.82, levelEvery: 25000,
    blunderRate: 0.07, lockResets: 12, eclipseMax: 14,
  },
  {
    id: 'norelief', name: 'NO RELIEF', tagline: '1,000 seated. 0 relieved.',
    gravityMul: 0.65, rampPow: 0.78, levelEvery: 21000,
    blunderRate: 0.03, lockResets: 8, eclipseMax: 16,
  },
];
export const DIFF_ORDER = DIFFICULTIES.map(d => d.id);
const KEY = 'obelisk_difficulty';

export function loadDifficulty() {
  let saved = null;
  try { saved = localStorage.getItem(KEY); } catch {}
  const idx = DIFF_ORDER.indexOf(saved);
  return idx >= 0 ? idx : 1; // default: DUTY
}
export function saveDifficulty(idx) {
  try { localStorage.setItem(KEY, DIFF_ORDER[idx]); } catch {}
}
