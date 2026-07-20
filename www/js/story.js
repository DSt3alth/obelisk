// OBELISK — the record of the Keepers.
//
// The premise the player is given: you are a Keeper. Falling matter must be
// fitted into complete courses and sealed into the stone. Hold the four faces.
//
// The premise the player earns: the courses are not a seal. They are masonry.
// Every line ever cleared, by every Keeper, has made the obelisk taller. The
// leaderboard is not a hall of fame — it is a list of everyone who fed it, and
// how long they lasted. "Total lines" is the measure of your complicity.
//
// Fragments unlock against lifetime stats so the story is a slow burn across
// many runs — the Zeigarnik hook that makes the next run feel owed.

export const ACTS = [
  { id: 1, name: 'THE DUTY' },
  { id: 2, name: 'THE DOUBT' },
  { id: 3, name: 'THE COUNT' },
  { id: 4, name: 'THE ASCENT' },
];

// req(profile) -> bool. Kept cheap; evaluated after every run.
const L = n => p => p.lifetimeLines >= n;
const R = n => p => p.runs >= n;
const T = n => p => p.bestMs >= n * 1000;

export const FRAGMENTS = [
  /* ---------------- ACT I — THE DUTY ---------------- */
  { id: 'i1', act: 1, title: 'THE POSTING', req: () => true, text:
    `You are assigned the Obelisk at the turning of the year.\nThe posting is permanent. The duty is simple.\n\nMatter falls. Fit it true. Complete the course.\nA course completed is a course sealed.\n\nDo not let the faces fill.` },

  { id: 'i2', act: 1, title: 'THE FOUR FACES', req: L(20), text:
    `There are four faces and one of you.\n\nThe stone turns when a course is sealed — this is the Obelisk choosing\nwhere you are needed. It has always chosen well.\n\nDo not resent the turning. The turning is a kindness.` },

  { id: 'i3', act: 1, title: 'ON THE MATTER', req: L(60), text:
    `Do not look too long at what falls.\n\nIt is not stone. It does not warm in the hand.\nWhen a course completes, it does not settle — it is *taken*.\n\nThe Keepers before you called this the sealing.\nI have never liked the word.` },

  { id: 'i4', act: 1, title: 'THE HOUR OF THE UNSEEN', req: R(3), text:
    `Three faces stand in darkness at all times.\n\nWhat tends them while you work the fourth?\nThe manual says: nothing. The manual says they wait.\n\nThey do not wait. I have listened. They fill.` },

  { id: 'i5', act: 1, title: 'INSTRUCTION, FINAL LINE', req: L(140), text:
    `The last line of the Keeper's instruction reads:\n\n  "The Obelisk must not be permitted to fall."\n\nIt took me eleven years to notice the sentence is ambiguous,\nand that both readings are being satisfied.` },

  /* ---------------- ACT II — THE DOUBT ---------------- */
  { id: 'ii1', act: 2, title: 'THE MEASURE', req: L(240), text:
    `I have begun to measure it.\n\nAgainst the horizon, against the old marks, against my own hand.\nThe Obelisk is taller this winter than it was last winter.\n\nNo one has brought stone. No mason has come.\nThere is only what falls, and only what I seal.` },

  { id: 'ii2', act: 2, title: 'KEEPER SIGIL, SEVENTH', req: R(6), text:
    `Beneath the eastern face, cut small and low:\n\n  ANSELM · 4,006 COURSES · HELD NINE HOURS\n\nA Keeper's mark. Cut by his own hand, in his last hour,\nwhen he understood he was being counted.\n\nThere are one thousand such marks. Mine will be beneath his.` },

  { id: 'ii3', act: 2, title: 'THE ECLIPSE', req: p => p.eclipsesUsed >= 1, text:
    `Once, when the pressure was greatest, I refused.\n\nI let no course complete. I held them all, uncompleted, waiting —\nand the Obelisk *paused*. The falling stopped. The attention went elsewhere.\n\nIt cannot see you while it is not being fed.\nRemember this. It is the only leverage a Keeper has.` },

  { id: 'ii4', act: 2, title: 'WHAT THE TURNING IS', req: L(400), text:
    `I had it backwards.\n\nThe stone does not turn to show me where I am needed.\nIt turns to show *itself* the face I have just finished.\n\nIt is admiring the work.` },

  { id: 'ii5', act: 2, title: 'THE OTHER SIDE OF THE WALL', req: T(120), text:
    `In the ninth hour I put my ear to the stone.\n\nThere is no voice in it. I want to be clear about that.\nThere is no voice, no whisper, nothing that wants anything.\n\nThere is only a sound like a room being made ready.` },

  /* ---------------- ACT III — THE COUNT ---------------- */
  { id: 'iii1', act: 3, title: 'THE LEDGER', req: L(700), text:
    `I found the ledger in the undercroft. Every Keeper, every course.\n\n  KEEPERS SEATED . . . . . . . . 1,000\n  KEEPERS RELIEVED . . . . . . . . . 0\n  COURSES LAID . . . . . 3,114,922\n\nNot "sealed". The ledger has never used that word.\nThe ledger has always said *laid*.` },

  { id: 'iii2', act: 3, title: 'WHAT A COURSE IS', req: L(1000), text:
    `A course is a row of finished stone.\n\nThat is all it has ever been. Ten across, fitted true, mortared by\nwhatever the Obelisk does in the moment it takes them.\n\nI have laid thousands. I laid them well.\nI was the best mason it ever had and I did not know I was a mason.` },

  { id: 'iii3', act: 3, title: 'THE FAILURE STATE', req: R(12), text:
    `When a face fills, they say the Obelisk falls.\n\nIt does not fall. Nothing falls. The Keeper is simply\nno longer able to lay courses, and is therefore\n\nno longer required.\n\nThe next one is seated by morning. The scaffolding never comes down.` },

  { id: 'iii4', act: 3, title: 'THE HEIGHT', req: L(1600), text:
    `I climbed the inner stair to the top course — mine, laid this hour,\nstill cold from the taking.\n\nFrom there I could see the whole plain, and the old marks,\nand how far below them the ground had gotten.\n\nAnd above me: nothing yet. Only the place where the next course goes.` },

  { id: 'iii5', act: 3, title: 'ANSELM, COMPLETE', req: p => p.lifetimeLines >= 2200 && p.runs >= 15, text:
    `The rest of Anselm's mark, below the ground line, where he had to dig:\n\n  I AM NOT SEALING IT\n  I AM BUILDING IT\n  I CANNOT STOP BUILDING IT\n  IT IS SO CLOSE NOW\n  DO NOT BE GOOD AT THIS` },

  /* ---------------- ACT IV — THE ASCENT ---------------- */
  { id: 'iv1', act: 4, title: 'WHAT IT REACHES FOR', req: L(3000), text:
    `Every tower is built to reach a specific height.\nSomeone knows what that height is. It has never been me.\n\nBut the matter falls from *above*, and it falls with intent,\nand a thing that supplies its own material to be built toward itself\n\nis not a building.\n\nIt is a hand, reaching down, and a hand reaching up,\nand I have spent my life closing the distance.` },

  { id: 'iv2', act: 4, title: 'THE ARGUMENT FOR CONTINUING', req: T(300), text:
    `If I stop, the face fills, and I am relieved, and someone else is seated\nby morning — someone new, someone eager, someone who will lay courses\nfaster than me because they have not yet started counting.\n\nThe only way to slow the Obelisk\nis for someone very good at this\nto stay at the post\nand be very slightly worse on purpose.\n\nI have not been able to do it. Not once. Not for an hour.` },

  { id: 'iv3', act: 4, title: 'THE PLEASURE OF THE WORK', req: L(5000), text:
    `Here is the thing no Keeper writes down.\n\nIt is *good*. Fitting the course true. The moment it completes.\nThe turn of the stone, the light, the sound it makes when it takes them.\n\nThey did not need to compel us. They only needed to make it\nthe most satisfying thing a person could do with their hands,\nand then leave the door open, and count.` },

  { id: 'iv4', act: 4, title: 'KEEPER SIGIL, ONE THOUSAND AND FIRST', req: p => p.lifetimeLines >= 8000, text:
    `Cut small, beneath Anselm's, in a hand you will recognise:\n\n  ————— · ————— COURSES · HELD —————\n\nThe name is not filled in yet. The count is not filled in yet.\nThe chisel is on the sill where you left it.\n\nYou have been filling it in this whole time.` },

  { id: 'iv5', act: 4, title: 'THE TOP COURSE', req: p => p.lifetimeLines >= 12000, text:
    `There is a version of this where you are the one who lays the last course.\n\nYou would know it by the quiet. The matter would stop falling.\nThe faces would stand empty and clean, all four of them,\nand the turning would stop, because there would be nothing left to admire,\nand you would have done what one thousand Keepers could not.\n\nYou would have finished it.\n\nGood morning, Keeper. The matter is falling.\nFit it true.` },
];

