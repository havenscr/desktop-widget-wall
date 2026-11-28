/**
 * A port of `src-tauri/src/audio_analysis.rs` (the part that makes `bands`, `bass`, `mid`, `high`):
 * mono samples, a periodic Hann window, a 1024 point FFT, RMS per bin range, 32 log spaced bands from
 * 20 Hz to 16 kHz as bytes over -70 to -10 dB. Same bin tables, same gains.
 */
import { SR } from './songs';

export const FFT_SIZE = 1024;
const BAND_COUNT = 32;
const BAND_DB_FLOOR = -70;
const BAND_DB_CEIL = -10;
const GAINS = { bass: 3.5, mid: 3.5, high: 9 };

interface BinRange { start: number; end: number; scale: number }

function binRange(lo: number, hi: number): BinRange {
  const binHz = SR / FFT_SIZE;
  const ny = FFT_SIZE / 2;
  const start = Math.min(ny, Math.max(1, Math.ceil(lo / binHz)));
  const end = Math.min(ny + 1, Math.max(1, Math.ceil(hi / binHz)));
  if (end > start) return { start, end, scale: 1 };
  const bin = Math.min(ny, Math.max(1, Math.round(Math.sqrt(lo * hi) / binHz)));
  return { start: bin, end: bin + 1, scale: Math.min(1, (hi - lo) / binHz) };
}

const BAND_BINS: BinRange[] = (() => {
  const out: BinRange[] = [];
  const ratio = Math.pow(16000 / 20, 1 / BAND_COUNT);
  let lo = 20;
  for (let i = 0; i < BAND_COUNT; i++) {
    const hi = lo * ratio;
    out.push(binRange(lo, hi));
    lo = hi;
  }
  return out;
})();
const BASS_BINS = binRange(20, 250);
const MID_BINS = binRange(250, 4000);
const HIGH_BINS = binRange(4000, 16000);

const WINDOW = Float64Array.from({ length: FFT_SIZE }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / FFT_SIZE));
const POWER_NORM = 2 / (FFT_SIZE * WINDOW.reduce((t, w) => t + w * w, 0));

const re = new Float64Array(FFT_SIZE);
const im = new Float64Array(FFT_SIZE);
const power = new Float64Array(FFT_SIZE / 2 + 1);

function fft() {
  const n = FFT_SIZE;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const wr = Math.cos(ang * k);
        const wi = Math.sin(ang * k);
        const a = i + k;
        const b = a + len / 2;
        const xr = re[b] * wr - im[b] * wi;
        const xi = re[b] * wi + im[b] * wr;
        re[b] = re[a] - xr;
        im[b] = im[a] - xi;
        re[a] += xr;
        im[a] += xi;
      }
    }
  }
}

export interface AnalyzerFrame {
  /** 32 bytes, or empty for silence. */
  bands: number[];
  bass: number;
  mid: number;
  high: number;
  silent: boolean;
}

/** Analyse the newest `FFT_SIZE` samples ending at sample `end`. */
export function analyse(audio: Float32Array, end: number): AnalyzerFrame {
  const from = end - FFT_SIZE;
  let peak = 0;
  for (let i = Math.max(0, from); i < end; i++) peak = Math.max(peak, Math.abs(audio[i] ?? 0));
  if (peak < 1e-5) return { bands: [], bass: 0, mid: 0, high: 0, silent: true };
  for (let i = 0; i < FFT_SIZE; i++) {
    const k = from + i;
    re[i] = (k >= 0 && k < audio.length ? audio[k] : 0) * WINDOW[i];
    im[i] = 0;
  }
  fft();
  for (let k = 0; k <= FFT_SIZE / 2; k++) power[k] = re[k] * re[k] + im[k] * im[k];
  const rms = (r: BinRange) => {
    let p = 0;
    for (let k = r.start; k < r.end; k++) p += power[k];
    return Math.sqrt(p * POWER_NORM * r.scale);
  };
  const bands = BAND_BINS.map((r) => {
    const db = 20 * Math.log10(Math.max(rms(r), 1e-9));
    const t = (db - BAND_DB_FLOOR) / (BAND_DB_CEIL - BAND_DB_FLOOR);
    return Math.round(Math.min(1, Math.max(0, t)) * 255);
  });
  return { bands, bass: Math.min(1, rms(BASS_BINS) * GAINS.bass), mid: Math.min(1, rms(MID_BINS) * GAINS.mid), high: Math.min(1, rms(HIGH_BINS) * GAINS.high), silent: false };
}
