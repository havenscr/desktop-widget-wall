import type { LinesSettings } from './linesSettings';
import type { SkyBox } from './sky';

const BANDS = 32;
const COLS = BANDS * 2;
const peakY = new Float32Array(COLS);
const peakV = new Float32Array(COLS);
const dotY = new Float32Array(COLS);
const dotV = new Float32Array(COLS);
const dotJ = new Float32Array(COLS);
const dotR = new Float32Array(COLS);
let seed = 20261113;
const rnd = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
for (let i = 0; i < COLS; i++) { dotJ[i] = (rnd() - 0.5) * 12; dotR[i] = 3.4 + rnd() * 2; }

const PALETTES: Record<Exclude<LinesSettings['colours'], 'look'>, readonly number[][]> = {
  floor: [[255, 176, 84], [255, 92, 150], [84, 214, 255]],
  sunset: [[255, 196, 96], [255, 132, 96], [255, 72, 150]],
  ice: [[120, 170, 255], [224, 240, 255], [150, 200, 255]],
  mint: [[110, 240, 170], [84, 236, 214], [64, 200, 255]],
};
const DEFAULT_PALETTE = [[92, 196, 255], [56, 236, 240], [255, 61, 154]];
const RIBBON_TRAILS = [[0.5, 0.8, 0.16, 1.5], [0.25, 0.9, 0.3, 2]];
const smooth = (x: number) => { const v = Math.max(0, Math.min(1, x)); return v * v * (3 - 2 * v); };
const edge = (x: number, cx: number, hs: number) => { const u = Math.abs(x - cx) / hs; return u >= 1 ? 0 : u < 0.62 ? 1 : 1 - smooth((u - 0.62) / 0.38); };
const mix = (a: number[], b: number[], t: number) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const rgba = (c: number[], a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

export interface LineTypeOptions {
  settings: LinesSettings;
  sample: (u: number, age: number) => number;
  amp: number;
  cx: number;
  hs: number;
  hy: number;
  scale: number;
  alpha: number;
  kick: number;
  dt: number;
  boxes: readonly SkyBox[];
  tint?: { left: number[]; centre: number[]; right: number[] };
}

function palette(o: LineTypeOptions): readonly number[][] { return o.settings.colours === 'look' ? (o.tint ? [o.tint.left, o.tint.centre, o.tint.right] : DEFAULT_PALETTE) : PALETTES[o.settings.colours]; }
function colourAt(x: number, o: LineTypeOptions): string {
  const c = palette(o), mid = o.cx + (2560 - o.cx) * 0.6;
  if (x <= o.cx) return rgba(mix(c[0], c[1], Math.max(0, x / o.cx)));
  if (x <= mid) return rgba(mix(c[1], mix(c[1], c[2], 0.5), (x - o.cx) / (mid - o.cx)));
  return rgba(mix(mix(c[1], c[2], 0.5), c[2], (x - mid) / (2560 - mid)));
}
function height(u: number, age: number, o: LineTypeOptions): number {
  const raw = Math.max(o.sample(u, age), o.sample(u, age + 0.1) * 0.8, o.sample(u, age + 0.2) * 0.6) * o.amp * 1.7;
  return o.settings.height === 104 ? raw : o.settings.height * Math.tanh(raw / o.settings.height);
}
const colU = (k: number) => (k < BANDS ? BANDS - 1 - k : k - BANDS) / (BANDS - 1);
const colX = (k: number, o: LineTypeOptions) => o.cx + (k < BANDS ? -(BANDS - 1 - k + 0.5) : k - BANDS + 0.5) * (o.hs / BANDS);

function step(o: LineTypeOptions) {
  const fall = Math.pow(4, (o.settings.smooth - 50) / 50);
  const gravity = 520 / (fall * fall);
  for (let k = 0; k < COLS; k++) {
    const x = colX(k, o), h = height(colU(k), 0, o) * (0.25 + 0.75 * edge(x, o.cx, o.hs));
    if (h >= peakY[k]) { peakY[k] = h; peakV[k] = 0; } else { peakV[k] += gravity * 0.35 * o.dt; peakY[k] = Math.max(h, peakY[k] - peakV[k] * o.dt); }
    if (h > dotY[k] + 2) { dotY[k] += (h - dotY[k]) * Math.min(1, o.dt / 0.03); dotV[k] = 0; } else { dotV[k] += gravity * o.dt; dotY[k] = Math.max(0, dotY[k] - dotV[k] * o.dt); }
  }
}
function rounded(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) { ctx.beginPath(); ctx.roundRect(x, y, w, h, [4, 4, 0, 0]); }
function bars(ctx: CanvasRenderingContext2D, o: LineTypeOptions) {
  const w = o.hs / BANDS - 10;
  for (let k = 0; k < COLS; k++) { const x = colX(k, o), e = 0.25 + 0.75 * edge(x, o.cx, o.hs), h = 3 + height(colU(k), 0, o) * e; ctx.fillStyle = colourAt(x, o); ctx.globalAlpha = o.alpha * 0.42 * e; rounded(ctx, x - w / 2, o.hy - h, w, h); ctx.fill(); ctx.globalAlpha = o.alpha * 0.95 * e; ctx.fillRect(x - w / 2, o.hy - h, w, 3); if (peakY[k] > h + 4) { ctx.globalAlpha = o.alpha * 0.8 * e; ctx.fillRect(x - w / 2, o.hy - peakY[k] - 6, w, 2.5); } }
}
function ribbonPath(ctx: CanvasRenderingContext2D, o: LineTypeOptions, age: number, gain: number) { ctx.beginPath(); for (let x = o.cx - o.hs; x <= o.cx + o.hs; x += 6) { const u = Math.abs(x - o.cx) / o.hs, y = o.hy - 2 - height(u, age, o) * gain * (0.2 + 0.8 * edge(x, o.cx, o.hs)) * smooth((1 - u) * 6); if (x === o.cx - o.hs) ctx.moveTo(x, y); else ctx.lineTo(x, y); } }
function ribbon(ctx: CanvasRenderingContext2D, o: LineTypeOptions) { ctx.lineJoin = 'round'; ctx.lineCap = 'round'; for (let i = 0; i < RIBBON_TRAILS.length; i++) { const t = RIBBON_TRAILS[i]; ribbonPath(ctx, o, t[0], t[1]); ctx.strokeStyle = colourAt(o.cx, o); ctx.globalAlpha = o.alpha * t[2]; ctx.lineWidth = t[3]; ctx.stroke(); } ribbonPath(ctx, o, 0, 1); ctx.strokeStyle = colourAt(o.cx, o); ctx.globalAlpha = o.alpha; ctx.lineWidth = 2.6 + o.kick * 1.8; ctx.shadowBlur = 9; ctx.shadowColor = colourAt(o.cx, o); ctx.stroke(); ctx.shadowBlur = 0; }
function sparks(ctx: CanvasRenderingContext2D, o: LineTypeOptions) { for (let k = 0; k < COLS; k++) { const x = colX(k, o) + dotJ[k], e = edge(x, o.cx, o.hs), y = o.hy - 3 - dotY[k]; ctx.fillStyle = colourAt(x, o); ctx.globalAlpha = o.alpha * (0.3 + 0.7 * e); ctx.beginPath(); ctx.arc(x, y, dotR[k], 0, Math.PI * 2); ctx.fill(); for (let j = 1; j <= 2; j++) { ctx.globalAlpha *= 0.4; ctx.beginPath(); ctx.arc(x, y + j * 7, dotR[k] * (1 - j * 0.22), 0, Math.PI * 2); ctx.fill(); } } }
function skyline(ctx: CanvasRenderingContext2D, o: LineTypeOptions) { const pitch = o.hs / BANDS, w = pitch * 2 - 5; for (let k = 0; k < BANDS; k++) { const x = o.cx + (k - BANDS / 2 + 0.5) * pitch * 2, e = edge(x, o.cx, o.hs), h = Math.max(4, Math.floor(height(Math.abs(x - o.cx) / o.hs, 0, o) * e / 12) * 12); ctx.fillStyle = colourAt(x, o); ctx.globalAlpha = o.alpha * 0.38 * e; ctx.fillRect(x - w / 2, o.hy - h, w, h); ctx.globalAlpha = o.alpha * 0.95 * e; ctx.fillRect(x - w / 2, o.hy - h, w, 3); } }

/** Draw one non-mountain type. State is preallocated and the picture boxes are clipped out. */
export function drawLineType(ctx: CanvasRenderingContext2D, o: LineTypeOptions): void {
  if (o.settings.type === 'mountains' || o.alpha <= 0.001) return;
  step(o); ctx.save(); ctx.setTransform(o.scale, 0, 0, o.scale, 0, 0); ctx.beginPath(); ctx.rect(0, 0, 2560, o.hy + 1); for (let i = 0; i < o.boxes.length; i++) { const b = o.boxes[i]; ctx.rect(b[0] - 2, b[1] - 2, b[2] + 4, b[3] + 4); } ctx.clip('evenodd'); ctx.globalCompositeOperation = 'lighter';
  if (o.settings.type === 'bars') bars(ctx, o); else if (o.settings.type === 'ribbon') ribbon(ctx, o); else if (o.settings.type === 'sparks') sparks(ctx, o); else skyline(ctx, o);
  ctx.restore();
}
