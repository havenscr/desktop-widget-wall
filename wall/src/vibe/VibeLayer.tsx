import { useEffect, useRef } from 'react';
import { audioDrops, audioEnergy, danceKick, useAudioStore } from '../audio/store';
import { vibeSettings, useVibeStore } from '../horizon/vibeSettings';
import { liveTint, type Rgb } from '../music/coverTint';
import { useNowPlayingStore } from '../music/store';
import { useReducedMotion } from '../ui/useReducedMotion';
import { createAurora } from './aurora';
import { createGlitch, type GlitchSources } from './glitch';
import { bakeHole } from './holes';
import { createTape } from './tape';
import { bakeMatte, radiusOf, type Matte } from './artMatte';
import { drawGlow, type GlowInput } from './glow';
import { DEGRADED_FRAME_MS, browserHost, createLoop, createProbe, type LoopHost } from './loop';
import { createVibeFrame, createVibeState, noteDrop, stepVibe, type VibeInput } from './mix';
import { softStops } from './feather';

/** Backing store scale: the canvas is drawn at half resolution and scaled up by CSS. */
export const BACKING = 0.5;
/** The sky band the aurora may fill, as a fraction of the place's height, and where it feathers out above the ridge. */
export const SKY_END = 0.48;
export const SKY_FEATHER = 0.16;
/** The art box: Listen's cover, or Watch's video. */
export const ART_SELECTOR = '.u-art, .w-screen';
/** The song title: Listen's line, or Watch's. Scene and title lets the effects pass over it. */
export const TITLE_SELECTOR = '.u-np, .w-title';
/** Layout pixels the title's own canvas reaches past the letters; its mask is a bell that is zero at the canvas edge, so no edge shows. */
export const TITLE_PAD_X = 120;
export const TITLE_PAD_Y = 64;
/** How much of the picture under the title the title's canvas adds back; the back layer already shows through behind the letters. */
const TITLE_PASS = 0.4;
/** What the front layer (grain and glitch) must leave clear: controls, readouts and the lists. They get a soft hole. */
export const PROTECT_SELECTOR = 'button, [role="slider"], [role="switch"], [role="radio"], input, .u-progress, .u-transport, .w-ctl, .w-time, .u-src, .w-sub, .u-right, .w-sheet';
const HOLE_PAD = 6;
const HOLE_BLUR = 6;
const REBAKE_MS = 500;

/** The width of `el`'s text in the root's layout pixels, at most `max`; `max` itself where a range cannot be measured. */
export function textWidth(el: HTMLElement, root: HTMLElement, max: number): number {
  try {
    const r = document.createRange();
    r.selectNodeContents(el);
    const w = r.getBoundingClientRect().width;
    const scale = root.offsetWidth > 0 ? root.getBoundingClientRect().width / root.offsetWidth : 1;
    if (w > 0 && scale > 0) return Math.min(max, w / scale);
  } catch {
    /* no layout here */
  }
  return max;
}

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
 * The vibe's back layer, mounted inside the Unwind place on Listen and Watch: Aurora Veil in the sky band and
 * Bass Glow around the art (or the Watch video). One canvas, half resolution, behind the place's own content (the art,
 * title and controls are DOM above it), starting right of the left wing so it never touches the clock or the
 * tabs. The loop runs only while an effect is above 0 and the page is shown; it stops by itself and restarts on sound.
 */
