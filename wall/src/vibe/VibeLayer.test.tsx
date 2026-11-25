import { act, cleanup, render } from '@testing-library/react';
import { Fragment, StrictMode } from 'react';
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

// The drop stamps are the one signal a test cannot easily make by sound: this lets a test add a drop by hand.
const fakeDrops = vi.hoisted(() => ({ count: 0, lastAt: -Infinity }));
vi.mock('../audio/store', async (orig) => ({
  ...(await orig<typeof import('../audio/store')>()),
  audioDrops: () => fakeDrops,
}));

const sound = {
  bass: 0.8,
  mid: 0.4,
  high: 0.2,
  bands: [255, 200, 100],
  waveform: [0.1],
};

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
  fakeDrops.count = 0;
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(() => ({
    left: 0,
    top: 0,
    right: 2560,
    bottom: 720,
    width: 2560,
    height: 720,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  }));
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

function mount(host: LoopHost, art = true, horizon = false, strict = false) {
  const s = stubCanvas();
  restore = s.restore;
  const Wrap = strict ? StrictMode : Fragment;
  const r = render(
    <Wrap>
      {horizon ? <canvas className="horizon-canvas" /> : null}
      <section data-place="unwind">
        <VibeLayer host={host} />
        <div className="u-wing" />
        <div className="u-np">Song</div>
        {art ? (
          <div className="u-art">
            <img src="data:image/png;base64,AAAA" alt="" />
          </div>
        ) : null}
      </section>
    </Wrap>,
  );
  return {
    ...r,
    rec: s.rec,
    canvas: r.container.querySelector('canvas.vibe-back')! as HTMLCanvasElement,
    title: r.container.querySelector('canvas.vibe-title')! as HTMLCanvasElement,
    front: r.container.querySelector('canvas.vibe-front')! as HTMLCanvasElement,
    hz: r.container.querySelector('canvas.horizon-canvas') as HTMLCanvasElement | null,
  };
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

  it('its mask ramps to zero on the right edge too, in both the prefixed and plain properties', () => {
    const c = sheet('../styles/vibe.css').replace(/\r\n/g, '\n');
    const ramp = 'linear-gradient(90deg, transparent 0, #000 64px, #000 calc(100% - 96px), transparent 100%)';
    expect(c).toContain('-webkit-mask-image: ' + ramp);
    expect(c).toMatch(new RegExp('\\n  mask-image: ' + ramp.replace(/[()]/g, '\\$&')));
  });

  it('the main area is its own stacking context while the layer is in it, so z-index -1 stays above the horizon canvas', () => {
    expect(sheet('../styles/vibe.css')).toMatch(/\.main:has\(\.vibe-back\)\s*\{\s*isolation:\s*isolate/);
  });

  it('draws nothing and stops when no music plays and every effect is at rest', () => {
    const m = manual();
    const { rec } = mount(m.host);
    // The hole masks bake once at mount; only frames are counted.
    rec.calls.length = 0;
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
  const copies = (rec: { calls: unknown[][] }, back: HTMLCanvasElement) =>
    rec.calls.filter((c) => c[0] === 'drawImage' && c[1] === back && c.length === 10);

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

  const rampOf = (rec: { calls: unknown[][] }) => {
    // The grain fill's alpha each frame: the set right before each full-canvas fillRect, grain first and lines second.
    const out: number[] = [];
    let a = 0;
    let n = 0;
    let fill: unknown = '';
    for (const c of rec.calls) {
      if (c[0] === 'set globalAlpha') a = c[1] as number;
      if (c[0] === 'set fillStyle') fill = c[1];
      // The baked patterns are 'transparent' stand-ins under the recording context; the aurora's feather is a gradient.
      if (c[0] === 'fillRect' && c[3] === 760 && c[4] === 340 && fill === 'transparent') {
        if (n++ % 2 === 0) out.push(a);
      }
    }
    return out;
  };

  it('Tape Grain is off by default, fades in when switched on and fades out when switched off, never in one jump', () => {
    const m = manual();
    const { rec, front } = mount(m.host);
    expect(front.getAttribute('aria-hidden')).toBe('true');
    playFor(4000);
    m.frames(10000, 60);
    expect(rampOf(rec)).toHaveLength(0);
    act(() => useVibeStore.getState().setVibe({ tapeGrain: true }));
    rec.calls.length = 0;
    m.frames(20000, 90);
    const up = rampOf(rec);
    expect(up.length).toBeGreaterThan(10);
    for (let k = 1; k < up.length; k++) expect(Math.abs(up[k] - up[k - 1])).toBeLessThan(0.05);
    expect(up[0]).toBeLessThan(up[up.length - 1]);
    act(() => useVibeStore.getState().setVibe({ tapeGrain: false }));
    rec.calls.length = 0;
    m.frames(30000, 90);
    const down = rampOf(rec);
    expect(down.length).toBeGreaterThan(5);
    for (let k = 1; k < down.length; k++) expect(Math.abs(down[k] - down[k - 1])).toBeLessThan(0.05);
    expect(down[0]).toBeGreaterThan(down[down.length - 1]);
    // Switched off, the front is cleared once and then nothing is drawn.
    expect(rec.calls.some((c) => c[0] === 'clearRect')).toBe(true);
  });

  it('a drop tears slices with Auto vibe on, or with Drop Glitch on, and with neither or under Calm cap it does not', () => {
    const tears = (settings: Record<string, boolean>) => {
      cleanup();
      resetVibeStore();
      const m = manual();
      act(() => useVibeStore.getState().setVibe(settings));
      const { rec, hz } = mount(m.host, true, true);
      playFor(4000);
      m.frames(10000, 60);
      rec.calls.length = 0;
      fakeDrops.count += 1;
      m.frames(20000, 20);
      return rec.calls.filter((c) => c[0] === 'drawImage' && c[1] === hz).length;
    };
    expect(tears({ auto: true })).toBeGreaterThan(5);
    expect(tears({ auto: false, dropGlitch: true })).toBeGreaterThan(5);
    expect(tears({ auto: false, dropGlitch: false })).toBe(0);
    expect(tears({ auto: true, calmCap: true })).toBe(0);
  });

  it('a remount over a canvas that is already sized (dev double mount) still bakes the sprites and tears', () => {
    resetVibeStore();
    const m = manual();
    act(() => useVibeStore.getState().setVibe({ auto: true, tapeGrain: true }));
    const { rec, hz } = mount(m.host, true, true, true);
    playFor(4000);
    m.frames(10000, 60);
    rec.calls.length = 0;
    fakeDrops.count += 1;
    m.frames(20000, 20);
    expect(rec.calls.filter((c) => c[0] === 'drawImage' && c[1] === hz).length).toBeGreaterThan(5);
  });

  it('its stylesheet puts the front layer above the scene, click-through, and feathers its bounds', () => {
    const c = sheet('../styles/vibe.css');
    expect(c).toMatch(/\.vibe-front\s*\{[^}]*z-index:\s*2/);
    expect(c).toMatch(/\.vibe-front\s*\{[^}]*pointer-events:\s*none/);
    expect(c).toMatch(/\.vibe-front\s*\{[^}]*transparent 0, #000 64px/);
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
