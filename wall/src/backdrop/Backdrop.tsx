import { useEffect, useRef } from 'react';
import { usePlaceStore } from '../state/places';
import { useIdle } from '../ui/useIdle';
import { useReducedMotion } from '../ui/useReducedMotion';
import { levelAtTime, onStage, pictureFade, skyNow, stage, sundownProgress } from '../zen/stage';
import { SKY_HEIGHT, live } from './live';
import { createSkyColours, legibleGain, skyColoursAt } from './palette';
import { createShader, type SkyShader } from './shader';
import { useBackdropSettings, type SkyStyle } from './settings';
import { sun } from '../horizon/renderer';

export interface BackdropProps {
  /** The sky is wanted on this page now (it fades in); off, it fades out and stops. */
  on: boolean;
  /** The layer is still in the page: wanted, or fading out. Not mounted, nothing runs. */
  mounted: boolean;
  /** A frozen review still (development builds): the clock, the moment of the drift, the style. */
  review: { ms: number; t: number; style?: SkyStyle } | null;
}

/** Frame gaps: about 16 frames a second on Zen, about 8 everywhere else. At these drift speeds a frame moves the picture less than one buffer pixel. */
export const ZEN_FRAME_MS = 62;
export const PAGE_FRAME_MS = 125;
/** Small buffers, stretched: both styles are low frequency, and the stretch is the blur. */
export const ZEN_BUFFER: readonly [number, number] = [640, 128];
export const PAGE_BUFFER: readonly [number, number] = [320, 64];
/** A page switch's gain glide and the fade in and out: the veil's own transition time. */
const GLIDE_MS = 600;
/** The style swap goes down to zero and up again, half the glide each way. */
const SWAP_MS = 300;
/** The frame guard: this many frames, averaging over `GUARD_LATE` times the wanted interval, halve the buffer. */
export const GUARD_FRAMES = 20;
export const GUARD_LATE = 1.5;
const MIN_BUFFER_WIDTH = 80;
/** The palette and the page's gain are read again this often (ms). */
const REFRESH_MS = 1000;
/** Where the drift's clock starts (seconds), so a first frame is never the shader's empty start. */
const T0 = 40;

/**
 * The animated sky: one canvas the width of the stage, from the top down to the lowest horizon line, drawn by one WebGL shader
 * (`shader.ts`) between the horizon's two canvases. It stops completely (no frame requested) when it is not wanted, a screen holds the
 * sky, the page is hidden, Dream has faded the picture out, or the horizon is at rest (one still under reduced motion).
 */
