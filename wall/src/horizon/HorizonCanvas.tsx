import { useEffect, useRef, useState } from 'react';
import { STAGE_HEIGHT, STAGE_WIDTH, fitScale } from '../stage/fitScale';
import { usePlaceStore } from '../state/places';
import { CAMERAS, glideCamera, settled, startGlide, stepGlide, type Glide } from './cameras';
import { frameDelta, shouldDraw } from './pacing';
import { parseReview } from './review';
import { drawHorizon } from './index';

const REDUCED_QUERY = '(prefers-reduced-motion: reduce)';
const REDRAW_MS = 60_000;

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => !!window.matchMedia?.(REDUCED_QUERY).matches);
  useEffect(() => {
    const mq = window.matchMedia?.(REDUCED_QUERY);
    if (!mq) return;
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

/**
 * Canvas filling the stage. Backing store = stage scale x devicePixelRatio.
 * `now` is the clock the sky follows (default `Date.now`); inject one in tests.
 */
export function HorizonCanvas({ now = Date.now }: { now?: () => number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const place = usePlaceStore((s) => s.active);
  const reduced = useReducedMotion();
  // Review hook: dev builds only, `?hz=<place>&at=<ISO time>` draws one frozen frame.
  const [review] = useState(() => (import.meta.env.DEV ? parseReview(window.location.search) : null));
  const glide = useRef<Glide>(settled(CAMERAS[review?.place ?? place]));
  const repaint = useRef<() => void>(() => {});
  const first = useRef(true);
  // Latest clock, read at draw time so an inline `now` prop never restarts the loop.
  const nowRef = useRef(now);
  useEffect(() => {
    nowRef.current = now;
  }, [now]);

  // Drawing: an animated 30 fps loop, or a single frame (a still frame once a minute when motion is reduced).
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const still = reduced || review !== null;
    let T = 0;
    let last = 0;
    let raf = 0;

    const paint = () => {
      if (document.hidden) return;
      const scale = fitScale(window.innerWidth, window.innerHeight) * (window.devicePixelRatio || 1);
      const width = Math.round(STAGE_WIDTH * scale);
      const height = Math.round(STAGE_HEIGHT * scale);
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      drawHorizon(ctx, {
        width,
        height,
        scale,
        camera: glideCamera(glide.current),
        ms: review ? review.ms : nowRef.current(),
        t: review ? 0 : T,
        phase: review ? 0 : (T * 0.32) % 1,
      });
    };
    repaint.current = paint;

    const frame = (ts: number) => {
      raf = requestAnimationFrame(frame);
      if (!shouldDraw(ts, last, document.hidden)) return;
      const dt = frameDelta(ts, last);
      last = ts;
      T += dt;
      glide.current = stepGlide(glide.current, dt);
      paint();
    };

    paint();
    window.addEventListener('resize', paint);
    let timer = 0;
    if (still) {
      // Reduced motion shows the cameras without a glide, so snap any glide in progress.
      glide.current = settled(glide.current.to);
      if (!review) timer = window.setInterval(paint, REDRAW_MS);
      // Also in review mode: a frame skipped while hidden is drawn when the page shows.
      document.addEventListener('visibilitychange', paint);
    } else {
      raf = requestAnimationFrame(frame);
    }
    return () => {
      window.removeEventListener('resize', paint);
      document.removeEventListener('visibilitychange', paint);
      window.clearInterval(timer);
      cancelAnimationFrame(raf);
    };
  }, [reduced, review]);

  // Review mode: make the rail and screen match the requested place too.
  useEffect(() => {
    if (review) usePlaceStore.getState().setActive(review.place);
  }, [review]);

  // Switching places glides the camera (or jumps, when motion is reduced).
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (review) return;
    glide.current = startGlide(glide.current, CAMERAS[place], reduced);
    if (reduced) repaint.current();
  }, [place, reduced, review]);

  return <canvas ref={ref} className="horizon-canvas" aria-hidden="true" />;
}
