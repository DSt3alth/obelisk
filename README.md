# OBELISK

**Four faces · one survivor.**

Four full games of Tetris fall at once — one on every side of a towering neon
monolith. You command only the face in front of you. Seal a course and the
obelisk *turns*, handing you a different face mid-piece, while the other three
keep filling in the dark.

You are told you are sealing it. You are not.

---

## The duty

- All four faces share one gravity clock. It quickens every 30 seconds.
- Completing a line on **your** face turns the stone to a random other face.
- Unattended faces are worked by a deliberately fallible ghost that slowly
  loses ground. You are the only thing keeping the tower alive.
- If **any** face is overrun, the post is vacant.

## ECLIPSE

Sealing courses charges the **ECLIPSE**. Invoke it (`R-SHIFT`) and time stops
on *all four faces at once* — and the turning comes under your hand. Place at
your own pace, spin freely with `Q`/`E`, and fix whichever face is drowning.

Every course sealed during the stillness is **banked in silence** — nothing
scores, nothing turns. When the Eclipse ends they all resolve at once, named
on the ladder:

`TETRIS` → `BUTTRESS` → `COLONNADE` → `CATHEDRAL` → `MONOLITH` → `ASCENSION`

Invoke it early and bank little; hold out with the stack near the top and bank
everything. It is both the panic valve and the biggest score in the game.

## Modes

| | |
|---|---|
| **RITE** | The duty as written. Every course you seal turns the stone. |
| **SOVEREIGN** | You command the turning yourself with `Q`/`E`. No forced turns, four faces to tend. |
| **DUEL** | Split screen, two Keepers, two obelisks. *Your* courses turn your **rival's** stone. Last one standing. |
| **THE SEAL** | A seeded daily. The same sequence for every Keeper, everywhere, for three minutes. |

## The Record of the Keepers

Twenty fragments across four acts, unlocked by courses laid across every run
and delivered on the death card — never as a wall of text, never blocking play.
Press `C` at the title to read what you've recovered.

The record is gated on *lifetime* work, so it arrives at the same pace whether
you are good at this or not. Being good at this only makes it arrive sooner,
which is the point.

## Controls

| Key | |
|---|---|
| `← →` / `A D` | move |
| `↑` / `X` / `W` | rotate cw |
| `Z` | rotate ccw |
| `↓` / `S` | soft drop |
| `SPACE` | hard drop |
| `C` | hold piece |
| `R-SHIFT` / `F` | invoke ECLIPSE |
| `Q` / `E` | turn the stone *(SOVEREIGN, or during ECLIPSE)* |
| `P` · `M` · `F3` · `F11` | pause · mute · fps · fullscreen |
| `C` · `H` *(at title)* | the Record · handling |

Gamepads are supported — two of them, one per Keeper in DUEL. D-pad/stick to
move, `A`/`B` rotate, `X` hold, `Y` hard drop, triggers for ECLIPSE, bumpers to
turn the stone.

**Handling** (`H` at the title) exposes DAS, ARR and soft-drop rate in
milliseconds, plus ghost piece, grain and camera shake. Tune it before you
complain about the feel.

## Under it

Pure web tech, zero external assets.

- **Engine** — real SRS with the TTC kick tables, 500 ms lock delay with 15
  move resets, T-spin detection by the 3-corner rule (including kick-5
  promotion), 7-bag, hold, 5-deep preview, combo and back-to-back. Guideline
  scoring, so skill transfers from any modern Tetris.
- **Feel** — a hitstop ladder from 30 ms on a bare lock to 250 ms on death,
  trauma-model camera shake (`shake = trauma²`, value noise, rotational), and
  one shared intensity language every event draws from.
- **Honesty** — the near-miss glow only fires on a *true* near-clear. The
  randomiser is never biased, and there is no dynamic difficulty in any scored
  mode. Your score means what it says.
- **Audio** — a fully procedural darksynth score: detuned supersaws, resonant
  filter envelopes, convolution reverb, ping-pong delay, sidechain pumping,
  and stems that enter as the descent quickens. Every sound effect is
  quantised to the A-minor scale, so no input can play a wrong note.
- **Render** — three.js with bloom, a real-time mirror floor, GPU particles,
  shockwave rings, dust, and a custom grade pass doing chromatic aberration,
  grain, vignette and the ECLIPSE desaturation. Only camera-visible faces
  upload their texture each frame, which is what keeps it at 120 fps.

## Build

```
npm install
npx tauri build      # → src-tauri/target/release/obelisk.exe + NSIS installer
```

The game itself is `www/` and runs in any browser — serve the folder, don't
open `file://` (ES modules).

Debug hooks live on `window.QDBG`.
