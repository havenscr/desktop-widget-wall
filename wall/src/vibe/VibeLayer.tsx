import { useEffect, useRef } from 'react';
import { audioBeats, audioDrops, audioEnergy, danceKick, useAudioStore } from '../audio/store';
import { vibeSettings, useVibeStore } from '../horizon/vibeSettings';
import { liveTint, type Rgb } from '../music/coverTint';
import { useNowPlayingStore } from '../music/store';
import { useReducedMotion } from '../ui/useReducedMotion';
import { createAurora } from './aurora';
import { createGlitch, type GlitchSources } from './glitch';
import { createTape } from './tape';
import { bakeMatte, radiusOf, type Matte } from './artMatte';
import { drawGlow, type GlowInput } from './glow';
import { DEGRADED_FRAME_MS, browserHost, createLoop, createProbe, type LoopHost } from './loop';
import { createVibeFrame, createVibeState, counterAdvanced, noteBeatHit, noteDrop, noteKick, noteTry, stepVibe, type VibeInput } from './mix';
import { softStops } from './feather';
import { useTryStore } from './tryIt';

/** Backing store scale: the canvas is drawn at half resolution and scaled up by CSS. */
export const BACKING = 0.5;
/**
 * The rate limiters' clock seconds, kept outside the component: a remount (reduced motion, a width change) starts a fresh
 * VibeState, and without this a beat hit could fire inside 4 s of the last one or 2 s of a drop.
 */
const limiter = { lastDropAt: -Infinity, lastBeatHitAt: -Infinity };
/** The limiter times as they stand (tests). */
export const vibeLimiterTimes = (): { lastDropAt: number; lastBeatHitAt: number } => ({ ...limiter });
/** Forget the limiter times (tests). */
export function resetVibeLimiter(): void {
  limiter.lastDropAt = -Infinity;
  limiter.lastBeatHitAt = -Infinity;
}
/** The sky band the aurora may fill, as a fraction of the place's height, and where it feathers out above the ridge. */
export const SKY_END = 0.48;
export const SKY_FEATHER = 0.16;
/** The art box: Listen's cover, or Watch's video. */
export const ART_SELECTOR = '.u-art, .w-screen';
/** The grain sheet's left edge when no rail is found, in stage pixels (the rail's right edge). */
export const SHEET_LEFT = 108;
const REBAKE_MS = 500;
/** Where `el` sits inside `root`, in the root's own (unscaled) layout pixels. */
export function boxIn(root: HTMLElement, el: HTMLElement): { x: number; y: number; w: number; h: number } {
  let x = 0;
  let y = 0;
  let n: HTMLElement | null = el;
  while (n && n !== root) {
    x += n.offsetLeft;
    y += n.offsetTop;
    n = n.offsetParent as HTMLElement | null;
  }
  return { x, y, w: el.offsetWidth, h: el.offsetHeight };
}

/**
 * The vibe's layers, mounted inside the Unwind place on Listen and Watch. The back canvas holds Aurora Veil in the sky
 * band and Bass Glow around the art (or the Watch video): half resolution, behind the place's own content (the art,
 * title and controls are DOM above it), starting right of the left wing. The front canvas holds Tape Grain and the Drop
 * Glitch as one even sheet from the rail's edge to the wall's right edge, over the scene, the video and Watt, and under
 * every word and control (the stylesheet lifts those above it). The loop runs only while an effect is above 0 and the
 * page is shown; it stops by itself and restarts on sound.
 */
