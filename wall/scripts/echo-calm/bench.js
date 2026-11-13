// The page `echo-calm-check.mjs` opens: draws the Unwind horizon at 2560 by 720 for 600 frames
// (20 s at 30 fps) with the echo and again without it, feeding the audio store the chosen input,
// and reports what the echo adds to the picture's mean relative luminance, frame by frame.
import { draw } from '../../src/horizon/renderer';
import { CAMERAS, MOON } from '../../src/horizon/cameras';
import { createEchoMotion, createEchoSampler, echoOptions, musicDriving, stepEchoMotion } from '../../src/horizon/echo';
import { audioBands, ingestLevels, resetAudio, tickAudio, useAudioStore } from '../../src/audio/store';
import { loudness, smoothStep } from '../../src/audio/model';
import { demoPayload } from '../../src/audio/capture';

const q = new URLSearchParams(location.search);
const mode = q.get('mode') || 'demo';
const hz = Number(q.get('hz') || 6);
const cam = CAMERAS.unwind;
const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d', { willReadFrequently: true });
const MS = Date.parse('2026-11-11T21:42:00-08:00');
const FRAME = 1000 / 30;

/** Frame at which the `settle` input goes silent (10 s in): playing, then the lines settle and rest. */
const SETTLE_AT = 300;

/** The input: the dev demo levels, or every band pumping fully on and off `hz` times a second. */
function payload(ms, f) {
  if (mode === 'settle') return f < SETTLE_AT ? demoPayload(ms) : null;
  if (mode === 'demo') return demoPayload(ms);
  // A spectrum that never changes: what the echo's own drift does to the brightness.
  if (mode === 'steady') return { bass: 0.5, mid: 0.4, high: 0.2, bands: Array.from({ length: 32 }, (_, i) => 200 - i * 3), waveform: [0.1] };
  const on = Math.floor((ms / 1000) * hz * 2) % 2 === 0;
  return { bass: on ? 0.8 : 0.2, mid: 0.4, high: 0.2, bands: new Array(32).fill(on ? 230 : 110), waveform: [0.1] };
}

const lin = (c) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const LIN = Float64Array.from({ length: 256 }, (_, i) => lin(i));

function run(withEcho) {
  resetAudio();
  const sampler = createEchoSampler();
  let clock = 0;
  for (; clock < 3000; clock += FRAME) {
    ingestLevels(payload(clock, -1), clock);
    tickAudio(clock);
  }
  // The settle input steps the lines as the canvas does: driving, held loudness, the rest motion.
  const motion = createEchoMotion(false);
  let loud = 0;
  const lum = [];
  let T = 0;
  for (let f = 0; f < 600; f++) {
    clock += FRAME;
    T += 1 / 30;
    const p = payload(clock, f);
    if (p) ingestLevels(p, clock);
    tickAudio(clock);
    const o = { W: 2560, H: 720, scale: 1, hy: cam.hy, az0: cam.az0, ppd: cam.ppd, vex: cam.vex, snowDeg: cam.snowDeg, cityScale: cam.cs, vx: cam.vx, ms: MS, t: T, phase: (T * 0.32) % 1, moon: MOON, grain: false };
    if (mode === 'settle') {
      const a = useAudioStore.getState();
      const driving = musicDriving(motion, a.playing, audioBands(), 1 / 30);
      if (driving) loud = smoothStep(loud, loudness(a), 1 / 30);
      stepEchoMotion(motion, driving, 1 / 30);
    }
    if (withEcho) {
      let e;
      if (mode === 'settle') {
        e = echoOptions(cam, 1, loud, T, 1, motion.rest);
        e.drift = motion.drift;
        if (motion.rest < 1) {
          sampler.t = T;
          sampler.w = 1;
          e.sample = sampler.sample;
        }
      } else {
        e = echoOptions(cam, 1, loudness(useAudioStore.getState()), T);
        sampler.t = T;
        sampler.w = 1;
        e.sample = sampler.sample;
      }
      if (q.get('tint') === '0') delete e.tint;
      o.echo = e;
    }
    draw(ctx, o);
    // Every pixel at full size: a downscaled copy aliases the thin lines and adds noise of its own.
    const d = ctx.getImageData(0, 0, 2560, 720).data;
    let s = 0;
    for (let i = 0; i < d.length; i += 4) s += 0.2126 * LIN[d[i]] + 0.7152 * LIN[d[i + 1]] + 0.0722 * LIN[d[i + 2]];
    lum.push(s / (2560 * 720));
  }
  return lum;
}

const withEcho = run(true);
const without = run(false);
const pre = document.createElement('pre');
pre.id = 'echo-calm';
pre.textContent = JSON.stringify({ mode, hz, withEcho, without });
document.body.appendChild(pre);
