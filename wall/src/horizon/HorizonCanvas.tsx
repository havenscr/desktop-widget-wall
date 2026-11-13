import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from '../ui/useReducedMotion';
import { useIdle } from '../ui/useIdle';
import { wantsDemo } from '../audio/capture';
import { STAGE_HEIGHT, STAGE_WIDTH, fitScale } from '../stage/fitScale';
import { usePlaceStore } from '../state/places';
import { audioBands, audioBeats, clearBandHistory, danceKick, pauseBandHistory, useAudioStore } from '../audio/store';
import { loudness, smoothStep } from '../audio/model';
import { CAMERAS, HOME_MORNING, MOON, cameraFor, cloudShiftFor, glideCamera, localDay, settled, startGlide, stepGlide, type CameraPreset, type Glide } from './cameras';
import {
  REST_PHASE,
  createEchoMotion,
  createEchoSampler,
  echoOptions,
  echoStrength,
  initialEchoGate,
  musicDriving,
  restEchoMotion,
  scaleEcho,
  stepEchoFade,
  stepEchoGate,
  stepEchoMotion,
  stepLineCount,
} from './echo';
import { frameDelta, shouldDraw } from './pacing';
import { clearGridPulse, createGridPulse, stepGridPulse } from './pulse';
import { parseReview } from './review';
import { publishCamera } from './signal';
import { drawHorizon, type HorizonGrid, type HorizonOptions } from './index';

const REDRAW_MS = 60_000;
/** Home's morning rule is re-checked this often. */
const MORNING_CHECK_MS = 60_000;

/**
 * Canvas filling the stage. Backing store = stage scale x devicePixelRatio.
 * `now` is the clock the sky follows (default `Date.now`); inject one in tests.
 */
