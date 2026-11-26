import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
import { createLevelEase, fractionsAt, stepLevelEase, withMusicLevel, type MusicFractions } from './offTabMusic';
import { vibeSettings } from './vibeSettings';
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
import { isNight } from '../buddy/model';
import { senseWeather } from '../buddy/senses';
import { useSceneWeather } from '../weather/sceneSetting';
import { useWeatherStore } from '../weather/useWeather';
import { MIN_FRAME_MS, frameDelta, shouldDraw } from './pacing';
import { levelAt, onStage, pictureFade, sample as zenSample, skyNow, stage as zenStage } from '../zen/stage';
import { clearGridPulse, createGridPulse, stepGridPulse } from './pulse';
import { parseReview, parseSkyReview } from './review';
import { Backdrop } from '../backdrop/Backdrop';
import { live } from '../backdrop/live';
import { useSkyLayer } from '../backdrop/useSkyLayer';
import { veilScale } from '../backdrop/palette';
import { useBackdropSettings } from '../backdrop/settings';
import { publishCamera } from './signal';
import { frontHost, moonFor, useSkyClaim, useSkyStore, type SkyBox } from './sky';
import { drawVeil, veilStrength } from './veil';
import { drawHorizon, type HorizonGrid, type HorizonOptions } from './index';
import { lineSettings, useLinesStore } from './linesSettings';
import { parseLineProbe } from './lineProbe';
import {
  createWeatherLayer,
  drawWeatherBack,
  drawWeatherMid,
  parseWeatherReview,
  releaseWeather,
  setSkipBoxes,
  setWeatherTarget,
  snapWeather,
  stepWeather,
  weatherOn,
} from './weatherLayer';
import { setWeatherOverlay, weatherOverlay } from './weatherOverlay';
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
/** Share of the Unwind lines' live strength that Zen draws them at. */
const ZEN_LINE_SHARE = 0.65;
/** Stands in for `clearRect` while the ground part is drawn over the sky and the weather (see `paint`). */
const NO_CLEAR = (): void => {};
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

/**
 * Canvas filling the stage. Backing store = stage scale x devicePixelRatio.
 * `now` is the clock the sky follows (default `Date.now`); inject one in tests.
 */
