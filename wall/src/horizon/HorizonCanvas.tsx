import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useReducedMotion } from '../ui/useReducedMotion';
import { useIdle } from '../ui/useIdle';
import { wantsDemo } from '../audio/capture';
import { STAGE_HEIGHT, STAGE_WIDTH, fitScale } from '../stage/fitScale';
import { MAIN_LEFT } from '../screens/frameLayout';
import { usePlaceStore } from '../state/places';
import { REFLECT, createReflection, drawReflection, reflectionAlpha } from './reflection';
import { audioBands, audioBeats, clearDanceHistory, danceKick, pauseDanceHistory, useAudioStore } from '../audio/store';
import { loudness, smoothStep } from '../audio/model';
import { CAMERAS, HOME_MORNING, MOON_PLACES, cameraFor, cloudShiftFor, glideCamera, localDay, settled, startGlide, stepGlide, type CameraPreset, type Glide } from './cameras';
import {
  REST_LOOK,
  REST_OPACITY,
  REST_OPACITY_VISUALIZER,
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
  visualizerWeight,
} from './echo';
import { liveTint } from '../music/coverTint';
import { frameDelta, shouldDraw } from './pacing';
import { clearGridPulse, createGridPulse, stepGridPulse } from './pulse';
import { parseReview, parseSkyReview } from './review';
import { publishCamera } from './signal';
import { frontHost, moonFor, useSkyClaim, useSkyStore, type SkyBox } from './sky';
import { drawVeil, veilStrength } from './veil';
import { drawHorizon, type HorizonGrid, type HorizonOptions } from './index';
import { lineSettings } from './linesSettings';
import { parseLineProbe } from './lineProbe';
import {
  FLAT_REST_OPACITY,
  ampScale,
  createLineFrame,
  createLineTypes,
  createMountainCap,
  danceLimit,
  drawLineType,
  lineStops,
  setMountainCap,
  sstep,
  stepLineTypes,
  typeLiveShare,
} from './lineTypes';

const REDRAW_MS = 60_000;
/**
 * After a place change the veil's strength is read each frame for this long (its CSS transition is
 * 600 ms); otherwise it is read once, when the front canvas comes, and kept.
 */
const VEIL_SETTLE_MS = 800;
/**
 * The front canvas's place: the whole stage, whatever element it is mounted in, cut at the main
 * area's left edge (`MAIN_LEFT`). The rail is painted before the main area, so the front canvas
 * would cover it; left of that edge the main canvas keeps the ground (copied from the front one).
 */
