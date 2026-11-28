/**
 * Six synthetic songs, rendered as 48 kHz mono audio with their true kick times, the beat grid and
 * the true drop times. Everything is seeded, so every run makes the same audio.
 */

export const SR = 48000;

export interface Song {
  id: string;
  name: string;
  bpm: number;
  seconds: number;
  audio: Float32Array;
  /** Onset times (s) of every kick drum. */
  kicks: number[];
  /** Quarter note times (s) while music plays. */
  grid: number[];
  /** Times (s) a drop truly lands. */
  drops: number[];
  /** Named stretches, for the filmstrip. */
  sections: { from: number; to: number; name: string }[];
  /** Start (s) of the zoomed detail strip. */
  zoomAt: number;
}

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class Mix {
  readonly buf: Float32Array;
  readonly rand: () => number;
  kicks: number[] = [];
  constructor(readonly seconds: number, seed: number) {
    this.buf = new Float32Array(Math.ceil(seconds * SR));
    this.rand = rng(seed);
  }
  private span(t: number, dur: number) {
    const a = Math.max(0, Math.floor(t * SR));
    return [a, Math.min(this.buf.length, a + Math.floor(dur * SR))];
  }
  /** A kick: a falling sine. `soft` gives a slow rise and a rounder body. */
  kick(t: number, amp: number, soft = false) {
    this.kicks.push(t);
    const [a, b] = this.span(t, 0.45);
    let ph = 0;
    for (let i = a; i < b; i++) {
      const x = (i - a) / SR;
      const f = soft ? 48 + 45 * Math.exp(-x / 0.05) : 50 + 110 * Math.exp(-x / 0.03);
      ph += (2 * Math.PI * f) / SR;
      const rise = soft ? Math.min(1, x / 0.012) : Math.min(1, x / 0.001);
      const env = rise * Math.exp(-x / (soft ? 0.2 : 0.13));
      this.buf[i] += amp * env * Math.sin(ph) + (soft ? 0 : amp * 0.3 * (this.rand() * 2 - 1) * Math.exp(-x / 0.002));
    }
  }
  /** A snare: a 190 Hz body and bright noise. */
  snare(t: number, amp: number, tail = 0.1) {
    const [a, b] = this.span(t, 0.35);
    let prev = 0;
    for (let i = a; i < b; i++) {
      const x = (i - a) / SR;
      const n = this.rand() * 2 - 1;
      const hp = n - prev;
      prev = n;
      this.buf[i] += amp * (0.45 * Math.sin(2 * Math.PI * 190 * x) * Math.exp(-x / 0.05) + 0.6 * hp * Math.exp(-x / tail));
    }
  }
  /** A hat: twice differenced noise, so nearly all its energy sits above 6 kHz. */
  hat(t: number, amp: number, open = false) {
    const [a, b] = this.span(t, open ? 0.4 : 0.12);
    let p1 = 0;
    let p2 = 0;
    for (let i = a; i < b; i++) {
      const x = (i - a) / SR;
      const n = this.rand() * 2 - 1;
      const d1 = n - p1;
      p1 = n;
      const d2 = d1 - p2;
      p2 = d1;
      this.buf[i] += amp * 0.5 * d2 * Math.exp(-x / (open ? 0.12 : 0.025));
    }
  }
  /** A saw through a one pole low pass, with a short fade at each end. */
  saw(t: number, dur: number, freq: number, amp: number, cutoff = 400, attack = 0.01) {
    const [a, b] = this.span(t, dur);
    const k = 1 - Math.exp((-2 * Math.PI * cutoff) / SR);
    let y = 0;
    let ph = this.rand();
    for (let i = a; i < b; i++) {
      const x = (i - a) / SR;
      ph = (ph + freq / SR) % 1;
      y += (2 * ph - 1 - y) * k;
      const env = Math.min(1, x / attack, (dur - x) / 0.02);
      this.buf[i] += amp * env * y;
    }
  }
  /** A pad: three detuned saws per note, slow in and out. */
  pad(t: number, dur: number, notes: number[], amp: number) {
    for (const f of notes) for (const d of [-0.004, 0, 0.005]) this.saw(t, dur, f * (1 + d), amp / 3, 1800, 0.4);
  }
  /** A soft piano like chord: decaying sines with two harmonics. */
  keys(t: number, notes: number[], amp: number) {
    const [a, b] = this.span(t, 2.5);
    for (let i = a; i < b; i++) {
      const x = (i - a) / SR;
      const env = Math.min(1, x / 0.005) * Math.exp(-x / 1.1);
      let v = 0;
      for (const f of notes) v += Math.sin(2 * Math.PI * f * x) + 0.4 * Math.sin(4 * Math.PI * f * x) + 0.15 * Math.sin(6 * Math.PI * f * x);
      this.buf[i] += (amp * env * v) / notes.length;
    }
  }
  /** Rising noise for a build. */
  riser(t: number, dur: number, amp: number) {
    const [a, b] = this.span(t, dur);
    let prev = 0;
    for (let i = a; i < b; i++) {
      const x = (i - a) / SR;
      const n = this.rand() * 2 - 1;
      this.buf[i] += amp * Math.pow(x / dur, 2) * (n - prev);
      prev = n;
    }
  }
  /** Scale to a target RMS (dBFS) over the sounding part and soft clip. */
  master(rmsDb: number) {
    let sum = 0;
    let n = 0;
    for (const v of this.buf) if (v !== 0) {
      sum += v * v;
      n++;
    }
    const g = Math.pow(10, rmsDb / 20) / Math.sqrt(sum / Math.max(1, n));
    for (let i = 0; i < this.buf.length; i++) this.buf[i] = this.buf[i] === 0 ? 0 : Math.tanh(this.buf[i] * g);
  }
}

