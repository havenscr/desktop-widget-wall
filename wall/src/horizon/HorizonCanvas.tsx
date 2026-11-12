import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from '../ui/useReducedMotion';
import { STAGE_HEIGHT, STAGE_WIDTH, fitScale } from '../stage/fitScale';
import { usePlaceStore } from '../state/places';
import { useAudioStore } from '../audio/store';
import { loudness, smoothStep } from '../audio/model';
import { CAMERAS, MOON, glideCamera, settled, startGlide, stepGlide, type Glide } from './cameras';
import { echoOptions, stepEchoFade } from './echo';
import { frameDelta, shouldDraw } from './pacing';
import { parseReview } from './review';
import { drawHorizon, type HorizonOptions } from './index';

const REDRAW_MS = 60_000;

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
  // The ripple fade (0 to 1) follows `playing`.
  const fade = useRef(0);
  const loud = useRef(0); // smoothed loudness, so the ripple eases out when the store drops to zero
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
      const camera = glideCamera(glide.current);
      const options: HorizonOptions = {
        width,
        height,
        scale,
        camera,
        ms: review ? review.ms : nowRef.current(),
        t: review ? 0 : T,
        phase: review ? 0 : (T * 0.32) % 1,
      };
      // The ripple never appears in the review still or under reduced motion's still frames.
      if (!still) {
        const echo = echoOptions(camera, fade.current, loud.current, T);
        if (echo) options.echo = echo;
      }
      // The moon shows only once the camera has arrived at Unwind (no glide in progress), and
      // goes the moment a glide away starts. The review still and reduced motion jump straight there.
      if (glide.current.progress >= 1 && glide.current.to === CAMERAS.unwind) options.moon = MOON;
      drawHorizon(ctx, options);
    };
    repaint.current = paint;

    const frame = (ts: number) => {
      raf = requestAnimationFrame(frame);
      if (!shouldDraw(ts, last, document.hidden)) return;
      const dt = frameDelta(ts, last);
      last = ts;
      T += dt;
      loud.current = smoothStep(loud.current, loudness(useAudioStore.getState()), dt);
      fade.current = stepEchoFade(fade.current, useAudioStore.getState().playing, dt);
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

  // Hidden pages start the ripple from nothing when they return, never from stale levels.
  useEffect(() => {
    const onHide = () => {
      if (document.hidden) {
        fade.current = 0;
        loud.current = 0;
      }
    };
    document.addEventListener('visibilitychange', onHide);
    return () => document.removeEventListener('visibilitychange', onHide);
  }, []);

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