export function HorizonCanvas({ now = Date.now }: { now?: () => number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const active = usePlaceStore((s) => s.active);
  // Zen draws the same picture on the Unwind camera, its ridge following the breath (`zen/stage.ts`) in place of the music.
  const zen = active === 'zen';
  const place = active;
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
  // Dev builds only: `?lineprobe=front|behind` reads where a new type is drawn against the picture (the fit check).
  const [lineProbe] = useState(() => (import.meta.env.DEV ? parseLineProbe(window.location.search) : null));
  // The picture boxes, kept only for the probe, the one reader of them: production keeps none.
  const lineBoxes = useRef<SkyBox[]>([]);
  // The weather layer (`weatherLayer.ts`): rain and wind drawn inside this frame. It keeps its own
  // flat list of the pictures' boxes and the keep-clear cards, so nothing falls over a film or behind a card.
  const wx = useRef(createWeatherLayer());
  // Dev builds only: `?wxt=<seconds>` freezes the layer's moment in a review still; `?wxnoskip=1` empties its skip boxes (a fit-check break).
  const [wxReview] = useState(() => (import.meta.env.DEV ? parseWeatherReview(window.location.search) : null));
  useEffect(() => {
    wx.current.noSkip = wxReview?.noSkip === true;
  }, [wxReview]);
  useEffect(() => () => releaseWeather(wx.current), []);
  useEffect(() => {
    setSkipBoxes(wx.current, claims);
    if (!lineProbe) return;
    const boxes = lineBoxes.current;
    boxes.length = 0;
    for (const id in claims) if (claims[id].boxes) boxes.push(...claims[id].boxes!);
  }, [claims, lineProbe, wxReview]);
  // Dev builds only: `?sky=front` mounts the front canvas everywhere, `?sky=flat` never, `?skymoon=x,y,r` moves the moon (fit-check breaks, cost measurement).
  const [skyReview] = useState(() => (import.meta.env.DEV ? parseSkyReview(window.location.search) : null));
  const alwaysFront = !zen && skyReview?.front === 'always';
  const host = zen || skyReview?.front === 'always' || skyReview?.front === 'never' || skyReview?.front === 'place' ? null : frontHost(claims);
  // The animated sky (`backdrop/`): wanted on the pages the setting lists while no screen holds the sky. While it is, the ground is
  // drawn on its own canvas in place (under the veil and the rail), and the sky layer sits between the two canvases.
  const forcedPlace = skyReview?.front === 'place';
  const layer = useSkyLayer({ place, claimed: host !== null || alwaysFront || skyReview?.front === 'never', reduced, pages: skyReview?.on });
  // A stronger sky thins the page veil (`veilScale`), so it reads as strong on a page of cards as on Zen; the veil stays whole while the sky is not drawn.
  const strength = useBackdropSettings((s) => s.strength);
  const veilK = layer.want ? veilScale(strength) : 1;
  const split = (layer.mounted || forcedPlace) && host === null && !alwaysFront;
  // The sky layer's canvas is made the first time a page asks for it and kept while the app runs (one context, never one per page).
  const [skyMade, setSkyMade] = useState(false);
  if (layer.want && !skyMade) setSkyMade(true);
  const skyReviewFrame = useMemo(() => (review ? { ms: review.ms, t: skyReview?.t ?? 40, style: skyReview?.style } : null), [review, skyReview]);
  const groundRef = useRef<HTMLCanvasElement | null>(null);
  const [ground, setGround] = useState<HTMLCanvasElement | null>(null);
  const groundCanvas = useCallback((el: HTMLCanvasElement | null) => {
    groundRef.current = el;
    setGround(el);
  }, []);
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
  const glide = useRef<Glide>(settled(cameraFor(review?.place ?? place, review ? review.ms : now())));
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
  // Music on other tabs (`offTabMusic.ts`): the eased level, its fractions, how much music drives the lines, and a scratch camera.
  const levelEase = useRef(createLevelEase(vibeSettings().offTabMusic));
  const level = useRef<MusicFractions>(fractionsAt(levelEase.current.pos, { amp: 0, a: 0, n: 0, gp: 0 }));
  const playWeight = useRef(0);
  const musicCam = useRef<CameraPreset>({ ...glide.current.to });
  const cap = useRef(createMountainCap());
  const sampler = useRef(createEchoSampler(cap.current.bands));
  // The new line types (Bars, Ribbon, Sparks, Skyline): their state and one frame input, made once.
  const types = useRef(createLineTypes());
  const typeFrame = useRef(createLineFrame());
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
    if (!canvas) return;
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
    // The seconds the moving parts of a new type advance in this paint: the frame's own step, and nothing for a
    // repaint (a resize, a visibility change, a changed setting), which only draws what is already there.
    let drawDt = 0;
    /** The camera as drawn: off Unwind the music level moves its ripple values toward Unwind's while music plays; at rest, still or Zen it is the camera itself. */
    const tabCamera = () => (still ? glideCamera(glide.current) : withMusicLevel(glideCamera(glide.current), level.current, playWeight.current, musicCam.current));
    const measureCost = import.meta.env.DEV && new URLSearchParams(window.location.search).has('linecost');
    let costFrames = 0;
    let costMs = 0;

    /** The overlay canvas above the place veil, sized to this frame and cleared, or null when the page has none. */
    const overlayContext = (width: number, height: number): CanvasRenderingContext2D | null => {
      const o = weatherOverlay();
      if (!o || !o.isConnected) return null;
      if (o.width !== width || o.height !== height) {
        o.width = width;
        o.height = height;
      }
      const x = o.getContext('2d');
      if (!x) return null;
      x.setTransform(1, 0, 0, 1, 0, 0);
      x.clearRect(0, 0, width, height);
      return x;
    };
    /** The weather layer is off: the overlay canvas lets its pixels go (a zero size empties it). */
    const dropOverlay = () => {
      const o = weatherOverlay();
      if (o && (o.width !== 0 || o.height !== 0)) {
        o.width = 0;
        o.height = 0;
      }
    };
    // Zen's picture (sky, ridge and lake) fades to black over Dream's first minute and is then not drawn at all.
    // Returns true when nothing is to be drawn.
    const zenDimmed = (): boolean => {
      // The ground canvas (when the sky is on) goes with the main one.
      const g = groundRef.current;
      if (!zen) {
        if (canvas.style.opacity !== '' || canvas.style.visibility !== '') {
          canvas.style.opacity = '';
          canvas.style.visibility = '';
        }
        if (g && (g.style.opacity !== '' || g.style.visibility !== '')) {
          g.style.opacity = '';
          g.style.visibility = '';
        }
        return false;
      }
      const f = reduced && zenStage.dreamAt !== null ? 0 : pictureFade(performance.now());
      const o = f >= 1 ? '' : f.toFixed(3);
      if (canvas.style.opacity !== o) canvas.style.opacity = o;
      const v = f <= 0 ? 'hidden' : '';
      if (canvas.style.visibility !== v) canvas.style.visibility = v;
      if (g) {
        if (g.style.opacity !== o) g.style.opacity = o;
        if (g.style.visibility !== v) g.style.visibility = v;
      }
      return f <= 0;
    };
    const paint = () => {
      if (document.hidden) return;
      zenStage.now = performance.now();
      zenStage.echoT = echoT.current;
      if (zenDimmed()) {
        dropOverlay();
        return;
      }
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
      const camera = tabCamera();
      live.hy = camera.hy;
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
        // Zen's Sundown runs the sky on its own clock (`zen/stage.ts`); every other moment draws the real hour.
        ms: zen ? skyNow(performance.now(), review ? review.ms : nowRef.current()) : review ? review.ms : nowRef.current(),
        t: review && still ? 0 : T,
        phase: review && still ? 0 : (T * 0.32) % 1,
        // Clouds turn with the camera at about a third of the land's speed.
        cloudShift: cloudShiftFor(camera),
      };
      // Zen: the lines follow the breath (`zen/stage.ts`), never the music, and there is no grid pulse. They are drawn with the
      // Unwind camera's own line count and look, the colours it has with no cover playing, at a calmer strength.
      if (zen && !still) {
        const echo = echoOptions(camera, 1, echoT.current, gate.current.value * awake.current, 0, REST_LOOK, undefined, 0, lineStops(lines.colours));
        if (echo) {
          scaleEcho(echo, ZEN_LINE_SHARE);
          echo.n = Math.max(1, lineCount.current);
          echo.sample = zenSample;
          options.echo = echo;
        }
        lastEchoA.current = echo ? echoStrength(echo) : 0;
      } else if (!still) {
        // The grid pulse never appears in the review still or under reduced motion's still frames.
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
      // The ground canvas in place (the animated sky is on) is the same split, mounted under the veil and the rail.
      const fc = frontRef.current ?? groundRef.current;
      const inPlace = fc !== null && fc === groundRef.current;
      let fctx: CanvasRenderingContext2D | null = null;
      if (fc && fc.isConnected) {
        if (fc.width !== width || fc.height !== height) {
          fc.width = width;
          fc.height = height;
        }
        fctx = fc.getContext('2d');
      }
      // The weather layer: not under reduced motion, nothing while it is off. A review still draws one frozen moment.
      const w = wx.current;
      // Zen draws no weather (its Dream fade takes only the main canvas, and the old Zen had none).
      const wxOn = !reduced && !zen && weatherOn(w);
      const wxTime = review && !demo ? (wxReview?.t ?? 0) : T;
      if (fctx) {
        options.part = 'sky';
        drawHorizon(ctx, options);
        if (wxOn) drawWeatherBack(ctx, w, wxTime, camera.hy, scale, width, height, awake.current);
        options.part = 'ground';
        drawHorizon(fctx, options);
      } else if (wxOn) {
        // Sky, the weather behind the ridge, then the ground: the mountains and the lake hide it. The ground part
        // begins by clearing its canvas (it is made for the front canvas, which starts empty), which here would wipe
        // the sky and the weather. Its one clear is switched off for this draw, so the ground goes over them with the
        // very calls the whole picture makes, and no second canvas or copy is needed.
        options.part = 'sky';
        drawHorizon(ctx, options);
        drawWeatherBack(ctx, w, wxTime, camera.hy, scale, width, height, awake.current);
        options.part = 'ground';
        const own = ctx as unknown as { clearRect?: unknown };
        own.clearRect = NO_CLEAR;
        try {
          drawHorizon(ctx, options);
        } finally {
          delete own.clearRect;
        }
      } else {
        drawHorizon(ctx, options);
      }
      // A new type belongs to the land, across the full width: on the front canvas when there is
      // one (a video behind the mountains, so the lines stand in front of its lower part as the
      // ridgelines do), otherwise on this canvas, where a picture in front of the land (the drive-in
      // screen, the hologram's pane) stands over it and hides the part that passes behind.
      if (typeShown) {
        stepLineTypes(types.current, tf);
        const onFront = !lineProbe?.mainOnly && fctx;
        drawLineType(onFront || ctx, types.current, tf);
        if (lineProbe) {
          canvas.style.zIndex = lineProbe.lift ? '60' : '';
          lineProbe.run(types.current, tf, lineBoxes.current, canvas, onFront && fc ? fc : canvas);
        }
      }
      // The lake mirrors the finished frame on the visualizer camera, only while lines are drawn.
      if (REFLECT && lines.reflection && (options.echo || typeShown)) {
        const open = still ? initialEchoGate(glide.current).value : gate.current.value * awake.current;
        // On Zen the lake is brightest on the out breath and dimmest on the full inhale.
        const alpha = reflectionAlpha(visualizerWeight(camera), zen && !still ? open * (0.55 + 0.45 * (1 - levelAt(0))) : open);
        if (fctx) drawReflection(reflection.current, fctx, width, height, camera.hy, scale, alpha, undefined, canvas);
        else drawReflection(reflection.current, ctx, width, height, camera.hy, scale, alpha);
      }
      // The weather in front of the ground and the lines, on the canvas the ground is on, before the veil pass.
      // The mid layer goes ABOVE the place veil, as the picked pictures drew it: with the front canvas, after its veil (below); with one
      // canvas, on the overlay canvas the page puts after the veil (`WeatherOverlay`), or on this canvas when there is none.
      // With the ground in place the weather goes the one canvas way: on the overlay above the veil (or on the ground canvas, when the page has none).
      if (wxOn && (!fctx || inPlace)) drawWeatherMid(overlayContext(width, height) ?? fctx ?? ctx, w, wxTime, camera.hy, scale, width, height, awake.current);
      else dropOverlay();
      // The ground in place has no rail strip to copy and no veil to repeat: it lies under both.
      if (fc && fctx && !inPlace) {
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
        if (wxOn) drawWeatherMid(fctx, w, wxTime, camera.hy, scale, width, height, awake.current);
      }
      if (measureCost) {
        costMs += performance.now() - costStart;
        costFrames++;
        canvas.dataset.lineCost = `${costFrames},${costMs.toFixed(3)},${(costMs / costFrames).toFixed(4)}`;
      }
    };
    repaint.current = paint;

    // Point the weather layer at the weather now (read about once a second, and when the forecast or the Tools switch changes).
    const syncWeather = () => {
      const ms = review ? review.ms : nowRef.current();
      setWeatherTarget(wx.current, senseWeather(useWeatherStore.getState().reading, ms), isNight(new Date(ms)), useSceneWeather.getState().on);
      // A review still shows the layer in full, at its frozen moment.
      if (review) snapWeather(wx.current, demo ? wx.current.rt : (wxReview?.t ?? 0));
    };

    let resume = false;
    const frame = (ts: number) => {
      // Dream has faded the picture out: the canvas is hidden and the loop stops until the stage changes (`onStage` below).
      if (zen && zenStage.dreamAt !== null && pictureFade(performance.now()) <= 0) {
        paint();
        raf = 0;
        resume = true;
        return;
      }
      raf = requestAnimationFrame(frame);
      if (!shouldDraw(ts, last, document.hidden)) return;
      // The first frame after a stop steps by one frame, not by the whole time it was stopped.
      if (resume) {
        resume = false;
        last = ts - MIN_FRAME_MS;
      }
      const dt = frameDelta(ts, last);
      drawDt = dt;
      last = ts;
      T += dt;
      const audio = useAudioStore.getState();
      // Zen ignores the music: the ridge lies still-calm underneath the breath's own lines.
      const driving = !zen && musicDriving(motion.current, audio.playing, audioBands(), dt);
      if (driving) loud.current = smoothStep(loud.current, loudness(audio), dt);
      stepEchoMotion(motion.current, driving, dt);
      stepLevelEase(levelEase.current, vibeSettings().offTabMusic, dt);
      fractionsAt(levelEase.current.pos, level.current);
      playWeight.current = 1 - motion.current.rest;
      // Zen is watched for the length of a session without input: its picture never goes to the idle fade.
      awake.current = stepEchoFade(awake.current, !idleRef.current || zen, dt);
      const layer = wx.current;
      layer.since += dt;
      if (layer.since >= 1) {
        layer.since = 0;
        syncWeather();
      }
      stepWeather(layer, dt);
      glide.current = stepGlide(glide.current, dt);
      publish();
      lineCount.current = stepLineCount(lineCount.current, tabCamera().en, dt);
      stepEchoGate(gate.current, glide.current, dt);
      echoT.current += dt;
      const beats = audioBeats();
      const input = pulseIn.current;
      input.playing = !zen && useAudioStore.getState().playing;
      input.beats = beats.count;
      input.lag = beats.lag / 1000;
      input.bass = beats.bass;
      input.gp = tabCamera().gp;
      grid.current = stepGridPulse(pulse.current, dt, input);
      if (glide.current.cinematic && glide.current.progress >= 0.5) cinematicDay.current = localDay(nowRef.current());
      paint();
      drawDt = 0;
    };

    // Reduced motion shows the cameras without a glide, so settle it before the first still paint;
    // a half-way camera would otherwise stay up until the next redraw.
    if (still) glide.current = settled(glide.current.to);
    publish();
    if (!reduced) syncWeather();
    paint();
    window.addEventListener('resize', paint);
    let timer = 0;
    let offLines = () => {};
    let offSwitchNow = () => {};
    let offStageLoop = () => {};
    if (still) {
      if (!review) timer = window.setInterval(paint, REDRAW_MS);
      // A changed line type or colour is drawn at once, not at the next minute's redraw (the loop does it on its next frame).
      offLines = useLinesStore.subscribe(paint);
      // Zen changes the stage (a session starts, Dream opens): the still is drawn again.
      if (zen) {
        const offStageOnly = offLines;
        const offStage = onStage(paint);
        offLines = () => {
          offStageOnly();
          offStage();
        };
      }
      // A review still shows the weather as soon as the reading (or the Tools switch) arrives.
      if (!reduced) {
        const again = () => {
          syncWeather();
          paint();
        };
        const offReading = useWeatherStore.subscribe(again);
        const offSwitch = useSceneWeather.subscribe(again);
        const offLinesOnly = offLines;
        offLines = () => {
          offLinesOnly();
          offReading();
          offSwitch();
        };
      }
      // Also in review mode: a frame skipped while hidden is drawn when the page shows.
      document.addEventListener('visibilitychange', paint);
    } else {
      // The Tools switch takes effect on the next frame, not at the next one second read.
      offSwitchNow = useSceneWeather.subscribe(() => void (wx.current.since = 1e9));
      raf = requestAnimationFrame(frame);
      // A stopped loop (Dream has faded out) starts again when the stage changes and the picture is back.
      if (zen) {
        offStageLoop = onStage(() => {
          if (raf === 0 && pictureFade(performance.now()) > 0) raf = requestAnimationFrame(frame);
        });
      }
    }
    return () => {
      offSwitchNow();
      offStageLoop();
      releaseWeather(wx.current);
      window.removeEventListener('resize', paint);
      document.removeEventListener('visibilitychange', paint);
      window.clearInterval(timer);
      offLines();
      cancelAnimationFrame(raf);
    };
  }, [reduced, review, zen, demo]);

  // The veil is looked up and read on the first frame with the front canvas and again after a
  // place change (then each frame through its transition), never otherwise: a style read each
  // frame forces a style flush.
  // It is also read again when the veil's scale changes (the strength moved, or the sky came or went).
  useEffect(() => {
    const el = ref.current?.parentElement?.querySelector(':scope > .veil');
    if (el instanceof HTMLElement) el.style.setProperty('--veil-k', String(veilK));
    veil.current.until = -2;
  }, [active, veilK]);
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

  // The ground canvas coming or going is drawn at once, in the same frame: a page never shows a moment with no ground.
  useLayoutEffect(() => {
    repaint.current();
  }, [ground]);

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
    if (review) return;
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
      <canvas ref={ref} className="horizon-canvas" aria-hidden="true" />
      {skyMade && !forcedPlace ? <Backdrop on={layer.want} mounted={layer.mounted} review={skyReviewFrame} /> : null}
      {split ? <canvas ref={groundCanvas} className="horizon-canvas horizon-ground" aria-hidden="true" /> : null}
      {/* Fixed to the stage (its transform is the containing block), so it covers the stage
          whatever box it is mounted in, and takes no pointer. */}
      {alwaysFront ? <canvas ref={frontCanvas} className="horizon-canvas horizon-front" aria-hidden="true" style={FRONT_STYLE} /> : null}
      {host ? createPortal(<canvas ref={frontCanvas} className="horizon-canvas horizon-front" aria-hidden="true" style={FRONT_STYLE} />, host) : null}
      {skyReview?.front === 'empty' && !zen ? <EmptyLayer place={active} /> : null}
    </>
  );
}

/**
 * The canvas the weather's mid layer is drawn on with one canvas: the page puts it right after the place veil (`App.tsx`), so the
 * rain lies above the veil, as the picked pictures drew it, and under Watt and every card. It is empty (zero size) while the weather is off.
 */
export function WeatherOverlay() {
  useEffect(() => () => setWeatherOverlay(null), []);
  return <canvas ref={setWeatherOverlay} className="horizon-weather" aria-hidden="true" width={0} height={0} />;
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