const grid = (from: number, to: number, bpm: number) => {
  const out: number[] = [];
  for (let t = from; t < to - 1e-6; t += 60 / bpm) out.push(+t.toFixed(4));
  return out;
};
const sortKicks = (m: Mix) => m.kicks.sort((a, b) => a - b).map((t) => +t.toFixed(4));

/** Steady four on the floor house, offbeat hats and bass. */
function house(): Song {
  const bpm = 120;
  const q = 60 / bpm;
  const sec = 64;
  const m = new Mix(sec, 1);
  const bassNotes = [55, 55, 65.4, 49];
  for (let i = 0; i * q < sec - 0.5; i++) {
    const t = i * q;
    m.kick(t, 0.9);
    m.hat(t + q / 2, 0.35, true);
    m.hat(t, 0.15);
    if (i % 2 === 1) m.snare(t, 0.45, 0.07);
    m.saw(t + q / 2, q / 2 - 0.02, bassNotes[Math.floor(i / 8) % 4], 0.18, 300);
  }
  for (let bar = 0; bar * 4 * q < sec - 0.5; bar++) m.pad(bar * 4 * q, 4 * q, [220, 277, 330], 0.08);
  m.master(-14);
  return { id: 'house120', name: 'House 120 BPM', bpm, seconds: sec, audio: m.buf, kicks: sortKicks(m), grid: grid(0, sec - 0.5, bpm), drops: [], sections: [{ from: 0, to: sec, name: 'groove' }], zoomAt: 30 };
}

