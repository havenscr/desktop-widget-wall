import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { CAMERAS, type CameraPreset } from './cameras';
import { recordingContext } from './canvasStub';
import { draw, when, type HorizonDrawOptions } from './renderer';
import { MOON_CLEAR, claimSky, frontHost, moonFor, releaseSky, useSkyClaim, useSkyStore, type SkyClaim } from './sky';

afterEach(() => {
  cleanup();
  useSkyStore.setState({ claims: {} });
});

/** The renderer's frame for a camera at a Pacific hour: a ripple, a grid pulse and the moon, grain off. */
function frame(cam: CameraPreset, hour: number, extra: Partial<HorizonDrawOptions> = {}): HorizonDrawOptions {
  return {
    W: 2560,
    H: 720,
    scale: 1.25,
    hy: cam.hy,
    az0: cam.az0,
    ppd: cam.ppd,
    vex: cam.vex,
    snowDeg: cam.snowDeg,
    cityScale: cam.cs,
    vx: cam.vx,
    ms: when(2026, 11, 11, hour),
    t: 2.5,
    phase: 0.4,
    grain: false,
    moon: [1490, 336, 44],
    echo: { n: cam.en, amp: cam.eamp, a: 0.5, t: 2.5, cx: cam.ecx, hs: 900 },
    grid: { bright: 0.6, waves: [{ p: 0.3, a: 0.4 }] },
    ...extra,
  };
}

function calls(o: HorizonDrawOptions): string[] {
  const { ctx, log } = recordingContext();
  draw(ctx, o);
  return log;
}

/** Gradient ids count up per context, so two logs are compared with them taken out. */
const anon = (log: string[]) => log.map((l) => l.replace(/(linear|radial)\d+/g, '$1'));

describe('the renderer draws the sky and the ground apart', () => {
  // Night, noon and dusk on Unwind (moon, sun glitter, echo), noon on Work (the city), the morning view.
  const cases: [string, CameraPreset, number][] = [
    ['Unwind at night', CAMERAS.unwind, 22.5],
    ['Unwind at noon', CAMERAS.unwind, 12.5],
    ['Unwind at dusk', CAMERAS.unwind, 16.9],
    ['Work at noon', CAMERAS.work, 12],
    ['Home at night', CAMERAS.home, 21],
  ];
  for (const [name, cam, hour] of cases) {
    it(`${name}: the sky part then the ground part make exactly the whole picture's calls`, () => {
      const whole = calls(frame(cam, hour));
      const sky = calls(frame(cam, hour, { part: 'sky' }));
      const ground = calls(frame(cam, hour, { part: 'ground' }));
      // The ground starts on a cleared canvas and makes the palette's rim gradient again (four lines), then carries on as the whole picture does after the sky.
      const clear = ground.indexOf('clearRect(0,0,2561,721)');
      expect(clear).toBe(3);
      expect(ground.slice(0, 3)).toEqual(whole.slice(0, 3)); // the transform, opacity and blending set up the same way
      expect(ground[clear + 1]).toMatch(/^linear\(0,0,2560,0\)=/);
      const rest = ground.slice(clear + 5);
      expect(anon([...sky, ...rest])).toEqual(anon(whole));
      expect(sky.length).toBeLessThan(whole.length);
      expect(rest.length).toBeGreaterThan(1000);
    });
  }

  it('the sky part holds the sky, the stars, the moon and the clouds, and none of the ground', () => {
    const sky = calls(frame(CAMERAS.unwind, 22.5, { part: 'sky' }));
    expect(sky).toContain('arc(1490,336,44,0,7)'); // the moon's disc
    expect(sky.some((l) => l.startsWith('fillRect(0,0,2560,'))).toBe(true); // the sky gradient
    // Nothing on the lake: no grid lines down to the bottom edge, no additive light.
    expect(sky.some((l) => l === 'globalCompositeOperation=lighter')).toBe(false);
    expect(sky.some((l) => l.startsWith(`lineTo(${CAMERAS.unwind.vx},`) || l.endsWith(',720)'))).toBe(false);
  });

  it('the ground part has no sky: no sky gradient, no stars or moon disc, no sun disc', () => {
    for (const hour of [22.5, 16.9, 12.5]) {
      const ground = calls(frame(CAMERAS.unwind, hour, { part: 'ground' }));
      expect(ground).not.toContain('arc(1490,336,44,0,7)');
      expect(ground.some((l) => l.startsWith(`fillRect(0,0,2560,${CAMERAS.unwind.hy + 1})`))).toBe(false);
      // The whole picture's calls before the far range are all the sky's; none of them is in the ground part.
      const whole = calls(frame(CAMERAS.unwind, hour));
      const sky = calls(frame(CAMERAS.unwind, hour, { part: 'sky' }));
      expect(whole.slice(0, sky.length)).toEqual(sky);
    }
  });

  it('without a part the calls are the golden ones (the part option changes nothing when absent)', () => {
    const fnv = (s: string) => {
      let h = 0x811c9dc5;
      for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
      }
      return h.toString(16);
    };
    const cam = CAMERAS.unwind;
    const golden: HorizonDrawOptions = { W: 2560, H: 720, scale: 1, hy: cam.hy, az0: cam.az0, ppd: cam.ppd, vex: cam.vex, snowDeg: cam.snowDeg, cityScale: cam.cs, vx: cam.vx, ms: when(2026, 11, 11, 21.7), t: 2.5, phase: 0.4, grain: false, echo: { n: cam.en, amp: cam.eamp, a: 0.5, t: 2.5, cx: cam.ecx, hs: 900 } };
    const log = calls(golden);
    expect({ n: log.length, hash: fnv(log.join('\n')) }).toEqual({ n: 51967, hash: '5f3dfbd3' });
    expect(calls({ ...golden, part: undefined })).toEqual(log);
  });
});

