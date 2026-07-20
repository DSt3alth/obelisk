// OBELISK — the Keeper's record. Everything that survives a run.
import { newlyUnlocked, unlockedCount, FRAGMENTS } from './story.js';

const KEY = 'obelisk_profile_v1';

// Rank is earned by courses laid across every run — the story's own metric
// of complicity, doubling as the progression carrot.
export const RANKS = [
  { at: 0,     name: 'SUPPLICANT' },
  { at: 100,   name: 'ACOLYTE' },
  { at: 300,   name: 'MASON' },
  { at: 700,   name: 'WARDEN' },
  { at: 1500,  name: 'KEEPER' },
  { at: 3000,  name: 'HIGH KEEPER' },
  { at: 6000,  name: 'HIEROPHANT' },
  { at: 12000, name: 'THE SLEEPLESS' },
  { at: 25000, name: "ANSELM'S EQUAL" },
];

const BLANK = {
  runs: 0,
  lifetimeLines: 0,
  lifetimeMs: 0,
  bestMs: 0,
  bestScore: 0,
  bestLines: 0,
  eclipsesUsed: 0,
  tetrises: 0,
  bestCombo: 0,
  fragments: [],
  name: '',
  dailyDone: null,   // 'YYYY-MM-DD' of last completed daily
  dailyBest: {},     // { 'YYYY-MM-DD': {score, lines, ms} }
};

export function load() {
  let p;
  try { p = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { p = null; }
  return { ...BLANK, ...(p || {}), fragments: p?.fragments || [] };
}

export function save(p) {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch {}
}

export function rankOf(lines) {
  let r = RANKS[0], next = null;
  for (let i = 0; i < RANKS.length; i++) {
    if (lines >= RANKS[i].at) { r = RANKS[i]; next = RANKS[i + 1] || null; }
  }
  const span = next ? next.at - r.at : 1;
  const into = next ? lines - r.at : 1;
  return { rank: r, next, progress: next ? Math.min(1, into / span) : 1 };
}

// Fold a finished run into the profile. Returns {profile, unlocked, rankUp}.
export function commitRun(p, run) {
  const before = rankOf(p.lifetimeLines).rank.name;
  p.runs += 1;
  p.lifetimeLines += run.lines;
  p.lifetimeMs += run.ms;
  p.bestMs = Math.max(p.bestMs, run.ms);
  p.bestScore = Math.max(p.bestScore, run.score || 0);
  p.bestLines = Math.max(p.bestLines, run.lines);
  p.eclipsesUsed += run.eclipses || 0;
  p.tetrises += run.tetrises || 0;
  p.bestCombo = Math.max(p.bestCombo, run.bestCombo || 0);

  const unlocked = newlyUnlocked(p);
  unlocked.forEach(f => p.fragments.push(f.id));

  const after = rankOf(p.lifetimeLines).rank.name;
  save(p);
  return { profile: p, unlocked, rankUp: after !== before ? after : null };
}

export function fragmentProgress(p) {
  return { have: unlockedCount(p), total: FRAGMENTS.length };
}

/* ---------------- leaderboards ---------------- */
const LB_MAX = 10;
export const lbKey = m => 'obelisk_lb_' + m;

export function lbLoad(m) {
  try { return JSON.parse(localStorage.getItem(lbKey(m)) || '[]'); } catch { return []; }
}
export function lbSave(m, list) {
  try { localStorage.setItem(lbKey(m), JSON.stringify(list)); } catch {}
}
// Ranked by score now (time is still shown, and breaks ties).
export function lbQualifies(m, score) {
  const list = lbLoad(m);
  return list.length < LB_MAX || score > (list[list.length - 1].score ?? 0);
}
export function lbInsert(m, entry) {
  const list = lbLoad(m);
  list.push(entry);
  list.sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || b.ms - a.ms);
  const trimmed = list.slice(0, LB_MAX);
  lbSave(m, trimmed);
  return trimmed.indexOf(entry);
}

/* ---------------- the daily seal ---------------- */
// One fixed sequence per calendar day, shared by every Keeper. Same pieces,
// same speed, one attempt — the comparison is pure skill.
export function todayKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function dailySeed(key = todayKey()) {
  // FNV-1a over the date string — stable across machines and sessions.
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

// mulberry32 — tiny, fast, good enough for piece sequences.
export function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function dailyDoneToday(p) {
  return p.dailyDone === todayKey();
}
export function markDailyDone(p, result) {
  const k = todayKey();
  p.dailyDone = k;
  const prev = p.dailyBest[k];
  if (!prev || (result.score ?? 0) > (prev.score ?? 0)) p.dailyBest[k] = result;
  save(p);
}