/** Synthwave: soft round kicks under loud constant pads and a sustained sub bass. */
function synthwave(): Song {
  const bpm = 100;
  const q = 60 / bpm;
  const sec = 64;
  const m = new Mix(sec, 2);
  const roots = [55, 43.65, 49, 41.2];
  for (let bar = 0; bar * 4 * q < sec - 0.5; bar++) {
    const t = bar * 4 * q;
    const r = roots[bar % 4];
    m.pad(t, 4 * q, [r * 4, r * 5, r * 6, r * 8], 0.4);
    m.saw(t, 4 * q, r, 0.45, 160, 0.05);
  }
  for (let i = 0; i * q < sec - 0.5; i++) {
    const t = i * q;
    m.kick(t, 0.45, true);
    if (i % 2 === 1) m.snare(t, 0.3, 0.25);
    m.hat(t + q / 2, 0.08);
  }
  m.master(-14);
  return { id: 'synthwave', name: 'Synthwave 100 BPM', bpm, seconds: sec, audio: m.buf, kicks: sortKicks(m), grid: grid(0, sec - 0.5, bpm), drops: [], sections: [{ from: 0, to: sec, name: 'pads + soft kick' }], zoomAt: 20 };
}

/** EDM: a groove, a quiet breakdown, an 8 bar build with a snare roll, a hard drop. */
function edm(): Song {
  const bpm = 128;
  const q = 60 / bpm;
  const bar = 4 * q;
  const s1 = 16 * bar; // groove ends
  const s2 = s1 + 8 * bar; // breakdown ends
  const s3 = s2 + 8 * bar; // build ends: the drop
  const sec = s3 + 16 * bar;
  const m = new Mix(sec, 3);
  const chord = [220, 261.6, 329.6];
  for (let i = 0; i * q < sec - 0.3; i++) {
    const t = i * q;
    if (t < s1) {
      m.kick(t, 0.75);
      m.hat(t + q / 2, 0.25, true);
      if (i % 2 === 1) m.snare(t, 0.35, 0.07);
      m.saw(t + q / 2, q / 2 - 0.02, 55, 0.25, 300);
    } else if (t >= s3) {
      m.kick(t, 1.0);
      m.hat(t + q / 2, 0.4, true);
      m.hat(t + q / 4, 0.2);
      m.hat(t + (3 * q) / 4, 0.2);
      if (i % 2 === 1) m.snare(t, 0.6, 0.08);
      m.saw(t, q - 0.02, 55, 0.5, 600);
    }
  }
  for (let b = 0; b * bar < sec - 0.3; b++) {
    const t = b * bar;
    const loud = t < s1 ? 0.08 : t < s2 ? 0.12 : t < s3 ? 0.1 : 0.15;
    m.pad(t, bar, chord, loud);
  }
  // The build: snares in quarters, then eighths, then sixteenths, getting louder, over a riser.
  for (let b = 0; b < 8; b++) {
    const div = b < 4 ? 1 : b < 6 ? 2 : 4;
    for (let k = 0; k < 4 * div; k++) m.snare(s2 + b * bar + (k * q) / div, 0.12 + 0.05 * b, 0.05);
  }
  m.riser(s2, 8 * bar, 0.25);
  m.master(-13);
  return {
    id: 'edm-drop',
    name: 'EDM 128 BPM breakdown, build, drop',
    bpm,
    seconds: sec,
    audio: m.buf,
    kicks: sortKicks(m),
    grid: grid(0, sec - 0.3, bpm),
    drops: [+s3.toFixed(4)],
    sections: [
      { from: 0, to: s1, name: 'groove' },
      { from: s1, to: s2, name: 'breakdown' },
      { from: s2, to: s3, name: 'build' },
      { from: s3, to: sec, name: 'drop' },
    ],
    zoomAt: s3 - 3,
  };
}

