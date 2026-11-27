/**
 * The filmstrip: time across, and from the top: section names, beat markers (true kicks, the beat
 * grid, detected beats, true and detected drops), a spectrogram of the 32 bands, the bass and high
 * envelopes, then one lane per Play and per panel. Each lane shows the colour sent (brightness
 * included) on top and the brightness scalar as a bar below, with the floor and cap as lines.
 * A zoomed strip of six seconds follows, five times wider, to read lag and pulse shape.
 */
import { Raster, type Rgb8 } from './png';
import type { RunResult, Tick } from './sim';
import type { Metrics } from './metrics';

const LANE_NAMES = ['FAR LEFT  (HIGHS)', 'LEFT  (BASS)', 'RIGHT  (BASS)', 'FAR RIGHT  (HIGHS)'];
const LABEL_W = 150;
const COL = {
  kick: [255, 255, 255] as Rgb8,
  grid: [110, 110, 130] as Rgb8,
  det: [60, 220, 255] as Rgb8,
  drop: [255, 70, 70] as Rgb8,
  ddrop: [255, 220, 60] as Rgb8,
  floor: [255, 80, 80] as Rgb8,
  cap: [120, 255, 120] as Rgb8,
  text: [220, 220, 235] as Rgb8,
  dim: [140, 140, 160] as Rgb8,
};
const to8 = (c: number[]): Rgb8 => [Math.round(c[0] * 255), Math.round(c[1] * 255), Math.round(c[2] * 255)];

function heat(v: number): Rgb8 {
  const x = Math.min(1, Math.max(0, v));
  return [Math.round(255 * Math.min(1, x * 1.6)), Math.round(255 * Math.max(0, x * 1.6 - 0.6)), Math.round(255 * Math.max(0, 0.5 - Math.abs(x - 0.3)) * 1.4)];
}

interface Strip {
  y: number;
  ticks: Tick[];
  px: number;
  t0: number;
}

function drawStrip(img: Raster, r: RunResult, st: Strip, title: string): number {
  const { ticks, px, t0 } = st;
  let y = st.y;
  const X = (t: number) => LABEL_W + ((t - t0) / (ticks[1].t - ticks[0].t)) * px;
  const t1 = ticks[ticks.length - 1].t;
  const inside = (t: number) => t >= t0 && t <= t1;
  img.text(8, y, title, COL.text, 2);
  y += 22;
  // Seconds axis and sections.
  for (let s = Math.ceil(t0 / 1000); s * 1000 <= t1; s++) {
    const x = X(s * 1000);
    const major = px > 1 || s % 5 === 0;
    img.rect(x, y, 1, major ? 8 : 4, COL.dim);
    if (major) img.text(x + 2, y, String(s), COL.dim);
  }
  y += 12;
  for (const sec of r.song.sections) {
    const a = Math.max(t0, sec.from * 1000);
    const b = Math.min(t1, sec.to * 1000);
    if (b <= a) continue;
    img.rect(X(a), y, X(b) - X(a), 10, [40, 40, 60]);
    img.rect(X(a), y, 1, 10, COL.dim);
    img.text(X(a) + 3, y + 2, sec.name, COL.text);
  }
  y += 14;
  // Markers.
  img.text(8, y + 2, 'TRUE KICK / GRID', COL.text);
  for (const g of r.song.grid) if (inside(g * 1000)) img.rect(X(g * 1000), y + 12, 1, 3, COL.grid);
  for (const k of r.song.kicks) if (inside(k * 1000)) img.rect(X(k * 1000), y, Math.max(1, px / 2), 11, COL.kick);
  y += 16;
  img.text(8, y + 2, 'DETECTED BEAT', COL.det);
  for (const k of ticks) if (k.beat) {
    img.rect(X(k.t), y, Math.max(1, px / 2), 11, COL.det);
    if (px > 1) img.rect(X(k.onset), y + 4, Math.max(1, X(k.t) - X(k.onset)), 1, COL.det);
  }
  y += 16;
  img.text(8, y + 2, 'DROP TRUE/FIRED', COL.text);
  for (const d of r.song.drops) if (inside(d * 1000)) img.rect(X(d * 1000), y, 3, 12, COL.drop);
  for (const d of r.drops) if (inside(d.t)) img.rect(X(d.t) + 3, y, 3, 12, COL.ddrop);
  y += 16;
  // Spectrogram: band 0 at the bottom.
  img.text(8, y + 12, 'BANDS 0..31', COL.text);
  for (let i = 0; i < ticks.length; i++) {
    const b = ticks[i].bands;
    for (let j = 0; j < 32; j++) img.rect(X(ticks[i].t), y + (31 - j), px, 1, heat(b.length ? b[j] / 255 : 0));
  }
  y += 36;
  // Envelopes.
  img.text(8, y + 4, 'BASS ENV', [255, 140, 60]);
  img.text(8, y + 16, 'HIGH ENV', [120, 200, 255]);
  img.rect(LABEL_W, y, ticks.length * px, 30, [22, 22, 30]);
  for (let i = 1; i < ticks.length; i++) {
    const a = ticks[i - 1];
    const k = ticks[i];
    img.line(X(a.t), y + 29 - a.bassEnv * 29, X(k.t), y + 29 - k.bassEnv * 29, [255, 140, 60]);
    img.line(X(a.t), y + 29 - a.highEnv * 29, X(k.t), y + 29 - k.highEnv * 29, [120, 200, 255]);
    img.line(X(a.t), y + 29 - a.energy * 29, X(k.t), y + 29 - k.energy * 29, [200, 200, 200], 0.5);
  }
  y += 36;
  // Light lanes.
  const lane = (name: string, colour: (k: Tick) => number[], b: (k: Tick) => number) => {
    img.text(8, y + 6, name, COL.text);
    for (const k of ticks) img.rect(X(k.t), y, px, 16, to8(colour(k)));
    const by = y + 17;
    img.rect(LABEL_W, by, ticks.length * px, 16, [22, 22, 30]);
    for (const k of ticks) {
      const h = b(k) * 16;
      img.rect(X(k.t), by + 16 - h, px, h, [190, 190, 205]);
    }
    img.rect(LABEL_W, by + 16 - r.floor * 16, ticks.length * px, 1, COL.floor, 0.8);
    img.rect(LABEL_W, by + 16 - r.brightness * 16, ticks.length * px, 1, COL.cap, 0.6);
    y += 37;
  };
  for (let i = 0; i < 4; i++) lane(LANE_NAMES[i], (k) => k.plays[i], (k) => k.playB[i]);
  y += 4;
  const np = ticks[0].panels.length;
  for (let i = 0; i < np; i++) lane(`PANEL ${i + 1}${i === Math.floor(np / 2) ? ' (CENTRE)' : ''}`, (k) => k.panels[i], (k) => k.panelB[i]);
  return y + 10;
}

