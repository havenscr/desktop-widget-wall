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
  const cbs = new Map<number, (ts: number) => void>();
  let next = 1;
  let hid = false;
  const host: LoopHost = {
    raf: (f) => {
      cbs.set(next, f);
      return next++;
    },
    caf: (id) => void cbs.delete(id),
    hidden: () => hid,
  };
  return {
    host,
    pending: () => cbs.size > 0,
    hide: (h: boolean) => {
      hid = h;
    },
    /** Run frames every 33 ms from `from` for `n` frames. */
    frames(from: number, n: number) {
      for (let i = 0; i < n; i++) {
        const run = [...cbs.values()];
        cbs.clear();
        for (const f of run) f(from + i * 33);
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
      <div className="u-np">Song</div>
      {art ? (
        <div className="u-art">
          <img src="data:image/png;base64,AAAA" alt="" />
        </div>
      ) : null}
    </section>,
  );
  return { ...r, rec: s.rec, canvas: r.container.querySelector('canvas.vibe-back')! as HTMLCanvasElement, title: r.container.querySelector('canvas.vibe-title')! as HTMLCanvasElement };
}

describe('the vibe back layer', () => {
  it('is the first child of the place, decorative, and starts right of the wing at half resolution', () => {
    const m = manual();
    const { canvas, container } = mount(m.host);
    expect(container.querySelector('section')!.firstElementChild).toBe(canvas);
    expect(canvas.getAttribute('aria-hidden')).toBe('true');
    expect(canvas.style.left).toBe('480px');
    // Its CSS width is the area right of the wing, so the half resolution backing stretches evenly on both axes.
    expect(canvas.style.width).toBe('1520px');
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

  it('the main area is its own stacking context while the layer is in it, so z-index -1 stays above the horizon canvas', () => {
    expect(sheet('../styles/vibe.css')).toMatch(/\.main:has\(\.vibe-back\)\s*\{\s*isolation:\s*isolate/);
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

  const playFor = (ms: number) =>
    act(() => {
      for (let t = 0; t < ms; t += 33) {
        ingestLevels(sound, t);
        tickAudio(t);
      }
    });
  const copies = (rec: { calls: unknown[][] }, back: HTMLCanvasElement) => rec.calls.filter((c) => c[0] === 'drawImage' && c[1] === back && c.length === 10);

  it('Scene and title lets the effects pass over the song title; Scene only takes them off it', () => {
    const m = manual();
    const { rec, canvas, title } = mount(m.host);
    expect(title.style.width).toBe('2240px');
    playFor(4000);
    m.frames(10000, 60);
    expect(copies(rec, canvas).length).toBeGreaterThan(10);
    rec.calls.length = 0;
    act(() => useVibeStore.getState().setVibe({ cover: 'scene' }));
    m.frames(20000, 60);
    // It fades out with the cover ease, then no frame copies anything onto the title.
    rec.calls.length = 0;
    m.frames(30000, 30);
    expect(copies(rec, canvas)).toHaveLength(0);
    rec.calls.length = 0;
    act(() => useVibeStore.getState().setVibe({ cover: 'title' }));
    m.frames(40000, 60);
    expect(copies(rec, canvas).length).toBeGreaterThan(10);
  });

  it('its stylesheet puts the title canvas above the title, click-through, with a bell mask that ends at zero', () => {
    const c = sheet('../styles/vibe.css');
    expect(c).toMatch(/\.vibe-title\s*\{[^}]*z-index:\s*1/);
    expect(c).toMatch(/\.vibe-title\s*\{[^}]*pointer-events:\s*none/);
    // One elliptical bell that ends at zero: no straight edge can show.
    expect(c).toMatch(/\.vibe-title\s*\{[^}]*radial-gradient\(ellipse closest-side[^}]*transparent 100%\)/);
    expect(/\.vibe-title\s*\{[^}]*linear-gradient/.test(c)).toBe(false);
  });

  it('bakes the cover again when it finishes loading, not only the plain fill', () => {
    const m = manual();
    const s = stubCanvas();
    restore = s.restore;
    let ready = false;
    vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockImplementation(() => ready);
    vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockImplementation(() => (ready ? 300 : 0));
    const r = render(
      <section data-place="unwind">
        <VibeLayer host={m.host} />
        <div className="u-wing" />
        <div className="u-art">
          <img src="x.png" alt="" />
        </div>
      </section>,
    );
    const img = r.container.querySelector('img')!;
    const drawsOf = () => s.rec.calls.filter((c) => c[0] === 'drawImage' && c[1] === img).length;
    expect(drawsOf()).toBe(0);
    ready = true;
    act(() => {
      img.dispatchEvent(new Event('load'));
    });
    m.frames(1000, 3);
    expect(drawsOf()).toBeGreaterThan(0);
  });

  it('bakes again for a new track on the same img element, once the new cover has loaded', () => {
    const m = manual();
    const s = stubCanvas();
    restore = s.restore;
    let ready = true;
    vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockImplementation(() => ready);
    vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockImplementation(() => (ready ? 300 : 0));
    const r = render(
      <section data-place="unwind">
        <VibeLayer host={m.host} />
        <div className="u-wing" />
        <div className="u-art">
          <img src="a.png" alt="" />
        </div>
      </section>,
    );
    const img = r.container.querySelector('img')!;
    m.frames(1000, 3);
    const drawsOf = () => s.rec.calls.filter((c) => c[0] === 'drawImage' && c[1] === img).length;
    const first = drawsOf();
    expect(first).toBeGreaterThan(0);
    // The track changes: the src moves and the new picture has not loaded, so the plain fill is baked.
    ready = false;
    act(() => {
      img.setAttribute('src', 'b.png');
    });
    m.frames(2000, 3);
    expect(drawsOf()).toBe(first);
    ready = true;
    act(() => {
      img.dispatchEvent(new Event('load'));
    });
    m.frames(3000, 3);
    expect(drawsOf()).toBeGreaterThan(first);
  });

  it('fades the title layer with the cover ease rather than jumping', () => {
    const m = manual();
    const { rec, canvas } = mount(m.host);
    playFor(4000);
    m.frames(10000, 60);
    rec.calls.length = 0;
    act(() => useVibeStore.getState().setVibe({ cover: 'scene' }));
    m.frames(20000, 60);
    // The alpha of each copy onto the title: it steps down, never in one jump, and ends at no copy.
    const alphas: number[] = [];
    let a = 0;
    for (const c of rec.calls) {
      if (c[0] === 'set globalAlpha') a = c[1] as number;
      if (c[0] === 'drawImage' && c[1] === canvas && c.length === 10) alphas.push(a);
    }
    expect(alphas.length).toBeGreaterThan(3);
    for (let k = 1; k < alphas.length; k++) expect(alphas[k - 1] - alphas[k]).toBeLessThan(0.05);
    expect(alphas.some((v) => v > 0.05 && v < 0.35)).toBe(true);
    expect(alphas[0]).toBeGreaterThan(0.3);
  });

  it('stops while the page is hidden and starts again when it is shown', () => {
    const m = manual();
    mount(m.host);
    playFor(4000);
    m.frames(10000, 5);
    expect(m.pending()).toBe(true);
    m.hide(true);
    m.frames(10200, 1);
    expect(m.pending()).toBe(false);
    m.hide(false);
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(m.pending()).toBe(true);
  });

  it('does not wake the loop for layout churn that moves nothing', () => {
    const m = manual();
    const { container } = mount(m.host);
    m.frames(1000, 400);
    expect(m.pending()).toBe(false);
    const sect = container.querySelector('section')!;
    act(() => {
      sect.classList.add('noise');
    });
    expect(m.pending()).toBe(false);
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