export function Backdrop({ on, mounted, review }: BackdropProps) {
  const place = usePlaceStore((s) => s.active);
  const style = useBackdropSettings((s) => s.style);
  const strength = useBackdropSettings((s) => s.strength);
  const reduced = useReducedMotion();
  const canvas = useRef<HTMLCanvasElement>(null);
  const shader = useRef<SkyShader | null>(null);
  // What the loop reads, kept current each render so a page switch never restarts it.
  const cur = useRef({ place, style, on, strength });
  cur.current = { place, style, on, strength };
  const redraw = useRef<() => void>(() => {});

  // The one context for the whole app: made when this first mounts, kept until the app ends.
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    let made: SkyShader | null = null;
    try {
      made = createShader(el, () => useBackdropSettings.getState().markUnavailable());
    } catch {
      made = null;
    }
    if (!made) {
      useBackdropSettings.getState().markUnavailable();
      return;
    }
    shader.current = made;
    redraw.current();
    return () => {
      made?.dispose();
      shader.current = null;
    };
  }, []);

  // The loop's own numbers live in a ref for the whole visit, so an off and on, a style swap or a restart of the loop
  // carries on from where the picture is (a fade out starts from the gain on screen, and a stepped down buffer stays down).
  const st = useRef({ shrink: 1, sized: '', bound: null as SkyStyle | null, target: 0, gain: -1, fade: 0, swap: 1, refreshed: -Infinity, lateMs: 0, lateN: 0, t0: performance.now() });
  // Idle (no input for 4 minutes, the display off, Windows locked) stops the loop everywhere but Zen, which is watched without input.
  const idle = useIdle();
  const paused = idle && place !== 'zen';

  useEffect(() => {
    const el = canvas.current;
    if (!el || !mounted || !shader.current) return;
    const sh = shader.current;
    const colours = createSkyColours();
    const k = st.current;
    let last = 0;
    let raf = 0;
    let timer = 0;

    const refresh = (now: number, snap: boolean) => {
      // Sundown moves the sky's hour on, so its colours are read at every frame of the slow rate while it runs.
      const every = cur.current.place === 'zen' && (stage.sky.on || stage.sky.outAt > 0) ? 0 : REFRESH_MS;
      if (now - k.refreshed < every && !snap) return;
      k.refreshed = now;
      const { place: p, style: s, strength: power } = cur.current;
      const real = review ? review.ms : Date.now();
      // Zen's Sundown runs the sky on its own clock.
      const ms = p === 'zen' ? skyNow(performance.now(), real) : real;
      skyColoursAt(ms, review?.style ?? s, colours);
      const sp = sun(ms);
      k.target = legibleGain(p, sp.alt, sp.az > 180, review?.style ?? s, colours, power);
      if (k.gain < 0 || snap) k.gain = k.target;
    };
    const resize = () => {
      const [w, h] = cur.current.place === 'zen' ? ZEN_BUFFER : PAGE_BUFFER;
      const bw = Math.max(MIN_BUFFER_WIDTH, Math.round(w * k.shrink));
      const bh = Math.max(MIN_BUFFER_WIDTH / 5, Math.round(h * k.shrink));
      const key = `${bw}x${bh}`;
      if (key !== k.sized) {
        k.sized = key;
        sh.resize(bw, bh);
      }
    };
    const toward = (v: number, to: number, dt: number, ms: number) => (v < to ? Math.min(to, v + dt / (ms / 1000)) : Math.max(to, v - dt / (ms / 1000)));

    /** Draw one frame; `dt` seconds since the last. Returns false when nothing is left to draw (faded out). */
    const drawFrame = (now: number, dt: number, snap: boolean): boolean => {
      const { place: p, style: s, on: wanted } = cur.current;
      refresh(now, snap);
      resize();
      const want = review?.style ?? s;
      if (snap) {
        k.fade = wanted ? 1 : 0;
        k.swap = 1;
        k.gain = k.target;
        k.bound = want;
        sh.setStyle(want);
      } else {
        k.fade = toward(k.fade, wanted ? 1 : 0, dt, GLIDE_MS);
        k.gain = toward(k.gain, k.target, dt, GLIDE_MS);
        // A style change fades down through zero, swaps the program there, and fades back up.
        if (k.bound !== want) {
          k.swap = toward(k.swap, 0, dt, SWAP_MS);
          if (k.swap <= 0 || k.bound === null) {
            k.bound = want;
            sh.setStyle(want);
          }
        } else k.swap = toward(k.swap, 1, dt, SWAP_MS);
      }
      let total = k.gain * k.fade * k.swap;
      if (p === 'zen') {
        // Zen follows its picture's fade into Dream, and the breath moves the gain about 12 percent.
        // Sundown cools the sky and lowers its gain to about 0.4 by the end.
        const pulse = stage.mode === 'sundown' ? 1 - 0.6 * sundownProgress(performance.now()) : 1 + 0.12 * (2 * levelAtTime(performance.now()) - 1);
        total *= pictureFade(performance.now()) * pulse;
      }
      // Faded all the way out: one clearing frame, then nothing more to draw.
      const t = review ? review.t : T0 + (now - k.t0) / 1000;
      const hz = Math.min(0.9, Math.max(0, (SKY_HEIGHT - live.hy) / SKY_HEIGHT));
      sh.draw(t, colours, total, hz);
      return wanted || k.fade > 0;
    };

    const still = () => {
      drawFrame(performance.now(), 0, true);
    };
    if (reduced || review) {
      redraw.current = still;
      still();
      return () => {
        redraw.current = () => {};
      };
    }

    // The frame guard: the real interval between frames, which is what a slow GPU or a busy machine stretches (the time spent
    // submitting a draw says nothing of that). 20 frames that average over 1.5 times the wanted interval halve the buffer,
    // and it is never raised again in this visit.
    const guard = (gap: number, interval: number) => {
      if (gap <= 0) return;
      k.lateMs += gap / interval;
      if (++k.lateN < GUARD_FRAMES) return;
      const base = cur.current.place === 'zen' ? ZEN_BUFFER[0] : PAGE_BUFFER[0];
      if (k.lateMs / k.lateN > GUARD_LATE && Math.round(base * k.shrink) / 2 >= MIN_BUFFER_WIDTH) k.shrink /= 2;
      k.lateMs = 0;
      k.lateN = 0;
    };
    const interval = () => (cur.current.place === 'zen' ? ZEN_FRAME_MS : PAGE_FRAME_MS);
    const stop = () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(timer);
      raf = 0;
      timer = 0;
    };
    const frame = (ts: number) => {
      raf = 0;
      const gap = last === 0 ? 0 : ts - last;
      const dt = Math.min(0.25, gap / 1000);
      last = ts;
      // Dream has taken the picture away: nothing more to draw until the stage changes.
      if (cur.current.place === 'zen' && stage.dreamAt !== null && pictureFade(performance.now()) <= 0) return;
      const alive = drawFrame(ts, dt, false);
      guard(gap, interval());
      // The next frame is asked for only when it is due: a page at 8 frames a second is not woken at every vsync.
      if (alive) timer = window.setTimeout(() => {
        timer = 0;
        raf = requestAnimationFrame(frame);
      }, Math.max(0, interval() - 8));
    };
    const start = () => {
      if (raf === 0 && timer === 0 && !document.hidden && !paused) {
        last = 0;
        raf = requestAnimationFrame(frame);
      }
    };
    const onVisible = () => {
      if (document.hidden) stop();
      else start();
    };
    document.addEventListener('visibilitychange', onVisible);
    // Dream closing (the picture is back) starts a loop it stopped.
    const offStage = onStage(() => {
      if (raf === 0 && timer === 0 && (stage.dreamAt === null || pictureFade(performance.now()) > 0)) start();
    });
    start();
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      offStage();
      stop();
    };
  }, [mounted, on, reduced, review, paused]);

  // A still (reduced motion, a review frame) is drawn again when the page, the style or the wish changes.
  const firstDraw = useRef(true);
  useEffect(() => {
    // Not on the first run: mounting already drew it.
    if (firstDraw.current) firstDraw.current = false;
    else redraw.current();
  }, [place, style, on]);

  return <canvas ref={canvas} className="backdrop-canvas" aria-hidden="true" style={mounted ? undefined : { display: 'none' }} />;
}