export function HorizonCanvas({ now = Date.now }: { now?: () => number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const active = usePlaceStore((s) => s.active);
  // Zen covers the stage with flames, so the canvas is not drawn then. It keeps the last camera
  // and glides from there to wherever the user goes next.
  const zen = active === 'zen';
  const place = active === 'zen' ? null : active;
  const reduced = useReducedMotion();
  // Review hook: dev builds only, `?hz=<place>&at=<ISO time>` draws one frozen frame.
  const [review] = useState(() => (import.meta.env.DEV ? parseReview(window.location.search) : null));
  // With `?audio=demo` (dev only) a review URL keeps its frozen camera and sky but animates, so the
  // echo and the grid pulse can be seen and captured against the demo levels.
  const [demo] = useState(() => wantsDemo(window.location.search));
  // Display idle or off (no input for 4 minutes, screens off, locked): the echo fades away and the
  // band history stops, so nothing is computed for it while nobody is looking.
  const idle = useIdle();
  const idleRef = useRef(idle);
  useEffect(() => {
    idleRef.current = idle;
    pauseBandHistory(idle);
  }, [idle]);
  useEffect(() => () => pauseBandHistory(false), []);
  const glide = useRef<Glide>(settled(cameraFor(review?.place ?? place ?? 'work', review ? review.ms : now())));
  const repaint = useRef<() => void>(() => {});
  const first = useRef(true);
  // The ridgelines between playing and rest (`stepEchoMotion`): they settle into their resting look
  // over 2.5 s once music stops driving them, and lift back over 1.5 s. Starts at rest.
  const motion = useRef(createEchoMotion());
  // Smoothed loudness (Work and Home scale their live lines by it). Held while the lines settle, so
  // they ease from where they were into the resting look rather than dimming first.
  const loud = useRef(0);
  // The camera gate (0 to 1): ramps the ripple out on a turn to Rainier and back in after the turn away.
  const gate = useRef(initialEchoGate(glide.current));
  // The opacity drawn last frame: during a move toward a camera without a ripple the drawn
  // opacity may only fall (music starting or the display waking must not lift it there).
  const lastEchoA = useRef(0);
  // 1 while the display is in use, easing to 0 over a second once it goes idle.
  const awake = useRef(1);
  // The drawn line count: follows the camera's `en` through a glide at no more than
  // `LINE_COUNT_RATE` counts a second, so each line crossfades slowly, and lands on it exactly.
  const lineCount = useRef(glide.current.to.en);
  // The echo's clock and the real-band sampler.
  const echoT = useRef(0);
  const sampler = useRef(createEchoSampler());
  // Tell Watt (read only) where the camera is going and whether it is moving; cleared on unmount
  // so the signal can never stick on moving.
  const publish = () => publishCamera(glide.current.to, glide.current.progress < 1);
  useEffect(() => {
    publish();
    return () => publishCamera(null, false);
  }, []);
  // The grid pulse: glow bands on the beat and brighter lines with the bass, only while music plays.
  const pulse = useRef(createGridPulse());
  const grid = useRef<HorizonGrid | null>(null);
  // The pulse's per-frame input, reused so the frame loop builds no object for it.
  const pulseIn = useRef({ playing: false, beats: 0, lag: 0, bass: 0, gp: 0 });
  // Latest clock, read at draw time so an inline `now` prop never restarts the loop.
  const nowRef = useRef(now);
  useEffect(() => {
    nowRef.current = now;
  }, [now]);
  const reducedRef = useRef(reduced);
  useEffect(() => {
    reducedRef.current = reduced;
  }, [reduced]);

  // Local day the cinematic turn to Rainier last played past half-way (a turn tapped away
  // earlier does not use it up). In memory only, so a restart may play it again.
  const cinematicDay = useRef<string | null>(null);

  /**
   * Point the camera at `target` (every preset is on the one panorama, so this is always a camera
   * move): a glide, or a 3.2 second swing for a turn of more than 40 degrees. The first turn of
   * each local day from a west camera to Rainier is the cinematic move instead (4.6 s,
   * `cinematicCamera`). Instant (reduced motion) jumps straight there and repaints.
   */
  const retarget = (target: CameraPreset, instant: boolean) => {
    const from = glideCamera(glide.current);
    const day = localDay(nowRef.current());
    const cinematic = !instant && target === HOME_MORNING && from !== HOME_MORNING && cinematicDay.current !== day;
    glide.current = startGlide(glide.current, target, instant, cinematic);
    publish();
    if (instant) repaint.current();
  };

  // Drawing: an animated 30 fps loop, or a single frame (a still frame once a minute when motion is reduced).
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || zen) return;
    const still = reduced || (review !== null && !demo);
    // Start the pulse from nothing: after Zen or a reduced motion spell the stored bands are stale.
    clearGridPulse(pulse.current);
    grid.current = null;
    // Nothing was drawn moving while the loop was off (Zen, reduced motion): start from the camera's count.
    lineCount.current = glideCamera(glide.current).en;
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
        t: review && still ? 0 : T,
        phase: review && still ? 0 : (T * 0.32) % 1,
        // Clouds turn with the camera at about a third of the land's speed.
        cloudShift: cloudShiftFor(camera),
      };
      // The grid pulse never appears in the review still or under reduced motion's still frames.
      if (!still) {
        const m = motion.current;
        let echo = echoOptions(camera, loud.current, echoT.current, gate.current.value * awake.current, m.rest, undefined, undefined, m.rest < 1 ? danceKick() * (1 - m.rest) : 0);
        const turningOff = glide.current.to.ea === 0 && glide.current.progress < 1;
        if (echo && turningOff && echoStrength(echo) > lastEchoA.current) {
          scaleEcho(echo, lastEchoA.current / echoStrength(echo));
          if (echoStrength(echo) <= 0.005) echo = null;
        }
        lastEchoA.current = echo ? echoStrength(echo) : 0;
        if (echo) {
          echo.n = Math.max(1, lineCount.current);
          echo.drift = m.drift;
          // The real bands, while any line still follows them (at rest none does, so none are read).
          if (m.rest < 1) {
            const s = sampler.current;
            s.t = echoT.current;
            echo.sample = s.sample;
          }
          options.echo = echo;
        }
        if (grid.current) options.grid = grid.current;
      } else {
        // The still frame shows the lines at rest.
        const echo = echoOptions(camera, 0, 0, initialEchoGate(glide.current).value, 1);
        if (echo) {
          echo.drift = REST_PHASE;
          options.echo = echo;
        }
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
      const audio = useAudioStore.getState();
      const driving = musicDriving(motion.current, audio.playing, audioBands(), dt);
      if (driving) loud.current = smoothStep(loud.current, loudness(audio), dt);
      stepEchoMotion(motion.current, driving, dt);
      awake.current = stepEchoFade(awake.current, !idleRef.current, dt);
      glide.current = stepGlide(glide.current, dt);
      publish();
      lineCount.current = stepLineCount(lineCount.current, glideCamera(glide.current).en, dt);
      stepEchoGate(gate.current, glide.current, dt);
      echoT.current += dt;
      const beats = audioBeats();
      const input = pulseIn.current;
      input.playing = useAudioStore.getState().playing;
      input.beats = beats.count;
      input.lag = beats.lag / 1000;
      input.bass = beats.bass;
      input.gp = glideCamera(glide.current).gp;
      grid.current = stepGridPulse(pulse.current, dt, input);
      if (glide.current.cinematic && glide.current.progress >= 0.5) cinematicDay.current = localDay(nowRef.current());
      paint();
    };

    // Reduced motion shows the cameras without a glide, so settle it before the first still paint;
    // a half-way camera would otherwise stay up until the next redraw.
    if (still) glide.current = settled(glide.current.to);
    publish();
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
  }, [reduced, review, zen, demo]);

  // Hidden pages return with the lines at rest, and the grid pulse and the band history from nothing, never from stale levels.
  useEffect(() => {
    const onHide = () => {
      if (document.hidden) {
        restEchoMotion(motion.current);
        loud.current = 0;
        clearGridPulse(pulse.current);
        grid.current = null;
        // And the echo's spectrum: 7 seconds of it would otherwise replay across the lines on return.
        clearBandHistory();
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
    <canvas ref={ref} className="horizon-canvas" aria-hidden="true" style={zen ? { display: 'none' } : undefined} />
  );
}