describe('the moon rule', () => {
  const MOON = [1490, 336, 44] as const;

  it('keeps the moon with no claims, or claims that neither cover it nor ask for no moon', () => {
    expect(moonFor(MOON, {})).toBe(MOON);
    expect(moonFor(MOON, { a: { boxes: [[0, 0, 600, 300]] }, b: {} })).toBe(MOON);
  });

  it('drops it for a look that owns that part of the sky (the sun, the drive-in)', () => {
    expect(moonFor(MOON, { watch: { noMoon: true } })).toBeNull();
    expect(moonFor(MOON, { other: { boxes: [] }, watch: { noMoon: true, boxes: [[0, 0, 10, 10]] } })).toBeNull();
  });

  it('drops it when a picture box covers it or comes within 40 px of its disc (the feathered look, the whole sky)', () => {
    expect(MOON_CLEAR).toBe(40);
    expect(moonFor(MOON, { w: { boxes: [[1150, 50, 810, 455]] } })).toBeNull(); // the feathered picture over it
    expect(moonFor(MOON, { w: { boxes: [[124, 0, 2436, 505]] } })).toBeNull(); // the whole sky
    // A box to its right: drawn at 85 px or more from its centre (44 + 40 + 1), gone at 83.
    expect(moonFor(MOON, { w: { boxes: [[1490 + 85, 0, 300, 700]] } })).toBe(MOON);
    expect(moonFor(MOON, { w: { boxes: [[1490 + 83, 0, 300, 700]] } })).toBeNull();
    // Corners count by distance, not by the box's sides: a box whose corner is 90 px away diagonally keeps it.
    expect(moonFor(MOON, { w: { boxes: [[1490 + 64, 336 + 64, 100, 100]] } })).toBe(MOON);
  });
});

describe('the sky store', () => {
  it('claims are keyed: a release drops only its own, and releasing nothing changes nothing', () => {
    const host = document.createElement('div');
    claimSky('a', { front: host });
    claimSky('b', { noMoon: true });
    expect(frontHost(useSkyStore.getState().claims)).toBe(host);
    const before = useSkyStore.getState().claims;
    releaseSky('nobody');
    expect(useSkyStore.getState().claims).toBe(before);
    releaseSky('a');
    expect(frontHost(useSkyStore.getState().claims)).toBeNull();
    expect(Object.keys(useSkyStore.getState().claims)).toEqual(['b']);
  });

  it('useSkyClaim holds a claim while mounted, follows its value, and releases it on unmount or null', () => {
    const host = document.createElement('div');
    function Asker({ claim }: { claim: SkyClaim | null }) {
      useSkyClaim('watch', claim);
      return null;
    }
    const { rerender, unmount } = render(<Asker claim={{ front: host, boxes: [[1, 2, 3, 4]] }} />);
    expect(useSkyStore.getState().claims).toEqual({ watch: { front: host, boxes: [[1, 2, 3, 4]] } });
    const first = useSkyStore.getState().claims;
    // The same value again (a new object each render) changes nothing.
    rerender(<Asker claim={{ front: host, boxes: [[1, 2, 3, 4]] }} />);
    expect(useSkyStore.getState().claims).toBe(first);
    rerender(<Asker claim={{ noMoon: true }} />);
    expect(useSkyStore.getState().claims).toEqual({ watch: { noMoon: true } });
    rerender(<Asker claim={null} />);
    expect(useSkyStore.getState().claims).toEqual({});
    rerender(<Asker claim={{ front: host }} />);
    expect(frontHost(useSkyStore.getState().claims)).toBe(host);
    act(() => unmount());
    expect(useSkyStore.getState().claims).toEqual({});
  });
});

describe('the sky layers review knobs (development builds only)', () => {
  it('reads ?sky=front, ?sky=flat and ?skymoon=x,y,r, and nothing else', async () => {
    const { parseSkyReview } = await import('./review');
    expect(parseSkyReview('')).toBeNull();
    expect(parseSkyReview('?sky=front')).toEqual({ front: 'always' });
    expect(parseSkyReview('?sky=flat')).toEqual({ front: 'never' });
    expect(parseSkyReview('?sky=other')).toBeNull();
    expect(parseSkyReview('?skymoon=1730,112,44')).toEqual({ moon: [1730, 112, 44] });
    for (const bad of ['?skymoon=1,2', '?skymoon=a,b,c', '?skymoon=1,2,0', '?skymoon=1,2,3,4']) expect(parseSkyReview(bad)).toBeNull();
  });
});