/** A slow 70 BPM ballad: soft kick on 1 and 3, a rim on 2 and 4, piano chords. */
function ballad(): Song {
  const bpm = 70;
  const q = 60 / bpm;
  const sec = 62;
  const m = new Mix(sec, 4);
  const chords = [[261.6, 329.6, 392], [220, 261.6, 329.6], [174.6, 220, 261.6], [196, 246.9, 293.7]];
  for (let i = 0; i * q < sec - 1; i++) {
    const t = i * q;
    if (i % 2 === 0) m.kick(t, 0.5, true);
    else m.snare(t, 0.15, 0.06);
    m.keys(t, chords[Math.floor(i / 4) % 4], 0.25);
    m.hat(t + q / 2, 0.05);
  }
  for (let b = 0; b * 4 * q < sec - 1; b++) m.saw(b * 4 * q, 4 * q, chords[b % 4][0] / 4, 0.25, 200, 0.1);
  m.master(-19);
  return { id: 'ballad70', name: 'Ballad 70 BPM', bpm, seconds: sec, audio: m.buf, kicks: sortKicks(m), grid: grid(0, sec - 1, bpm), drops: [], sections: [{ from: 0, to: sec, name: 'verse' }], zoomAt: 20 };
}

/** Drum and bass at 174 BPM: a two step break, loud sixteenth hats and a reese bass. */
function dnb(): Song {
  const bpm = 174;
  const q = 60 / bpm;
  const bar = 4 * q;
  const sec = 60;
  const m = new Mix(sec, 5);
  for (let b = 0; b * bar < sec - 0.5; b++) {
    const t = b * bar;
    // Kick on 1 and on the "and" of 2; snare on 2 and 4.
    m.kick(t, 0.9);
    m.kick(t + 2.5 * q, 0.85);
    m.snare(t + q, 0.75, 0.09);
    m.snare(t + 3 * q, 0.75, 0.09);
    for (let k = 0; k < 16; k++) m.hat(t + (k * q) / 4, k % 2 ? 0.35 : 0.5);
    m.saw(t, bar, 41.2, 0.3, 500);
    m.saw(t, bar, 41.2 * 1.01, 0.3, 500);
  }
  m.master(-13);
  return { id: 'dnb174', name: 'Drum and bass 174 BPM', bpm, seconds: sec, audio: m.buf, kicks: sortKicks(m), grid: grid(0, sec - 0.5, bpm), drops: [], sections: [{ from: 0, to: sec, name: 'two step' }], zoomAt: 20 };
}

/** A pop groove, six seconds of digital silence, then a new track at another tempo. */
function silenceGap(): Song {
  const sec = 58;
  const m = new Mix(sec, 6);
  const partA = { from: 0, to: 25, bpm: 118 };
  const partB = { from: 31, to: 57.5, bpm: 126 };
  for (const p of [partA, partB]) {
    const q = 60 / p.bpm;
    for (let i = 0; p.from + i * q < p.to - 0.1; i++) {
      const t = p.from + i * q;
      m.kick(t, 0.85);
      if (i % 2 === 1) m.snare(t, 0.45, 0.08);
      m.hat(t + q / 2, 0.25);
      m.saw(t, q - 0.03, i % 8 < 4 ? 55 : 49, 0.3, 280);
    }
    for (let t = p.from; t < p.to - 0.1; t += 4 * q) m.pad(t, Math.min(4 * q, p.to - t), [220, 277, 330], 0.08);
  }
  m.master(-14);
  // The gap must be true digital silence (the capture side turns it into empty events).
  for (let i = Math.floor(partA.to * SR); i < Math.floor(partB.from * SR); i++) m.buf[i] = 0;
  return {
    id: 'silence-gap',
    name: 'Silence gap then restart',
    bpm: partA.bpm,
    seconds: sec,
    audio: m.buf,
    kicks: sortKicks(m),
    grid: [...grid(partA.from, partA.to - 0.1, partA.bpm), ...grid(partB.from, partB.to - 0.1, partB.bpm)],
    drops: [],
    sections: [
      { from: 0, to: 25, name: 'track A 118' },
      { from: 25, to: 31, name: 'silence' },
      { from: 31, to: sec, name: 'track B 126' },
    ],
    zoomAt: 29,
  };
}

export const SONG_MAKERS: Record<string, () => Song> = { house120: house, synthwave, 'edm-drop': edm, ballad70: ballad, dnb174: dnb, 'silence-gap': silenceGap };
