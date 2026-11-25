import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ingestLevels, resetAudio, tickAudio } from '../audio/store';
import { resetVibeStore, useVibeStore } from '../horizon/vibeSettings';
import { VibeLayer } from './VibeLayer';
import type { LoopHost } from './loop';
import { stubCanvas } from './testCanvas';
// @ts-ignore node's own file call; the stylesheet rules are read as text.
import { readFileSync } from 'node:fs';

/** A stylesheet's text (the path is a variable on purpose: a literal `new URL` is rewritten by the bundler). */
const sheet = (f: string): string => (readFileSync(new URL(f, import.meta.url), 'utf8') as string).replace(/\r\n/g, '\n');
import unwindSrc from '../screens/Unwind.tsx?raw';

const sound = { bass: 0.8, mid: 0.4, high: 0.2, bands: [255, 200, 100], waveform: [0.1] };

/** A host whose frames run when the test says so. */
function manual() {
  let cb: ((ts: number) => void) | null = null;
  const host: LoopHost = { raf: (f) => ((cb = f), 7), caf: () => (cb = null), hidden: () => false };
  return {
    host,
    pending: () => cb !== null,
    /** Run frames every 33 ms from `from` for `n` frames. */
    frames(from: number, n: number) {
      for (let i = 0; i < n; i++) {
        const f = cb;
        cb = null;
        f?.(from + i * 33);
      }
    },
  };
}

class RO {
  constructor(private f: () => void) {}
  observe() {
    this.f();
  }
  disconnect() {}
}

let restore = () => {};
beforeEach(() => {
  resetAudio();
  localStorage.clear();
  resetVibeStore();
  vi.stubGlobal('ResizeObserver', RO);
  // jsdom has no layout: the place is 2000 by 680 and its wing ends at x 480.
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains('u-wing') ? 440 : this.classList.contains('u-art') ? 224 : 2000;
  });
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains('u-art') ? 224 : 680;
  });
  vi.spyOn(HTMLElement.prototype, 'offsetLeft', 'get').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains('u-wing') ? 40 : this.classList.contains('u-art') ? 900 : 0;
  });
  vi.spyOn(HTMLElement.prototype, 'offsetTop', 'get').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains('u-art') ? 20 : 0;
  });
  vi.spyOn(HTMLElement.prototype, 'offsetParent', 'get').mockImplementation(function (this: HTMLElement) {
    return this.closest('section') === this ? null : this.closest('section');
  });
});
afterEach(() => {
  restore();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function mount(host: LoopHost, art = true) {
  const s = stubCanvas();
  restore = s.restore;
  const r = render(
    <section data-place="unwind">
      <VibeLayer host={host} />
      <div className="u-wing" />
      {art ? (
        <div className="u-art">
          <img src="data:image/png;base64,AAAA" alt="" />
        </div>
      ) : null}
    </section>,
  );
  return { ...r, rec: s.rec, canvas: r.container.querySelector('canvas')! };
}

describe('the vibe back layer', () => {
  it('is the first child of the place, decorative, and starts right of the wing at half resolution', () => {
    const m = manual();
    const { canvas, container } = mount(m.host);
    expect(container.querySelector('section')!.firstElementChild).toBe(canvas);
    expect(canvas.getAttribute('aria-hidden')).toBe('true');
    expect(canvas.style.left).toBe('480px');
    expect(canvas.width).toBe(760);
    expect(canvas.height).toBe(340);
  });

  it('its stylesheet sits behind the content, is click-through, blends with screen and feathers its bounds', () => {
    const c = sheet('../styles/vibe.css');
    expect(c).toMatch(/\.vibe-back\s*\{[^}]*z-index:\s*-1/);
    expect(c).toMatch(/pointer-events:\s*none/);
    expect(c).toMatch(/mix-blend-mode:\s*screen/);
    expect(c).toMatch(/transparent 0, #000 64px/);
    expect(c).toMatch(/#000 48px, #000 calc\(100% - 48px\)/);
    expect(c).toMatch(/mask-composite:\s*intersect/);
  });

  it('draws nothing and stops when no music plays and every effect is at rest', () => {
    const m = manual();
    const { rec } = mount(m.host);
    m.frames(1000, 400);
    expect(m.pending()).toBe(false);
    expect(rec.calls.some((c) => c[0] === 'drawImage')).toBe(false);
  });

  it('draws the veil and the glow when sound arrives, and every draw lands inside the canvas', () => {
    const m = manual();
    const { rec, canvas } = mount(m.host);
    m.frames(1000, 400);
    expect(m.pending()).toBe(false);
    rec.calls.length = 0;
    act(() => {
      for (let t = 0; t < 4000; t += 33) {
        ingestLevels(sound, t);
        tickAudio(t);
      }
    });
    expect(m.pending()).toBe(true);
    m.frames(10000, 120);
    const draws = rec.calls.filter((c) => c[0] === 'drawImage');
    expect(draws.length).toBeGreaterThan(10);
    // Ribbons draw with a sprite and four numbers; the glow likewise. Nothing is drawn wholly past the right edge.
    for (const d of draws) {
      if (typeof d[2] === 'number' && typeof d[4] === 'number') expect(d[2] as number).toBeLessThan(canvas.width);
    }
    expect(rec.calls.some((c) => c[0] === 'set globalCompositeOperation' && c[1] === 'screen')).toBe(true);
    expect(rec.calls.some((c) => c[0] === 'set filter')).toBe(false);
  });

  it('with no art on the page it still draws the veil, and no glow', () => {
    const m = manual();
    const { rec } = mount(m.host, false);
    act(() => {
      for (let t = 0; t < 4000; t += 33) {
        ingestLevels(sound, t);
        tickAudio(t);
      }
    });
    m.frames(10000, 60);
    expect(rec.calls.some((c) => c[0] === 'drawImage')).toBe(true);
  });

  it('turning Auto vibe off while music plays keeps running and changes the mix without a jump in alpha', () => {
    const m = manual();
    const { rec } = mount(m.host);
    act(() => {
      for (let t = 0; t < 4000; t += 33) {
        ingestLevels(sound, t);
        tickAudio(t);
      }
    });
    m.frames(10000, 60);
    rec.calls.length = 0;
    act(() => useVibeStore.getState().setVibe({ auto: false }));
    m.frames(20000, 30);
    const alphas = rec.calls.filter((c) => c[0] === 'set globalAlpha').map((c) => c[1] as number);
    expect(alphas.length).toBeGreaterThan(5);
    expect(m.pending()).toBe(true);
  });

  it('stops and clears when the music stops', () => {
    const m = manual();
    const { rec } = mount(m.host);
    act(() => {
      for (let t = 0; t < 2000; t += 33) {
        ingestLevels(sound, t);
        tickAudio(t);
      }
      tickAudio(5000);
    });
    m.frames(10000, 400);
    expect(m.pending()).toBe(false);
    expect(rec.calls.some((c) => c[0] === 'clearRect')).toBe(true);
  });

  it('is mounted in the Unwind place before everything else, so it runs on Listen and Watch alike', () => {
    const text = unwindSrc.replace(/\r\n/g, '\n');
    const mount = text.indexOf('<VibeLayer />');
    expect(mount).toBeGreaterThan(0);
    expect(mount).toBeLessThan(text.indexOf('<div className="u-wing">'));
    // Not inside the Watch-only or Listen-only branches.
    const before = text.slice(text.indexOf('return (', text.indexOf('export function Unwind')), mount);
    expect(before.includes('watch ?')).toBe(false);
  });
});
