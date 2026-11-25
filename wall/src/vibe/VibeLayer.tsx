import { useEffect, useRef } from 'react';
import { audioDrops, audioEnergy, danceKick, useAudioStore } from '../audio/store';
import { vibeSettings, useVibeStore } from '../horizon/vibeSettings';
import { liveTint, type Rgb } from '../music/coverTint';
import { useNowPlayingStore } from '../music/store';
import { useReducedMotion } from '../ui/useReducedMotion';
import { createAurora } from './aurora';
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
  const reduced = useReducedMotion();
  useEffect(() => {
    const canvas = ref.current;
    const section = canvas?.parentElement;
    const ctx = canvas?.getContext('2d');
    const tcanvas = titleRef.current;
    const tctx = tcanvas?.getContext('2d');
    if (!canvas || !section || !ctx || !tcanvas || !tctx) return;
    const aurora = createAurora();
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
      const bw = Math.max(1, Math.round(w * BACKING));
      const bh = Math.max(1, Math.round(h * BACKING));
      if (bw !== canvas.width || bh !== canvas.height) {
        canvas.width = bw;
        canvas.height = bh;
        skyFade = null;
        lastE = -1;
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
          if (img && !ready) img.addEventListener('load', onImgLoad);
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
      // Churn that moves nothing (class changes under the observer) wakes nothing.
      const now = `${left}|${w}|${h}|${art.x}|${art.y}|${art.w}|${art.h}|${matteKey}|${tx}|${ty}|${tw}|${th}`;
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
      if (still && Math.abs(energy - lastE) <= 0.1 && Math.abs(frame.aurora - lastA) + Math.abs(frame.halo - lastH) + Math.abs(frame.titleCover - lastT) < 0.004 && lastE >= 0) return;
      lastE = energy;
      lastA = frame.aurora;
      lastH = frame.halo;
      lastT = frame.titleCover;
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
    </>
  );
}
