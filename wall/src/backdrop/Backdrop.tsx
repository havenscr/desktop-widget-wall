import { useEffect, useRef } from 'react';
import { usePlaceStore } from '../state/places';
import { useReducedMotion } from '../ui/useReducedMotion';
import { levelAtTime, onStage, pictureFade, stage } from '../zen/stage';
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
/** The frame time guard: the 30 frame average (ms) past which the buffer is halved. */
export const GUARD_FRAMES = 30;
export const GUARD_MS = 6;
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
  const reduced = useReducedMotion();
  const canvas = useRef<HTMLCanvasElement>(null);
  const shader = useRef<SkyShader | null>(null);
  // What the loop reads, kept current each render so a page switch never restarts it.
  const cur = useRef({ place, style, on });
  cur.current = { place, style, on };
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

  useEffect(() => {
    const el = canvas.current;
    if (!el || !mounted || !shader.current) return;
    const sh = shader.current;
    const colours = createSkyColours();
    let shrink = 1;
    let sized = '';
    let bound: SkyStyle | null = null;
    let target = 0;
    let gain = -1;
    let fade = reduced || review ? (cur.current.on ? 1 : 0) : 0;
    let swap = 1;
    let refreshed = -Infinity;
    let last = 0;
    let raf = 0;
    let guardMs = 0;
    let guardN = 0;
    const t0 = performance.now();

    const refresh = (now: number, snap: boolean) => {
      if (now - refreshed < REFRESH_MS && !snap) return;
      refreshed = now;
      const { place: p, style: s } = cur.current;
      const ms = review ? review.ms : Date.now();
      skyColoursAt(ms, review?.style ?? s, colours);
      const sp = sun(ms);
      target = legibleGain(p, sp.alt, sp.az > 180, review?.style ?? s, colours);
      if (gain < 0 || snap) gain = target;
    };
    const resize = () => {
      const [w, h] = cur.current.place === 'zen' ? ZEN_BUFFER : PAGE_BUFFER;
      const bw = Math.max(MIN_BUFFER_WIDTH, Math.round(w * shrink));
      const bh = Math.max(MIN_BUFFER_WIDTH / 5, Math.round(h * shrink));
      const key = `${bw}x${bh}`;
      if (key !== sized) {
        sized = key;
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
        fade = wanted ? 1 : 0;
        swap = 1;
        bound = want;
        sh.setStyle(want);
      } else {
        fade = toward(fade, wanted ? 1 : 0, dt, GLIDE_MS);
        gain = toward(gain, target, dt, GLIDE_MS);
        // A style change fades down through zero, swaps the program there, and fades back up.
        if (bound !== want) {
          swap = toward(swap, 0, dt, SWAP_MS);
          if (swap <= 0 || bound === null) {
            bound = want;
            sh.setStyle(want);
          }
        } else swap = toward(swap, 1, dt, SWAP_MS);
      }
      let total = (snap ? target : gain) * fade * swap;
      if (p === 'zen') {
        // Zen follows its picture's fade into Dream, and the breath moves the gain about 12 percent.
        total *= pictureFade(performance.now()) * (1 + 0.12 * (2 * levelAtTime(performance.now()) - 1));
      }
      if (total <= 0.0005 && !wanted && fade <= 0) return false;
      const t = review ? review.t : T0 + (now - t0) / 1000;
      const hz = Math.min(0.9, Math.max(0, (SKY_HEIGHT - live.hy) / SKY_HEIGHT));
      sh.draw(t, colours, total, hz);
      return true;
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

    // The frame time guard: 30 frames averaging over 6 ms halve the buffer, never raised again in this visit.
    const guard = (ms: number) => {
      guardMs += ms;
      if (++guardN < GUARD_FRAMES) return;
      if (guardMs / guardN > GUARD_MS && Math.round(ZEN_BUFFER[0] * shrink) > MIN_BUFFER_WIDTH) shrink /= 2;
      guardMs = 0;
      guardN = 0;
    };
    const frame = (ts: number) => {
      raf = requestAnimationFrame(frame);
      const gap = cur.current.place === 'zen' ? ZEN_FRAME_MS : PAGE_FRAME_MS;
      if (ts - last < gap - 4) return;
      const dt = last === 0 ? 0 : Math.min(0.25, (ts - last) / 1000);
      last = ts;
      // Dream has taken the picture away: nothing more to draw until the stage changes.
      if (cur.current.place === 'zen' && stage.dreamAt !== null && pictureFade(performance.now()) <= 0) {
        cancelAnimationFrame(raf);
        raf = 0;
        return;
      }
      const began = performance.now();
      const alive = drawFrame(ts, dt, false);
      guard(performance.now() - began);
      if (!alive) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    };
    const start = () => {
      if (raf === 0 && !document.hidden) {
        last = 0;
        raf = requestAnimationFrame(frame);
      }
    };
    const onVisible = () => {
      if (document.hidden) {
        cancelAnimationFrame(raf);
        raf = 0;
      } else start();
    };
    document.addEventListener('visibilitychange', onVisible);
    // Dream closing (the picture is back) starts a loop it stopped.
    const offStage = onStage(() => {
      if (raf === 0 && (stage.dreamAt === null || pictureFade(performance.now()) > 0)) start();
    });
    start();
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      offStage();
      cancelAnimationFrame(raf);
    };
  }, [mounted, on, reduced, review]);

  // A still (reduced motion, a review frame) is drawn again when the page, the style or the wish changes.
  const firstDraw = useRef(true);
  useEffect(() => {
    // Not on the first run: mounting already drew it.
    if (firstDraw.current) firstDraw.current = false;
    else redraw.current();
  }, [place, style, on]);

  return <canvas ref={canvas} className="backdrop-canvas" aria-hidden="true" style={mounted ? undefined : { display: 'none' }} />;
}