export function VibeLayer({ host = browserHost }: { host?: LoopHost }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const titleRef = useRef<HTMLCanvasElement>(null);
  const frontRef = useRef<HTMLCanvasElement>(null);
  const reduced = useReducedMotion();
  useEffect(() => {
    const canvas = ref.current;
    const section = canvas?.parentElement;
    const ctx = canvas?.getContext('2d');
    const tcanvas = titleRef.current;
    const tctx = tcanvas?.getContext('2d');
    const fcanvas = frontRef.current;
    const fctx = fcanvas?.getContext('2d');
    if (!canvas || !section || !ctx || !tcanvas || !tctx || !fcanvas || !fctx) return;
    const aurora = createAurora();
    const tape = createTape();
    const glitch = createGlitch();
    // The front layer's pieces: the hole masks, what the glitch copies from, and whether it drew last frame.
    let holes: HTMLCanvasElement | null = null;
    let titleHole: HTMLCanvasElement | null = null;
    let holeKey = '';
    let frontDrawn = false;
    // The grain's own gain: eased to zero over about a second when the loop runs over budget, so it never cuts.
    let grainGain = 1;
    let lastGainS = -1;
    let bakedW = 0;
    const gsrc: GlitchSources = { hz: null, map: { ax: 1, bx: 0, ay: 1, by: 0 }, img: null, art: { x: 0, y: 0, w: 0, h: 0 } };
    const state = createVibeState();
    const frame = createVibeFrame();
    const probeOn = new URLSearchParams(location.search).get('vibeprobe') === '1';
    const probe = createProbe(() => console.info('vibe: frames over budget, dropping to 20 fps'));
    let left = 0;
    let cw = 0;
    let ch = 0;
    let matte: Matte | null = null;
    let matteKey = '';
    let art = { x: 0, y: 0, w: 0, h: 0 };
    let skyFade: CanvasGradient | null = null;
    let lastDrops = audioDrops().count;
    let lastBake = -Infinity;
    let lastE = -1;
    let lastA = -1;
    let lastH = -1;
    let lastT = -1;
    let lastP = -1;
    let titleOn = false;
    // Where the title's own canvas copies from the back canvas, in back canvas pixels, and its size in its own.
    const tbox = { sx: 0, sy: 0, sw: 0, sh: 0, dw: 0, dh: 0 };
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
      fcanvas.style.left = `${left}px`;
      fcanvas.style.width = `${w}px`;
      const bw = Math.max(1, Math.round(w * BACKING));
      const bh = Math.max(1, Math.round(h * BACKING));
      if (bw !== canvas.width || bh !== canvas.height) {
        canvas.width = bw;
        canvas.height = bh;
        fcanvas.width = bw;
        fcanvas.height = bh;
        holeKey = '';
        skyFade = null;
        lastE = -1;
      }
      // The sprites are baked per instance and width: a remount that finds the canvas already sized still needs them.
      if (bakedW !== bw) {
        tape.bake(fctx, bw);
        glitch.bake(bw);
        bakedW = bw;
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
      const tel = section.querySelector<HTMLElement>(TITLE_SELECTOR);
      let tx = 0;
      let ty = 0;
      let tw = 0;
      let th = 0;
      if (tel && tel.offsetWidth > 0) {
        const b = boxIn(section, tel);
        // Round the letters, not the line's whole box (a title line is as wide as its column).
        const letters = textWidth(tel, section, b.w);
        tx = b.x - TITLE_PAD_X;
        ty = b.y - TITLE_PAD_Y;
        tw = letters + 2 * TITLE_PAD_X;
        th = b.h + 2 * TITLE_PAD_Y;
      }
      tcanvas.style.left = `${tx}px`;
      tcanvas.style.top = `${ty}px`;
      tcanvas.style.width = `${tw}px`;
      tcanvas.style.height = `${th}px`;
      tbox.dw = Math.max(1, Math.round(tw * BACKING));
      tbox.dh = Math.max(1, Math.round(th * BACKING));
      if (tcanvas.width !== tbox.dw || tcanvas.height !== tbox.dh) {
        tcanvas.width = tbox.dw;
        tcanvas.height = tbox.dh;
        lastT = -1;
      }
      tbox.sx = (tx - left) * BACKING;
      tbox.sy = ty * BACKING;
      tbox.sw = tw * BACKING;
      tbox.sh = th * BACKING;
      titleOn = tw > 0;
      // The front layer: soft holes over the controls and the title, and where the glitch reads the horizon from.
      const rects: number[] = [];
      for (const n of section.querySelectorAll<HTMLElement>(PROTECT_SELECTOR)) {
        if (n.offsetWidth <= 0 || n.offsetHeight <= 0) continue;
        const b = boxIn(section, n);
        rects.push((b.x - left - HOLE_PAD) * BACKING, (b.y - HOLE_PAD) * BACKING, (b.w + 2 * HOLE_PAD) * BACKING, (b.h + 2 * HOLE_PAD) * BACKING);
      }
      const trects: number[] = [];
      if (tw > 0) trects.push((tx + TITLE_PAD_X - HOLE_PAD - left) * BACKING, (ty + TITLE_PAD_Y - HOLE_PAD) * BACKING, (tw - 2 * TITLE_PAD_X + 2 * HOLE_PAD) * BACKING, (th - 2 * TITLE_PAD_Y + 2 * HOLE_PAD) * BACKING);
      const hk = `${bw}x${bh}|${rects.join(',')}|${trects.join(',')}`;
      if (hk !== holeKey) {
        holeKey = hk;
        holes = bakeHole(bw, bh, rects, HOLE_BLUR);
        titleHole = bakeHole(bw, bh, trects, HOLE_BLUR);
      }
      gsrc.art.x = art.x * BACKING;
      gsrc.art.y = art.y * BACKING;
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
        gsrc.map.bx = (sr.left + left * sc - hr.left) * kx;
        gsrc.map.by = (sr.top - hr.top) * ky;
      } else gsrc.hz = null;
      // Churn that moves nothing (class changes under the observer) wakes nothing.
      const now = `${left}|${w}|${h}|${art.x}|${art.y}|${art.w}|${art.h}|${matteKey}|${tx}|${ty}|${tw}|${th}|${holeKey}`;
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
      if (still && Math.abs(energy - lastE) <= 0.1 && Math.abs(frame.aurora - lastA) + Math.abs(frame.halo - lastH) + Math.abs(frame.titleCover - lastT) + Math.abs(frame.tape - lastP) < 0.004 && lastE >= 0) return;
      lastE = energy;
      lastA = frame.aurora;
      lastH = frame.halo;
      lastT = frame.titleCover;
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
      // Scene and title: the title's own canvas lies over the title and shows the part of this picture under it.
      // Scene only: it fades out (the plan's 0.2 s ease on the cover change), leaving the title clean.
      const pass = (1 - frame.titleCover) * TITLE_PASS;
      tctx.clearRect(0, 0, tcanvas.width, tcanvas.height);
      if (titleOn && pass > 0.004 && (frame.aurora > 0.003 || frame.halo > 0.003 || frame.haloSwell > 0.003)) {
        tctx.globalAlpha = pass;
        tctx.drawImage(canvas, tbox.sx, tbox.sy, tbox.sw, tbox.sh, 0, 0, tbox.dw, tbox.dh);
        tctx.globalAlpha = 1;
      }
      // The front layer: Tape Grain and the Drop Glitch over the scene and the art, with soft holes over the controls.
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
        fctx.clearRect(0, 0, cw, ch);
        if (tapeOn) tape.draw(fctx, cw, ch, still ? 0 : nowS, tapeAmt, frame.grain, still);
        if (glitchAmt > 0.003) glitch.draw(fctx, cw, ch, nowS, state.drops, glitchAmt, gsrc);
        fctx.globalCompositeOperation = 'destination-out';
        fctx.globalAlpha = 1;
        if (holes) fctx.drawImage(holes, 0, 0);
        if (frame.titleCover > 0.004 && titleHole) {
          fctx.globalAlpha = frame.titleCover;
          fctx.drawImage(titleHole, 0, 0);
          fctx.globalAlpha = 1;
        }
        fctx.globalCompositeOperation = 'source-over';
        frontDrawn = true;
      } else if (frontDrawn) {
        fctx.clearRect(0, 0, cw, ch);
        frontDrawn = false;
      }
    };

    const loop = createLoop(
      host,
      (ts, dt) => {
        const t0 = probeOn ? performance.now() : 0;
        const n = audioDrops().count;
        if (n > lastDrops) noteDrop(state, ts / 1000);
        lastDrops = n;
        input.settings = vibeSettings();
        input.playing = useAudioStore.getState().playing;
        input.energy = audioEnergy();
        stepVibe(state, frame, dt, ts / 1000, input);
        if (!frame.active) {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          tctx.clearRect(0, 0, tcanvas.width, tcanvas.height);
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
      ro?.disconnect();
      watched?.removeEventListener('load', onImgLoad);
      mo.disconnect();
      document.removeEventListener('visibilitychange', kick);
    };
  }, [host, reduced]);
  return (
    <>
      <canvas ref={ref} className="vibe-back" aria-hidden="true" data-vibe="back" />
      <canvas ref={titleRef} className="vibe-title" aria-hidden="true" data-vibe="title" />
      <canvas ref={frontRef} className="vibe-front" aria-hidden="true" data-vibe="front" />
    </>
  );
}
