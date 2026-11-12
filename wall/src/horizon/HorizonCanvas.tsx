import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from '../ui/useReducedMotion';
import { STAGE_HEIGHT, STAGE_WIDTH, fitScale } from '../stage/fitScale';
import { usePlaceStore } from '../state/places';
import { useAudioStore } from '../audio/store';
import { loudness, smoothStep } from '../audio/model';
import { CAMERAS, HOME_MORNING, MOON, cameraFor, glideCamera, localDay, settled, startGlide, stepGlide, type CameraPreset, type Glide } from './cameras';
import { startFade, stepFade, type Fade } from './crossfade';
import { echoOptions, stepEchoFade } from './echo';
import { frameDelta, shouldDraw } from './pacing';
import { parseReview } from './review';
import { drawHorizon, type HorizonOptions } from './index';

const REDRAW_MS = 60_000;
/** Home's morning rule is re-checked this often. */
const MORNING_CHECK_MS = 60_000;

/**
 * Canvas filling the stage. Backing store = stage scale x devicePixelRatio.
 * `now` is the clock the sky follows (default `Date.now`); inject one in tests.
 */
export function HorizonCanvas({ now = Date.now }: { now?: () => number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  // Second layer, under the main canvas: the old terrain while a cross-fade runs, hidden otherwise.
  const oldRef = useRef<HTMLCanvasElement>(null);
  const fadeRef = useRef<Fade | null>(null);
  const active = usePlaceStore((s) => s.active);
  // Zen covers the stage with flames, so the canvas is not drawn then. It keeps the last camera
  // and glides from there to wherever the user goes next.
  const zen = active === 'zen';
  const place = active === 'zen' ? null : active;
  const reduced = useReducedMotion();
  // Review hook: dev builds only, `?hz=<place>&at=<ISO time>` draws one frozen frame.
  const [review] = useState(() => (import.meta.env.DEV ? parseReview(window.location.search) : null));
  const glide = useRef<Glide>(settled(cameraFor(review?.place ?? place ?? 'work', review ? review.ms : now())));
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
  const reducedRef = useRef(reduced);
  useEffect(() => {
    reducedRef.current = reduced;
  }, [reduced]);

  // Local day the cinematic turn to Rainier last played. In memory only, so a restart may play it again.
  const cinematicDay = useRef<string | null>(null);

  /**
   * Point the camera at `target`. Same terrain (every shipped preset is on the panorama): a
   * glide, or a 3.2 second swing for a turn of more than 40 degrees. The first turn of each local
   * day from a west camera to Rainier is the cinematic move instead (4.6 s, `cinematicCamera`). A different terrain cannot
   * be blended, so the old view stays on the lower layer while the new one fades in over it
   * (instantly when motion is reduced). Returns true when something changed on screen at once.
   */
  const retarget = (target: CameraPreset, instant: boolean) => {
    // Start from the composite on screen: during a fade, whichever layer is more visible
    // becomes the old layer, so nothing pops when the fade is retargeted.
    const running = fadeRef.current;
    const oldWins = running !== null && running.progress < 0.5;
    const from = oldWins ? running.camera : glideCamera(glide.current);
    const moon = oldWins ? running.moon : glide.current.progress >= 1 && glide.current.to === CAMERAS.unwind;
    const fade = startFade(from, target, instant, moon);
    if (fade) {
      fadeRef.current = fade;
      glide.current = settled(target);
    } else {
      fadeRef.current = null;
      const day = localDay(nowRef.current());
      const cinematic = !instant && target === HOME_MORNING && from !== HOME_MORNING && cinematicDay.current !== day;
      if (cinematic) cinematicDay.current = day;
      glide.current = startGlide(oldWins ? settled(from) : glide.current, target, instant, cinematic);
    }
    if (instant) repaint.current();
  };

  // Drawing: an animated 30 fps loop, or a single frame (a still frame once a minute when motion is reduced).
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || zen) return;
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
      const xfade = fadeRef.current;
      const oldCanvas = oldRef.current;
      const oldCtx = xfade && oldCanvas ? oldCanvas.getContext('2d') : null;
      if (oldCanvas) {
        if (xfade && oldCtx) {
          if (oldCanvas.width !== width || oldCanvas.height !== height) {
            oldCanvas.width = width;
            oldCanvas.height = height;
          }
          oldCanvas.style.display = '';
          canvas.style.opacity = String(xfade.progress);
          const oldOptions: HorizonOptions = {
            width,
            height,
            scale,
            camera: xfade.camera,
            ms: nowRef.current(),
            t: T,
            phase: (T * 0.32) % 1,
            ...(xfade.moon ? { moon: MOON } : {}),
          };
          // The ripple keeps playing in the old view, with the old camera's shape and the same fade and loudness.
          if (!still) {
            const oldEcho = echoOptions(xfade.camera, fade.current, loud.current, T);
            if (oldEcho) oldOptions.echo = oldEcho;
          }
          drawHorizon(oldCtx, oldOptions);
        } else {
          oldCanvas.style.display = 'none';
          canvas.style.opacity = '';
        }
      }
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
        const echo = echoOptions(camera, fade.current, loud.current, T, glide.current);
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
      if (fadeRef.current) fadeRef.current = stepFade(fadeRef.current, dt);
      paint();
    };

    // Reduced motion shows the cameras without a glide or a fade, so settle both before the first
    // still paint; a half-faded composite would otherwise stay up until the next redraw.
    if (still) {
      glide.current = settled(glide.current.to);
      fadeRef.current = null;
    }
    paint();
    window.addEventListener('resize', paint);
    let timer = 0;
    if (still) {
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
  }, [reduced, review, zen]);

  // Zen covers the stage: hide the old layer too (paint is not running then), like the main canvas.
  useEffect(() => {
    if (zen && oldRef.current) oldRef.current.style.display = 'none';
  }, [zen]);

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
    if (review || place === null) return;
    // Back from Zen to the camera already showing: nothing to glide (the moon stays on Unwind).
    const target = cameraFor(place, nowRef.current());
    if (glide.current.to === target && glide.current.progress >= 1) return;
    retarget(target, reduced);
  }, [place, reduced, review]);

  // Home's camera follows the hour: look again once a minute, so 5:00 AM and 11:30 AM take effect while it is open.
  useEffect(() => {
    if (review || place !== 'home') return;
    const timer = window.setInterval(() => {
      const target = cameraFor('home', nowRef.current());
      if (glide.current.to !== target) retarget(target, reducedRef.current);
    }, MORNING_CHECK_MS);
    return () => window.clearInterval(timer);
  }, [place, review]);

  return (
    <>
      <canvas ref={ref} className="horizon-canvas" aria-hidden="true" style={zen ? { display: 'none' } : undefined} />
      <canvas ref={oldRef} className="horizon-canvas horizon-canvas-old" aria-hidden="true" style={{ display: 'none' }} />
    </>
  );
}