export function VibeLayer({ host = browserHost }: { host?: LoopHost }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const frontRef = useRef<HTMLCanvasElement>(null);
  const reduced = useReducedMotion();
  useEffect(() => {
    const canvas = ref.current;
    const section = canvas?.parentElement;
    const ctx = canvas?.getContext('2d');
    const fcanvas = frontRef.current;
    const fctx = fcanvas?.getContext('2d');
    if (!canvas || !section || !ctx || !fcanvas || !fctx) return;
    const aurora = createAurora();
    const tape = createTape();
    const glitch = createGlitch();
    // The front layer: whether it drew last frame.
    let frontDrawn = false;
    // The grain's own gain: eased to zero over about a second when the loop runs over budget, so it never cuts.
    let grainGain = 1;
    let lastGainS = -1;
    let bakedW = 0;
    const gsrc: GlitchSources = { hz: null, map: { ax: 1, bx: 0, ay: 1, by: 0 }, img: null, art: { x: 0, y: 0, w: 0, h: 0 } };
    const state = createVibeState();
    // The drop clock is the audio tick clock; the newest detector drop counts even if this layer was not mounted for it.
    state.lastDropAt = Math.max(limiter.lastDropAt, audioDrops().lastAt / 1000);
    state.lastBeatHitAt = limiter.lastBeatHitAt;
    const frame = createVibeFrame();
    const probeOn = new URLSearchParams(location.search).get('vibeprobe') === '1';
    const probe = createProbe(() => console.info('vibe: frames over budget, dropping to 20 fps'));
    let left = 0;
    // The front sheet's own corner in the section's pixels (negative: it starts left of and above the place).
    let fl = 0;
    let ft = 0;
    let cw = 0;
    let ch = 0;
    let matte: Matte | null = null;
    let matteKey = '';
    let art = { x: 0, y: 0, w: 0, h: 0 };
    let skyFade: CanvasGradient | null = null;
    let lastDrops = audioDrops().count;
    let lastBeats = audioBeats().count;
    let lastTry = useTryStore.getState().count;
    let lastBake = -Infinity;
    let lastE = -1;
    let lastA = -1;
    let lastH = -1;
    let lastP = -1;
    let sig = '';
    // The two frame inputs are built once and refilled each frame.
    const input: VibeInput = { settings: vibeSettings(), playing: false, energy: 0 };
    const glowIn: GlowInput = { halo: 0, swell: 0, bass: 0, kick: 0 };
    const onImgLoad = (): void => later();
    let watched: HTMLImageElement | null = null;

    const measure = (): void => {
      const wing = section.querySelector<HTMLElement>('.u-wing');
      left = wing ? wing.offsetLeft + wing.offsetWidth : 0;
      const w = Math.max(0, section.offsetWidth - left);
      const h = section.offsetHeight;
      canvas.style.left = `${left}px`;
      canvas.style.width = `${w}px`;
      // The front sheet: from the rail's right edge to the stage's right edge, the stage's full height. The stage has
      // a transform, so its edges are read from its own layout, in the section's pixels.
      const stage = section.closest<HTMLElement>('.stage');
      const rail = stage?.querySelector<HTMLElement>('.rail');
      const at = stage ? boxIn(stage, section) : { x: 0, y: 0, w: 0, h: 0 };
      const railEdge = rail && rail.offsetWidth > 0 && stage ? (() => { const r = boxIn(stage, rail); return r.x + r.w; })() : SHEET_LEFT;
      const sheetW = stage ? Math.max(0, stage.offsetWidth - railEdge) : w;
      const sheetH = stage ? stage.offsetHeight : h;
      fl = stage ? railEdge - at.x : left;
      ft = stage ? -at.y : 0;
      fcanvas.style.left = `${fl}px`;
      fcanvas.style.top = `${ft}px`;
      fcanvas.style.width = `${sheetW}px`;
      fcanvas.style.height = `${sheetH}px`;
      const bw = Math.max(1, Math.round(w * BACKING));
      const bh = Math.max(1, Math.round(h * BACKING));
      const fw = Math.max(1, Math.round(sheetW * BACKING));
      const fh = Math.max(1, Math.round(sheetH * BACKING));
      if (bw !== canvas.width || bh !== canvas.height) {
        canvas.width = bw;
        canvas.height = bh;
        skyFade = null;
        lastE = -1;
      }
      if (fw !== fcanvas.width || fh !== fcanvas.height) {
        fcanvas.width = fw;
        fcanvas.height = fh;
        lastE = -1;
      }
      // The sprites are baked per instance and width: a remount that finds the canvas already sized still needs them.
      if (bakedW !== fw) {
        tape.bake(fctx, fw);
        glitch.bake(fw);
        bakedW = fw;
      }
      cw = bw;
      ch = bh;
      const el = section.querySelector<HTMLElement>(ART_SELECTOR);
      if (el) {
        const b = boxIn(section, el);
        art = { x: b.x - left, y: b.y, w: b.w, h: b.h };
        const img = el.querySelector('img');
        const ready = img && img.complete && img.naturalWidth > 0 ? img : null;
        // A cover that has not loaded yet bakes the plain fill; its load event changes the key and bakes the picture.
        const key = `${img?.getAttribute('src') ?? ''}|${ready ? 'ready' : 'wait'}|${b.w}x${b.h}|${radiusOf(el)}`;
        if (key !== matteKey && b.w > 0 && b.h > 0) {
          matteKey = key;
          matte = bakeMatte(ready, b.w, b.h, radiusOf(el));
        }
        if (img !== watched) {
          watched?.removeEventListener('load', onImgLoad);
          watched = img;
          // Kept for the element's life: the player reuses one img across tracks, and every new src fires load again.
          img?.addEventListener('load', onImgLoad);
        }
      } else {
        art = { x: 0, y: 0, w: 0, h: 0 };
        matte = null;
        matteKey = '';
      }
      gsrc.art.x = (art.x + left - fl) * BACKING;
      gsrc.art.y = (art.y - ft) * BACKING;
      gsrc.art.w = art.w * BACKING;
      gsrc.art.h = art.h * BACKING;
      gsrc.img = el?.querySelector('img') ?? null;
      const hzEl = document.querySelector<HTMLCanvasElement>('canvas.horizon-canvas:not(.horizon-front):not(.horizon-ground)');
      const hr = hzEl?.getBoundingClientRect();
      const sr = section.getBoundingClientRect();
      if (hzEl && hr && hr.width > 0 && hr.height > 0 && section.offsetWidth > 0) {
        const sc = sr.width / section.offsetWidth;
        const kx = hzEl.width / hr.width;
        const ky = hzEl.height / hr.height;
        gsrc.hz = hzEl;
        gsrc.map.ax = (sc * kx) / BACKING;
        gsrc.map.ay = (sc * ky) / BACKING;
        gsrc.map.bx = (sr.left + fl * sc - hr.left) * kx;
        gsrc.map.by = (sr.top + ft * sc - hr.top) * ky;
      } else gsrc.hz = null;
      // Churn that moves nothing (class changes under the observer) wakes nothing.
      const now = `${left}|${w}|${h}|${art.x}|${art.y}|${art.w}|${art.h}|${matteKey}|${fl}|${ft}|${sheetW}|${sheetH}`;
      if (now === sig) return;
      sig = now;
      loop.kick();
    };

    const draw = (ts: number): void => {
      const nowS = ts / 1000;
      const energy = audioEnergy();
      const tint: Rgb | null = useNowPlayingStore.getState().art ? (liveTint(ts).centre as Rgb) : null;
      if (ts - lastBake > REBAKE_MS) {
        lastBake = ts;
        aurora.bake(cw, ch, tint);
      }
      const audio = useAudioStore.getState();
      const still = reduced;
      const kick = still ? 0 : danceKick() * frame.kickGain;
      const bass = still ? 0.3 : audio.bass * frame.bassGain;
      if (still && Math.abs(energy - lastE) <= 0.1 && Math.abs(frame.aurora - lastA) + Math.abs(frame.halo - lastH) + Math.abs(frame.tape - lastP) < 0.004 && lastE >= 0) return;
      lastE = energy;
      lastA = frame.aurora;
      lastH = frame.halo;
      lastP = frame.tape;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.clearRect(0, 0, cw, ch);
      aurora.draw(ctx, cw, ch, still ? 0 : nowS, frame.aurora, frame.rich, frame.palette, kick);
      // Feather the veil out above the ridge: the dancing lines stay clean.
      if (!skyFade) {
        skyFade = ctx.createLinearGradient(0, ch * (SKY_END - SKY_FEATHER), 0, ch * SKY_END);
        softStops(skyFade, 0, 1, '0,0,0', 0, 1);
        skyFade.addColorStop(1, 'rgba(0,0,0,1)');
      }
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = skyFade;
      ctx.fillRect(0, ch * (SKY_END - SKY_FEATHER), cw, ch);
      ctx.globalCompositeOperation = 'source-over';
      if (matte && art.w > 0) {
        glowIn.halo = frame.halo;
        glowIn.swell = frame.haloSwell;
        glowIn.bass = bass;
        glowIn.kick = kick;
        drawGlow(ctx, matte, art.x * BACKING, art.y * BACKING, BACKING, glowIn);
      }
      // The front layer: Tape Grain and the Drop Glitch, one even sheet over the scene, the art and Watt, under every word.
      // The grain is the first thing to go when frames run long; both fade with their own eased strengths.
      const gainDt = lastGainS < 0 ? 0 : Math.min(0.25, Math.max(0, nowS - lastGainS));
      lastGainS = nowS;
      const gainTarget = probe.degraded ? 0 : 1;
      grainGain += Math.max(-gainDt, Math.min(gainDt, gainTarget - grainGain));
      const tapeAmt = frame.tape * grainGain;
      const tapeOn = tapeAmt > 0.003;
      const glitchAmt = still ? 0 : frame.glitch;
      if (tapeOn || (glitchAmt > 0.003 && frame.env > 0.003)) {
        fctx.setTransform(1, 0, 0, 1, 0, 0);
        fctx.globalCompositeOperation = 'source-over';
        fctx.globalAlpha = 1;
        fctx.clearRect(0, 0, fcanvas.width, fcanvas.height);
        if (tapeOn) tape.draw(fctx, fcanvas.width, fcanvas.height, still ? 0 : nowS, tapeAmt, frame.grain, still, still ? 0 : frame.grainKick);
        if (glitchAmt > 0.003) glitch.draw(fctx, fcanvas.width, fcanvas.height, nowS, state.drops, glitchAmt, gsrc, state.power, input.settings.dropGlitch, state.dur);
        frontDrawn = true;
      } else if (frontDrawn) {
        fctx.clearRect(0, 0, fcanvas.width, fcanvas.height);
        frontDrawn = false;
      }
    };

    const loop = createLoop(
      host,
      (ts, dt) => {
        const t0 = probeOn ? performance.now() : 0;
        const n = audioDrops().count;
        input.settings = vibeSettings();
        // A limiter time from ahead of this clock (a restarted clock) means nothing; forget it.
        if (state.lastDropAt > ts / 1000) state.lastDropAt = -Infinity;
        if (state.lastBeatHitAt > ts / 1000) state.lastBeatHitAt = -Infinity;
        if (counterAdvanced(n, lastDrops)) noteDrop(state, ts / 1000, audioDrops().strength, input.settings);
        lastDrops = n;
        const beats = audioBeats().count;
        if (counterAdvanced(beats, lastBeats)) {
          noteKick(state, ts / 1000);
          noteBeatHit(state, ts / 1000, audioBeats().strength, input.settings);
        }
        limiter.lastDropAt = state.lastDropAt;
        limiter.lastBeatHitAt = state.lastBeatHitAt;
        lastBeats = beats;
        const tries = useTryStore.getState().count;
        if (tries > lastTry && input.settings.dropGlitch !== 'off') noteTry(state, ts / 1000, input.settings);
        lastTry = tries;
        input.reduced = reduced;
        input.playing = useAudioStore.getState().playing;
        input.energy = audioEnergy();
        stepVibe(state, frame, dt, ts / 1000, input);
        if (!frame.active) {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          fctx.clearRect(0, 0, fcanvas.width, fcanvas.height);
          frontDrawn = false;
          lastE = -1;
          return false;
        }
        draw(ts);
        if (probeOn) {
          probe.add(performance.now() - t0, ts);
          canvas.dataset.vibeMs = probe.meanMs.toFixed(2);
        }
        return true;
      },
      () => (probe.degraded ? DEGRADED_FRAME_MS : 31),
    );
    const kick = (): void => loop.kick();
    const offAudio = useAudioStore.subscribe((s, prev) => {
      if (s.playing !== prev.playing || (s.playing && !loop.running)) kick();
    });
    const offSettings = useVibeStore.subscribe(kick);
    const offTry = useTryStore.subscribe(kick);
    // Layout reads once per frame at most, however many changes come at once.
    let pending = 0;
    const later = (): void => {
      if (pending) return;
      pending = host.raf(() => {
        pending = 0;
        measure();
      });
    };
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(later) : null;
    ro?.observe(section);
    const mo = new MutationObserver(later);
    mo.observe(section, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'class'] });
    document.addEventListener('visibilitychange', kick);
    measure();
    return () => {
      loop.stop();
      // A remount (the reduced-motion toggle, a width change) starts with frontDrawn false: leave no old pixels behind.
      fctx.clearRect(0, 0, fcanvas.width, fcanvas.height);
      frontDrawn = false;
      if (pending) host.caf(pending);
      offAudio();
      offSettings();
      offTry();
      ro?.disconnect();
      watched?.removeEventListener('load', onImgLoad);
      mo.disconnect();
      document.removeEventListener('visibilitychange', kick);
    };
  }, [host, reduced]);
  return (
    <>
      <canvas ref={ref} className="vibe-back" aria-hidden="true" data-vibe="back" />
      <canvas ref={frontRef} className="vibe-front" aria-hidden="true" data-vibe="front" />
    </>
  );
}
