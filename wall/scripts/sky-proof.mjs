// The animated sky's pixel proof. Run after `npm run gallery -- --only="sky proof"`: every page drawn on one canvas
// (`?sky=flat`) and split with the sky layer empty (`?sky=place`: the sky on the main canvas, the ground on a second one
// under the veil) must be the same picture. Reads the stills in `.gallery/` and prints, per pair, how many pixels differ.
//
// The two layouts are the same picture by their sums; the browser blends the layers in 8 bits in a different order, which
// leaves 1 or 2 levels on a share of pixels and a few levels at glows. So the rule is the one the fit check's own
// front-layer proof uses (`sky-seam` in fit-check.mjs): no pixel more than 8 levels off, and at most 1 in 1000 more than 2.
// A missing veil, a seam at the horizon, a lost reflection or a wrong grid moves far more pixels, and further.
//
//   npm --prefix wall run sky-proof
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, '.gallery');
const manifestFile = join(dir, 'manifest.json');
if (!existsSync(manifestFile)) {
  console.error('sky-proof: no .gallery/manifest.json; run `npm run gallery -- --only="sky proof"` first');
  process.exit(2);
}
const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));

/** A small PNG reader: 8-bit RGB or RGBA, not interlaced, as Chromium writes them. */
function readPng(file) {
  const buf = readFileSync(file);
  let at = 8;
  let w = 0;
  let h = 0;
  let ch = 4;
  const idat = [];
  while (at < buf.length) {
    const len = buf.readUInt32BE(at);
    const type = buf.toString('ascii', at + 4, at + 8);
    const data = buf.subarray(at + 8, at + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      ch = data[9] === 6 ? 4 : 3;
    } else if (type === 'IDAT') idat.push(data);
    at += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const px = Buffer.alloc(w * h * ch);
  const stride = w * ch;
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    for (let i = 0; i < stride; i++) {
      const v = raw[y * (stride + 1) + 1 + i];
      const a = i >= ch ? px[y * stride + i - ch] : 0;
      const b = y > 0 ? px[(y - 1) * stride + i] : 0;
      const c = i >= ch && y > 0 ? px[(y - 1) * stride + i - ch] : 0;
      const p = a + b - c;
      const pa = Math.abs(p - a);
      const pb = Math.abs(p - b);
      const pc = Math.abs(p - c);
      const pred = f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      px[y * stride + i] = (v + pred) & 255;
    }
  }
  return { w, h, ch, px };
}

const MAX_WORST = 8;
// Regions: the stage is cut into 8 by 4 blocks (320 by 180), each held to its own count of pixels over 2 levels, so a 1 px seam along
// the ridge, which adds up to little over the whole stage, still fails: it puts about 320 pixels in each block it crosses, against at most 71 seen.
const REGION_W = 320;
const REGION_H = 180;
const REGION_OVER_2 = Number(process.env.SKY_PROOF_REGION_OVER_2 ?? 100);
// A probe on Unwind's open sky (no ridge, no card, no glow), under the veil only: the two layouts must agree within 1 level there.
const PROBE = { x0: 700, y0: 20, x1: 1500, y1: 110, levels: 1 };
const NEAR_LEVELS = 2;
const NEAR_SHARE = 1 / 1000;
const byKey = new Map(manifest.map((m) => [`${m.screen}\0${m.state}`, m]));
let pairs = 0;
let failed = false;
for (const m of manifest) {
  if (!m.state.startsWith('sky proof: one canvas')) continue;
  const split = byKey.get(`${m.screen}\0${m.state.replace('one canvas', 'split, sky layer empty')}`);
  if (!split || m.error || split.error) {
    console.log(`FAIL ${m.screen} ${m.state}: ${split ? 'a still failed to render' : 'its split twin is missing'}`);
    failed = true;
    continue;
  }
  const a = readPng(join(dir, m.file));
  const b = readPng(join(dir, split.file));
  pairs++;
  if (a.w !== b.w || a.h !== b.h) {
    console.log(`FAIL ${m.screen} ${m.state}: the stills differ in size`);
    failed = true;
    continue;
  }
  let any = 0;
  let over = 0;
  let worst = 0;
  const cols = Math.ceil(a.w / REGION_W);
  const regions = new Array(cols * Math.ceil(a.h / REGION_H)).fill(0);
  let probeWorst = 0;
  let box = null;
  for (let y = 0; y < a.h; y++) {
    for (let x = 0; x < a.w; x++) {
      const i = y * a.w + x;
      const d = Math.max(Math.abs(a.px[i * a.ch] - b.px[i * b.ch]), Math.abs(a.px[i * a.ch + 1] - b.px[i * b.ch + 1]), Math.abs(a.px[i * a.ch + 2] - b.px[i * b.ch + 2]));
      if (d > 0) any++;
      if (d > NEAR_LEVELS) {
        over++;
        regions[Math.floor(y / REGION_H) * cols + Math.floor(x / REGION_W)]++;
      }
      if (d > worst) worst = d;
      if (d > MAX_WORST) box = box ? [Math.min(box[0], x), Math.min(box[1], y), Math.max(box[2], x), Math.max(box[3], y)] : [x, y, x, y];
      if (x >= PROBE.x0 && x < PROBE.x1 && y >= PROBE.y0 && y < PROBE.y1 && d > probeWorst) probeWorst = d;
    }
  }
  const regionWorst = Math.max(...regions);
  const probed = m.screen === 'unwind' && m.state === 'sky proof: one canvas';
  const reasons = [];
  if (worst > MAX_WORST) reasons.push(`a pixel is ${worst} levels off (within ${box ? box.join(',') : '?'}; a small box is a moving part caught at two moments, so draw the pair again before suspecting the layers)`);
  if (over > a.w * a.h * NEAR_SHARE) reasons.push(`${over} pixels over ${NEAR_LEVELS} levels`);
  if (regionWorst > REGION_OVER_2) reasons.push(`a block has ${regionWorst} pixels over ${NEAR_LEVELS} levels (limit ${REGION_OVER_2})`);
  if (probed && probeWorst > PROBE.levels) reasons.push(`the open sky probe is ${probeWorst} levels off (limit ${PROBE.levels})`);
  const bad = reasons.length > 0;
  if (bad) failed = true;
  console.log(`${bad ? 'FAIL' : 'ok  '} ${m.screen.padEnd(7)} ${m.state.replace('sky proof: one canvas', 'one canvas against split').trim()}: ${any} of ${a.w * a.h} pixels differ at all, ${over} by more than ${NEAR_LEVELS} levels (${regionWorst} in the worst block), the most ${worst}${probed ? `, open sky probe ${probeWorst}` : ''}${bad ? `; ${reasons.join('; ')}` : ''}`);
}
if (pairs === 0) {
  console.log('FAIL sky-proof: no pairs found in the gallery');
  failed = true;
}
process.exit(failed ? 1 : 0);