export function filmstrip(r: RunResult, m: Metrics, layoutName: string): Buffer {
  const all = r.ticks;
  const zoomT0 = r.song.zoomAt * 1000;
  const zoom = all.filter((k) => k.t >= zoomT0 && k.t < zoomT0 + 6000);
  const zpx = 5;
  const width = LABEL_W + Math.max(all.length, zoom.length * zpx) + 20;
  const stripH = 22 + 12 + 14 + 48 + 36 + 36 + 9 * 37 + 4 + 10;
  const img = new Raster(width, 70 + 2 * stripH + 20);
  img.text(8, 8, `${r.song.name}  |  ${r.preset.toUpperCase()}  |  PANELS: ${layoutName}`, COL.text, 2);
  img.text(8, 30, `HIT ${Math.round(m.hitRate * 100)}%  REACT ${m.reactMs.toFixed(0)} MS  FALSE ${m.falsePerMin.toFixed(1)}/MIN  INNER B ${m.innerMin.toFixed(2)}..${m.innerMax.toFixed(2)}  AT PEAK ${Math.round(m.atPeak * 100)}%  COLOUR ${m.colourPerMin.toFixed(1)}/MIN  DROPS ${r.drops.length}  PLAY/PANEL CORR ${m.corr.toFixed(2)} LAG ${m.lagMs.toFixed(0)} MS`, COL.dim);
  img.text(8, 44, 'KEY: WHITE TRUE KICK, GREY GRID, CYAN DETECTED (LINE BACK TO ONSET), RED TRUE DROP, YELLOW FIRED DROP. LANE: TOP COLOUR SENT, BOTTOM BRIGHTNESS, RED FLOOR, GREEN CAP.', COL.dim);
  let y = drawStrip(img, r, { y: 62, ticks: all, px: 1, t0: 0 }, 'WHOLE SONG (1 PX = 20 MS)');
  drawStrip(img, r, { y, ticks: zoom, px: zpx, t0: zoomT0 }, `ZOOM ${(zoomT0 / 1000).toFixed(1)} S TO ${(zoomT0 / 1000 + 6).toFixed(1)} S (1 PX = 4 MS)`);
  return img.png();
}
