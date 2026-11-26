import { act, cleanup, render } from '@testing-library/react';
import { Fragment, StrictMode, type ReactNode } from 'react';
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
import layerSrc from './VibeLayer.tsx?raw';

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
    return this.classList.contains('u-wing') ? 440 : this.classList.contains('u-art') ? 224 : this.classList.contains('rail') ? 88 : 2000;
  });
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains('u-art') ? 224 : 680;
  });
  vi.spyOn(HTMLElement.prototype, 'offsetLeft', 'get').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains('u-wing') ? 40 : this.classList.contains('u-art') ? 900 : this.classList.contains('rail') ? 20 : 0;
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

function mount(host: LoopHost, art = true, horizon = false, strict = false, stage = false) {
  const s = stubCanvas();
  restore = s.restore;
  const Wrap = strict ? StrictMode : Fragment;
  const Stage = stage ? ({ children }: { children: ReactNode }) => <div className="stage"><div className="rail" />{children}</div> : Fragment;
  const r = render(
    <Wrap>
      <Stage>
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
      </Stage>
    </Wrap>,
  );
  return {
    ...r,
    rec: s.rec,
    canvas: r.container.querySelector('canvas.vibe-back')! as HTMLCanvasElement,
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

  it('when frames run over budget the grain eases to zero in steps instead of cutting', () => {
    window.history.replaceState({}, '', '/?vibeprobe=1');
    let clock = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => (clock += 10));
    try {
      const m = manual();
      act(() => useVibeStore.getState().setVibe({ tapeGrain: true }));
      const { rec } = mount(m.host);
      playFor(4000);
      m.frames(10000, 60);
      rec.calls.length = 0;
      m.frames(20000, 400);
      const ramp = rampOf(rec);
      expect(ramp.length).toBeGreaterThan(10);
      expect(ramp[0]).toBeGreaterThan(0.01);
      for (let k = 1; k < ramp.length; k++) expect(Math.abs(ramp[k] - ramp[k - 1])).toBeLessThan(0.05);
      // Some steps sit strictly between the full grain and nothing, and the grain is gone by the end.
      expect(ramp.some((a) => a < ramp[0] * 0.9 && a > 0.003)).toBe(true);
      rec.calls.length = 0;
      m.frames(60000, 20);
      expect(rampOf(rec)).toHaveLength(0);
    } finally {
      window.history.replaceState({}, '', '/');
    }
  });

  it('switching reduced motion on clears the front canvas, so no old glitch pixels stay behind', () => {
    const listeners = new Set<() => void>();
    const mq = { matches: false, addEventListener: (_: string, f: () => void) => void listeners.add(f), removeEventListener: (_: string, f: () => void) => void listeners.delete(f) };
    vi.stubGlobal('matchMedia', () => mq);
    const m = manual();
    act(() => useVibeStore.getState().setVibe({ auto: true, tapeGrain: true }));
    const { rec, front } = mount(m.host);
    playFor(4000);
    m.frames(10000, 60);
    fakeDrops.count += 1;
    m.frames(20000, 10);
    rec.calls.length = 0;
    act(() => {
      mq.matches = true;
      listeners.forEach((f) => f());
    });
    expect(rec.calls.some((c) => c[0] === 'clearRect' && c[3] === front.width && c[4] === front.height)).toBe(true);
  });

  it('its stylesheet puts the front layer above the scene and Watt, click-through, with no mask edge', () => {
    const c = sheet('../styles/vibe.css');
    expect(c).toMatch(/\.vibe-front\s*\{[^}]*z-index:\s*2/);
    expect(c).toMatch(/\.vibe-front\s*\{[^}]*pointer-events:\s*none/);
    expect(/\.vibe-front\s*\{[^}]*mask/.test(c)).toBe(false);
  });

  it('puts the grain sheet below every word and control, and above the scene and Watt', () => {
    const c = sheet('../styles/vibe.css');
    const z = (sel: string): number => {
      const m = c.match(new RegExp('\\.stage[^{]*' + sel.replace(/\./g, '\\.') + '[^{]*\\{[^}]*z-index:\\s*(-?\\d+)'));
      return m ? Number(m[1]) : NaN;
    };
    const sheetZ = Number(c.match(/\.vibe-front\s*\{[^}]*z-index:\s*(\d+)/)![1]);
    // Watt is z-index 1 on the stage; the horizon, veil, weather and sun row sit under the back layer.
    const wattZ = Number(sheet('../buddy/watt.css').match(/\.watt\s*\{[^}]*z-index:\s*(\d+)/)?.[1] ?? 1);
    expect(sheetZ).toBeGreaterThan(wattZ);
    expect(z('canvas.horizon-canvas')).toBeLessThan(-1);
    for (const sel of ['.u-wing', '.u-right', '.w-now', '.u-office-slot', '.u-work', '.rib-line', '.u-nu', '.rail', '.clk', '.u-np', '.u-transport']) {
      expect(z(sel), sel).toBeGreaterThan(sheetZ);
    }
    // The main area no longer isolates, or the lifts would be trapped under the sheet.
    expect(c).toMatch(/\.stage \.main:has\(\.vibe-front\)\s*\{\s*isolation:\s*auto/);
    // Listen's block is no longer its own layer.
    expect(c).toMatch(/\.u-listen\s*\{\s*z-index:\s*auto/);
  });

  it('the sheet runs from the rail\'s edge to the stage\'s right edge, top to bottom', () => {
    const m = manual();
    const { front } = mount(m.host, true, false, false, true);
    expect(front.style.left).toBe('108px');
    expect(front.style.top).toBe('0px');
    expect(front.style.width).toBe('1892px');
    expect(front.style.height).toBe('680px');
    expect(front.width).toBe(946);
    expect(front.height).toBe(340);
  });

  it('there is no title canvas and no hole punching: nothing in the layer follows the words', () => {
    const m = manual();
    const { container } = mount(m.host);
    expect(container.querySelector('canvas[data-vibe="title"]')).toBeNull();
    expect(layerSrc).not.toMatch(/bakeHole|PROTECT_SELECTOR|titleCover/);
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
