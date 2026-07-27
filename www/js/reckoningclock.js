// OBELISK — THE RECKONING's flashy countdown: a draining radial ring that
// pulses with the beat and colour-ramps from cyan through amber to red as
// the buzzer nears, with a jittering, flashing numeral in the final stretch.
const TAU = Math.PI * 2;
const COOL = [34, 211, 238];
const WARN = [251, 191, 36];
const HOT = [255, 45, 60];

function lerp(a, b, t) { return a + (b - a) * t; }
function lerpColor(c1, c2, t) {
  return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
}
function colorFor(frac) {
  return frac < 0.55 ? lerpColor(COOL, WARN, frac / 0.55) : lerpColor(WARN, HOT, (frac - 0.55) / 0.45);
}

export function createReckoningClock(canvas) {
  const ctx = canvas.getContext('2d');
  const size = canvas.width;
  const cx = size / 2, cy = size / 2;
  const rOuter = size * 0.44;
  let lastWholeSec = -1;
  let flashT = 0;

  return {
    draw({ remainMs, durationMs, beatPulse = 0 }) {
      const remain = Math.max(0, remainMs);
      const elapsedFrac = 1 - remain / durationMs;
      const dangerFrac = Math.min(1, Math.pow(Math.max(0, elapsedFrac), 1.4));
      const [r, g, b] = colorFor(dangerFrac);

      const wholeSec = Math.ceil(remain / 1000);
      if (wholeSec !== lastWholeSec) { lastWholeSec = wholeSec; flashT = 1; }
      flashT = Math.max(0, flashT - 0.055);

      ctx.clearRect(0, 0, size, size);

      // track
      ctx.beginPath();
      ctx.arc(cx, cy, rOuter, 0, TAU);
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.lineWidth = 6;
      ctx.stroke();

      // beat sonar ping
      if (beatPulse > 0.02) {
        ctx.beginPath();
        ctx.arc(cx, cy, rOuter + beatPulse * 15, 0, TAU);
        ctx.strokeStyle = `rgba(${r | 0},${g | 0},${b | 0},${beatPulse * 0.5})`;
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      // remaining-time arc: drains clockwise from 12 o'clock
      const startAngle = -Math.PI / 2;
      const sweep = TAU * Math.max(0, remain / durationMs);
      ctx.beginPath();
      ctx.arc(cx, cy, rOuter, startAngle, startAngle + sweep);
      ctx.strokeStyle = `rgb(${r | 0},${g | 0},${b | 0})`;
      ctx.lineWidth = 7 + dangerFrac * 3;
      ctx.lineCap = 'round';
      ctx.shadowColor = ctx.strokeStyle;
      ctx.shadowBlur = 14 + dangerFrac * 22 + flashT * 20;
      ctx.stroke();
      ctx.shadowBlur = 0;

      // numeral, jittering and flashing as the buzzer nears
      const jitter = dangerFrac > 0.75 ? (Math.random() - 0.5) * dangerFrac * 5 : 0;
      const m = Math.floor(remain / 60000);
      const sec = Math.floor((remain % 60000) / 1000);
      const txt = `${m}:${String(sec).padStart(2, '0')}`;

      ctx.save();
      ctx.translate(cx + jitter, cy + jitter * 0.6);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const fontScale = 1 + flashT * 0.18 + dangerFrac * 0.08;
      ctx.font = `700 ${Math.round(size * 0.22 * fontScale)}px Consolas, monospace`;
      ctx.fillStyle = '#fff';
      ctx.shadowColor = `rgb(${r | 0},${g | 0},${b | 0})`;
      ctx.shadowBlur = 16 + flashT * 26;
      ctx.fillText(txt, 0, size * 0.02);
      ctx.shadowBlur = 0;
      ctx.restore();

      ctx.textAlign = 'center';
      ctx.font = `600 ${Math.round(size * 0.045)}px "Segoe UI", sans-serif`;
      ctx.fillStyle = `rgba(${r | 0},${g | 0},${b | 0},0.78)`;
      ctx.fillText('T H E   R E C K O N I N G', cx, size * 0.87);
    },
  };
}
