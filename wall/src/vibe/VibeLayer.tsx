import { useEffect, useRef } from 'react';
import { audioDrops, audioEnergy, danceKick, useAudioStore } from '../audio/store';
import { vibeSettings, useVibeStore } from '../horizon/vibeSettings';
import { liveTint, type Rgb } from '../music/coverTint';
import { useNowPlayingStore } from '../music/store';
import { useReducedMotion } from '../ui/useReducedMotion';
import { createAurora } from './aurora';
import { bakeMatte, radiusOf, type Matte } from './artMatte';
import { drawGlow } from './glow';
import { DEGRADED_FRAME_MS, browserHost, createLoop, createProbe, type LoopHost } from './loop';
import { createVibeFrame, createVibeState, noteDrop, stepVibe } from './mix';
import { softStops } from './feather';

/** Backing store scale: the canvas is drawn at half resolution and scaled up by CSS. */
export const BACKING = 0.5;
/** The sky band the aurora may fill, as a fraction of the place's height, and where it feathers out above the ridge. */
export const SKY_END = 0.48;
export const SKY_FEATHER = 0.16;
/** The art box: Listen's cover, or Watch's video. */
export const ART_SELECTOR = '.u-art, .w-screen';
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
 * The vibe's back layer, mounted inside the Unwind place on Listen and Watch: Aurora Veil in the sky band and
 * Bass Glow around the art (or the Watch video). One canvas, half resolution, behind the place's own content (the art,
 * title and controls are DOM above it), starting right of the left wing so it never touches the clock or the
 * tabs. The loop runs only while an effect is above 0 and the page is shown; it stops by itself and restarts on sound.
 */
export function VibeLayer({ host = browserHost }: { host?: LoopHost }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const reduced = useReducedMotion();
  useEffect(() => {
    const canvas = ref.current;
    const section = canvas?.parentElement;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !section || !ctx) return;
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

    const measure = (): void => {
      const wing = section.querySelector<HTMLElement>('.u-wing');
      left = wing ? wing.offsetLeft + wing.offsetWidth : 0;
      const w = Math.max(0, section.offsetWidth - left);
      const h = section.offsetHeight;
      canvas.style.left = `${left}px`;
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
        const key = `${img?.getAttribute('src') ?? ''}|${b.w}x${b.h}|${radiusOf(el)}`;
        if (key !== matteKey && b.w > 0 && b.h > 0) {
          matteKey = key;
          const ready = img && img.complete && img.naturalWidth > 0 ? img : null;
          matte = bakeMatte(ready, b.w, b.h, radiusOf(el));
        }
      } else {
        art = { x: 0, y: 0, w: 0, h: 0 };
        matte = null;
        matteKey = '';
      }
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
      if (still && Math.abs(energy - lastE) <= 0.1 && Math.abs(frame.aurora - lastA) + Math.abs(frame.halo - lastH) < 0.004 && lastE >= 0) return;
      lastE = energy;
      lastA = frame.aurora;
      lastH = frame.halo;
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
      if (matte && art.w > 0) drawGlow(ctx, matte, art.x * BACKING, art.y * BACKING, BACKING, { halo: frame.halo, swell: frame.haloSwell, bass, kick });
    };

    const loop = createLoop(
      host,
      (ts, dt) => {
        const t0 = probeOn ? performance.now() : 0;
        const n = audioDrops().count;
        if (n > lastDrops) noteDrop(state, ts / 1000);
        lastDrops = n;
        stepVibe(state, frame, dt, ts / 1000, { settings: vibeSettings(), playing: useAudioStore.getState().playing, energy: audioEnergy() });
        if (!frame.active) {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
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
      mo.disconnect();
      document.removeEventListener('visibilitychange', kick);
    };
  }, [host, reduced]);
  return <canvas ref={ref} className="vibe-back" aria-hidden="true" data-vibe="back" />;
}