// Short lines whispered over the top of play. Never blocking, never a wall of
// text — one line, dissolving, while the player keeps working.
export const WHISPERS = {
  firstClear: ['the course is laid', 'fitted true'],
  combo: ['again', 'you are good at this', 'do not stop'],
  tetris: ['four courses. it is pleased.', 'it takes them all at once'],
  deepDanger: ['the face is filling', 'hold', 'you are alone up here'],
  levelUp: ['faster now', 'it has more to give you', 'the descent quickens'],
  eclipse: ['it cannot see you', 'the attention turns away', 'stillness'],
  eclipseEnd: ['it looks back', 'the taking'],
  longRun: ['how long have you been at the post?', 'no one has come to relieve you'],
  nearDeath: ['no', 'not yet', 'hold the face'],
  gameOver: ['the post is vacant', 'someone is seated by morning', 'the scaffolding stays up'],
};

export function pickWhisper(key) {
  const list = WHISPERS[key];
  if (!list) return null;
  return list[(Math.random() * list.length) | 0];
}

// Which fragments has this profile earned but not yet seen?
export function newlyUnlocked(profile) {
  return FRAGMENTS.filter(f => !profile.fragments.includes(f.id) && f.req(profile));
}

export function fragmentById(id) {
  return FRAGMENTS.find(f => f.id === id);
}

export function unlockedCount(profile) {
  return FRAGMENTS.filter(f => profile.fragments.includes(f.id)).length;
}