const FRONT_STYLE = { position: 'fixed', left: 0, top: 0, pointerEvents: 'none', clipPath: `inset(0 0 0 ${MAIN_LEFT}px)` } as const;
/** Home's morning rule is re-checked this often. */
const MORNING_CHECK_MS = 60_000;
/** No picture boxes (the fit check's deliberate break only). */
const NO_BOXES: readonly SkyBox[] = [];

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
    pauseDanceHistory(idle);
  }, [idle]);
  useEffect(() => () => pauseDanceHistory(false), []);
  // The sky layers (`sky.ts`): while a screen gives an element for it, the ground is drawn on a
  // second canvas mounted there, in front of whatever the screen puts into the sky.
  const claims = useSkyStore((s) => s.claims);
  const lineBoxes = useRef<SkyBox[]>([]);
  useEffect(() => {
    const boxes = lineBoxes.current;
    boxes.length = 0;
    for (const id in claims) if (claims[id].boxes) boxes.push(...claims[id].boxes!);
  }, [claims]);
  // Dev builds only: `?sky=front` mounts the front canvas everywhere, `?sky=flat` never, `?skymoon=x,y,r` moves the moon (fit-check breaks, cost measurement).
  const [skyReview] = useState(() => (import.meta.env.DEV ? parseSkyReview(window.location.search) : null));
  const alwaysFront = !zen && skyReview?.front === 'always';
  const host = zen || skyReview?.front === 'always' || skyReview?.front === 'never' ? null : frontHost(claims);
  // The moon's candidate places (`MOON_PLACES`), or the one review place.
  const [moonPlaces] = useState(() => (skyReview?.moon ? [skyReview.moon] : MOON_PLACES));
  // The moon last drawn, published on the canvas as `data-moon` ("x,y,r", or empty) for the fit check.
  const shownMoon = useRef<readonly number[] | null | undefined>(undefined);
  const frontRef = useRef<HTMLCanvasElement | null>(null);
  const [front, setFront] = useState<HTMLCanvasElement | null>(null);
  const frontCanvas = useCallback((el: HTMLCanvasElement | null) => {
    frontRef.current = el;
    setFront(el);
  }, []);
  // The place veil the front canvas repeats (`veil.ts`): its element, its strength as last read,
  // and until when (performance.now) it is read again each frame: -1 once it has settled, -2 when
  // the element is to be looked up again on the next paint with a front canvas (at first, and after a place change).
  // `timer`: a still frame drawn while the veil moves is drawn once more when it has settled.
  const veil = useRef<{ el: Element | null; a: number; until: number; timer: number }>({ el: null, a: 0, until: -2, timer: 0 });
  // True while the drawing is a still (reduced motion, or a frozen review frame).
  const stillRef = useRef(false);
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
  // The echo's clock and the real-band sampler, read through the Height cap (`lineTypes.ts`; off
  // at the usual setting, so the bands are read exactly as before).
  const echoT = useRef(0);
  const cap = useRef(createMountainCap());
  const sampler = useRef(createEchoSampler(cap.current.bands));
  // The new line types (Bars, Ribbon, Sparks, Skyline): their state and one frame input, made once.
  const types = useRef(createLineTypes());
  const typeFrame = useRef(createLineFrame());
  // Dev builds only: `?lineprobe=1` counts a new type's pixels inside the picture boxes (the fit check).
  const [lineProbe] = useState(() => (import.meta.env.DEV ? parseLineProbe(window.location.search) : null));
  // The scratch canvas for the lake reflection, made on first use.
  const reflection = useRef(createReflection());
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
    stillRef.current = still;
    // Start the pulse from nothing: after Zen or a reduced motion spell the stored bands are stale.
    clearGridPulse(pulse.current);
    grid.current = null;
    // Nothing was drawn moving while the loop was off (Zen, reduced motion): start from the camera's count.
    lineCount.current = glideCamera(glide.current).en;
    let T = 0;
    let last = 0;
    let raf = 0;
    let drawDt = 1 / 30;
    const measureCost = import.meta.env.DEV && new URLSearchParams(window.location.search).has('linecost');
    let costFrames = 0;
    let costMs = 0;

    const paint = () => {
      if (document.hidden) return;
      const costStart = measureCost ? performance.now() : 0;
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
      // The Lines setting (`linesSettings.ts`), read from the store without a render.
      const lines = lineSettings();
      const newType = lines.type !== 'mountains';
      const flat = lines.rest === 'flat';
      const tf = typeFrame.current;
      let typeShown = false;
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
        // The lines take the playing cover's colours (cross-faded between tracks; teal with no cover),
        // or the chosen palette, for every type.
        const stops = lineStops(lines.colours, liveTint(performance.now()));
        let echo = echoOptions(camera, loud.current, echoT.current, gate.current.value * awake.current, m.rest, lines.rest, flat ? FLAT_REST_OPACITY : undefined, m.rest < 1 ? danceKick() * (1 - m.rest) : 0, stops);
        if (echo && lines.lively !== 50) echo.amp *= ampScale(lines.lively);
        const turningOff = glide.current.to.ea === 0 && glide.current.progress < 1;
        if (echo && turningOff && echoStrength(echo) > lastEchoA.current) {
          scaleEcho(echo, lastEchoA.current / echoStrength(echo));
          if (echoStrength(echo) <= 0.005) echo = null;
        }
        lastEchoA.current = echo ? echoStrength(echo) : 0;
        if (echo && newType) {
          // A new type in place of the ridgelines: drawn after the picture at the live opacity this
          // camera gives the lines (calm on Work and Home), lying down as the music stops. With Ridge
          // and levels the wall's own resting lines fade in under it; with Flat one calm line does.
          tf.type = lines.type;
          tf.height = lines.height;
          tf.smooth = lines.smooth;
          tf.amp = echo.amp;
          tf.cx = echo.cx ?? STAGE_WIDTH / 2;
          tf.hs = echo.hs ?? 900;
          tf.hy = camera.hy;
          tf.scale = scale;
          tf.live = echo.a * typeLiveShare(lines.type, m.rest, flat);
          tf.restLine = flat ? sstep(m.rest) * Math.min(1, gate.current.value * awake.current) : 0;
          tf.kick = danceKick();
          tf.dt = drawDt;
          tf.boxes = lineProbe?.noClip ? NO_BOXES : lineBoxes.current;
          tf.stops = stops;
          typeShown = true;
          const k = visualizerWeight(camera);
          const restOpacity = (REST_OPACITY + (REST_OPACITY_VISUALIZER - REST_OPACITY) * k) * sstep(m.rest);
          echo = !flat && m.rest > 0.02 ? echoOptions(camera, 0, echoT.current, gate.current.value * awake.current, 1, REST_LOOK, restOpacity, 0, stops) : null;
        }
        if (echo) {
          echo.n = Math.max(1, lineCount.current);
          echo.drift = m.drift;
          // The real bands, while any line still follows them (at rest none does, so none are read).
          if (m.rest < 1 && !newType) {
            setMountainCap(cap.current, lines.height, echo.amp, danceLimit(lines.lively));
            const s = sampler.current;
            s.t = echoT.current;
            echo.sample = s.sample;
          }
          options.echo = echo;
        }
        if (grid.current) options.grid = grid.current;
      } else {
        // The still frame shows the lines at rest, in the chosen resting look (Flat: one calm line).
        const open = initialEchoGate(glide.current).value;
        const echo = newType && flat ? null : echoOptions(camera, 0, 0, open, 1, lines.rest, flat ? FLAT_REST_OPACITY : undefined, 0, lineStops(lines.colours));
        if (newType && open > 0.001) {
          // A new type at rest, as the moving frame leaves it once settled.
          tf.type = lines.type;
          tf.hy = camera.hy;
          tf.cx = camera.ecx;
          tf.scale = scale;
          tf.live = typeLiveShare(lines.type, 1, flat) * open;
          tf.restLine = flat ? open : 0;
          tf.dt = 0;
          tf.boxes = lineBoxes.current;
          tf.stops = lineStops(lines.colours);
          typeShown = true;
        }
        if (echo) {
          echo.drift = REST_PHASE;
          options.echo = echo;
        }
      }
      // The moon shows only once the camera has arrived at Unwind (no glide in progress), and
      // goes the moment a glide away starts. The review still and reduced motion jump straight there.
      // A screen with a picture over its place, or a look that owns that sky, withholds it (`sky.ts`).
      if (glide.current.progress >= 1 && glide.current.to === CAMERAS.unwind) {
        const moon = moonFor(moonPlaces, useSkyStore.getState().claims);
        if (moon) options.moon = moon;
      }
      if (shownMoon.current !== (options.moon ?? null)) {
        shownMoon.current = options.moon ?? null;
        canvas.dataset.moon = options.moon ? options.moon.join(',') : '';
      }
      // With the front canvas mounted: the sky here, the ground there, on the same frame. A front
      // canvas no longer in the page (its host was taken out) is none: this canvas draws it all.
      const fc = frontRef.current;
      let fctx: CanvasRenderingContext2D | null = null;
      if (fc && fc.isConnected) {
        if (fc.width !== width || fc.height !== height) {
          fc.width = width;
          fc.height = height;
        }
        fctx = fc.getContext('2d');
      }
      if (fctx) {
        options.part = 'sky';
        drawHorizon(ctx, options);
        options.part = 'ground';
        drawHorizon(fctx, options);
      } else {
        drawHorizon(ctx, options);
      }
      // A new type belongs to the land: on the front canvas when there is one, in front of a video
      // behind the mountains as the ridgelines are, and never inside a claimed picture box.
      if (typeShown) {
        stepLineTypes(types.current, tf);
        drawLineType(fctx ?? ctx, types.current, tf);
        if (lineProbe) lineProbe.run(types.current, tf, lineBoxes.current, canvas);
      }
      // The lake mirrors the finished frame on the visualizer camera, only while lines are drawn.
      if (REFLECT && lines.reflection && (options.echo || typeShown)) {
        const open = still ? initialEchoGate(glide.current).value : gate.current.value * awake.current;
        const alpha = reflectionAlpha(visualizerWeight(camera), open);
        if (fctx) drawReflection(reflection.current, fctx, width, height, camera.hy, scale, alpha, undefined, canvas);
        else drawReflection(reflection.current, ctx, width, height, camera.hy, scale, alpha);
      }
      if (fc && fctx) {
        // Left of the main area (the rail's column) the front canvas is cut away: the main canvas
        // takes the ground there over its sky, so the rail's glass shows the whole picture.
        const strip = Math.min(width, Math.ceil(MAIN_LEFT * scale));
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
        ctx.drawImage(fc, 0, 0, strip, height, 0, 0, strip, height);
        ctx.restore();
        // The place veil lies over the main canvas as a page layer; the front canvas is above it,
        // so it lays the same veil on its own pixels (`veil.ts`).
        const v = veil.current;
        if (v.until === -2) {
          v.el = canvas.parentElement?.querySelector(':scope > .veil') ?? null;
          v.until = performance.now() + VEIL_SETTLE_MS;
        }
        if (v.until >= 0) {
          v.a = veilStrength(v.el);
          const left = v.until - performance.now();
          if (left < 0) v.until = -1;
          else if (still && !v.timer) {
            v.timer = window.setTimeout(() => {
              v.timer = 0;
              repaint.current();
            }, left + 50);
          }
        }
        drawVeil(fctx, width, height, v.a);
      }
      if (measureCost) {
        costMs += performance.now() - costStart;
        costFrames++;
        canvas.dataset.lineCost = `${costFrames},${costMs.toFixed(3)},${(costMs / costFrames).toFixed(4)}`;
      }
    };
    repaint.current = paint;

    const frame = (ts: number) => {
      raf = requestAnimationFrame(frame);
      if (!shouldDraw(ts, last, document.hidden)) return;
      const dt = frameDelta(ts, last);
      drawDt = dt;
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

  // The veil is looked up and read on the first frame with the front canvas and again after a
  // place change (then each frame through its transition), never otherwise: a style read each
  // frame forces a style flush.
  useEffect(() => {
    veil.current.until = -2;
  }, [active]);
  useEffect(() => () => window.clearTimeout(veil.current.timer), []);

  // A still frame is drawn again when the sky layers change (the front canvas comes or goes, a
  // claim moves the moon); the animated loop picks the change up on its next frame.
  // (The canvas element is read from its ref, which is set before effects run, so its arrival
  // and the claim that brought it make one repaint.)
  const seen = useRef({ claims, front: frontRef.current });
  useEffect(() => {
    if (seen.current.claims === claims && seen.current.front === frontRef.current) return;
    seen.current = { claims, front: frontRef.current };
    if (stillRef.current) repaint.current();
  }, [claims, front]);

  // Hidden pages return with the lines at rest, and the grid pulse and the band history from nothing, never from stale levels.
  useEffect(() => {
    const onHide = () => {
      if (document.hidden) {
        restEchoMotion(motion.current);
        loud.current = 0;
        clearGridPulse(pulse.current);
        grid.current = null;
        // And the echo's spectrum: 7 seconds of it would otherwise replay across the lines on return.
        clearDanceHistory();
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
      {/* Fixed to the stage (its transform is the containing block), so it covers the stage
          whatever box it is mounted in, and takes no pointer. */}
      {alwaysFront ? <canvas ref={frontCanvas} className="horizon-canvas horizon-front" aria-hidden="true" style={FRONT_STYLE} /> : null}
      {host ? createPortal(<canvas ref={frontCanvas} className="horizon-canvas horizon-front" aria-hidden="true" style={FRONT_STYLE} />, host) : null}
      {skyReview?.front === 'empty' && !zen ? <EmptyLayer place={active} /> : null}
    </>
  );
}

/**
 * Review knob `?sky=empty` (development builds only): claims the sky layers with an empty host
 * placed in the main area as a screen's host is (`.w-stage.w-layered` in `unwind.css`), so the
 * front canvas is mounted with no picture between it and the main canvas. The pixel proof
 * (`npm run fit-check`) compares that with the one-canvas picture: they must be the same pixels.
 */
function EmptyLayer({ place }: { place: string }) {
  const [main, setMain] = useState<Element | null>(null);
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    setMain(document.querySelector('.main'));
  }, [place]);
  useSkyClaim('review-empty', main ? { front: host } : null);
  if (!main) return null;
  return createPortal(
    <div className="w-stage w-layered sky-empty" style={{ inset: 0, pointerEvents: 'none' }} aria-hidden="true">
      <div ref={setHost} style={{ position: 'absolute', inset: 0 }} />
    </div>,
    main,
  );
}
