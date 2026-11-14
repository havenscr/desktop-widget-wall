import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { CAMERAS, MOON_PLACES, type CameraPreset } from './cameras';
import { ridgeTopY } from './ridge';
import { recordingContext } from './canvasStub';
import { draw, when, type HorizonDrawOptions } from './renderer';
import { MOON_CLEAR, claimSky, frontHost, moonFor, releaseSky, stageBox, useSkyClaim, useSkyKeepClear, useSkyStore, type SkyBox, type SkyClaim } from './sky';

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
    moon: [1890, 260, 44],
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

/** The rim gradient's four lines (made, three stops): the ground's, never made by the sky part. */
const RIM = /^linear\(0,0,2560,0\)=/;
/** The whole picture's calls without the rim gradient's four lines. */
const noRim = (log: string[]) => {
  const at = log.findIndex((l) => RIM.test(l));
  return at < 0 ? log : [...log.slice(0, at), ...log.slice(at + 4)];
};

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
      // The sky part makes no rim gradient (only the ground draws with it).
      expect(sky.some((l) => RIM.test(l))).toBe(false);
      expect(anon([...sky, ...rest])).toEqual(anon(noRim(whole)));
      expect(sky.length).toBeLessThan(whole.length);
      expect(rest.length).toBeGreaterThan(1000);
    });
  }

  it('the sky part holds the sky, the stars, the moon and the clouds, and none of the ground', () => {
    const sky = calls(frame(CAMERAS.unwind, 22.5, { part: 'sky' }));
    expect(sky).toContain('arc(1890,260,44,0,7)'); // the moon's disc
    expect(sky.some((l) => l.startsWith('fillRect(0,0,2560,'))).toBe(true); // the sky gradient
    // Nothing on the lake: no grid lines down to the bottom edge, no additive light.
    expect(sky.some((l) => l === 'globalCompositeOperation=lighter')).toBe(false);
    expect(sky.some((l) => l.startsWith(`lineTo(${CAMERAS.unwind.vx},`) || l.endsWith(',720)'))).toBe(false);
  });

  it('the ground part has no sky: no sky gradient, no stars or moon disc, no sun disc', () => {
    for (const hour of [22.5, 16.9, 12.5]) {
      const ground = calls(frame(CAMERAS.unwind, hour, { part: 'ground' }));
      expect(ground).not.toContain('arc(1890,260,44,0,7)');
      expect(ground.some((l) => l.startsWith(`fillRect(0,0,2560,${CAMERAS.unwind.hy + 1})`))).toBe(false);
      // The whole picture's calls before the far range are all the sky's; none of them is in the ground part.
      const whole = calls(frame(CAMERAS.unwind, hour));
      const sky = calls(frame(CAMERAS.unwind, hour, { part: 'sky' }));
      expect(anon(noRim(whole).slice(0, sky.length))).toEqual(anon(sky));
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
  const MOON = [1890, 260, 44] as const;
  /** One place only: the rule's distances, with nowhere else to go. */
  const ONE = [MOON];

  it('keeps the moon with no claims, or claims that neither cover it nor ask for no moon', () => {
    expect(moonFor(ONE, {})).toBe(MOON);
    expect(moonFor(ONE, { a: { boxes: [[0, 0, 600, 300]] }, b: {} })).toBe(MOON);
  });

  it('drops it for a look that owns that part of the sky (the sun, the drive-in), wherever it could go', () => {
    expect(moonFor(MOON_PLACES, { watch: { noMoon: true } })).toBeNull();
    expect(moonFor(MOON_PLACES, { other: { boxes: [] }, watch: { noMoon: true, boxes: [[0, 0, 10, 10]] } })).toBeNull();
  });

  it('a place within 40 px of a picture box or a keep-clear box is not used (the feathered look, the whole sky, a card)', () => {
    expect(MOON_CLEAR).toBe(40);
    expect(moonFor(ONE, { w: { boxes: [[1150, 50, 810, 455]] } })).toBeNull(); // the feathered picture over it
    expect(moonFor(ONE, { w: { boxes: [[124, 0, 2436, 505]] } })).toBeNull(); // the whole sky
    // A box to its right: drawn at 85 px or more from its centre (44 + 40 + 1), gone at 83; the same for a keep-clear box.
    expect(moonFor(ONE, { w: { boxes: [[1890 + 85, 0, 300, 700]] } })).toBe(MOON);
    expect(moonFor(ONE, { w: { boxes: [[1890 + 83, 0, 300, 700]] } })).toBeNull();
    expect(moonFor(ONE, { c: { clear: [[1890 + 85, 0, 300, 700]] } })).toBe(MOON);
    expect(moonFor(ONE, { c: { clear: [[1890 + 83, 0, 300, 700]] } })).toBeNull();
    // Corners count by distance, not by the box's sides: a box whose corner is 90 px away diagonally keeps it.
    expect(moonFor(ONE, { w: { boxes: [[1890 + 64, 260 + 64, 100, 100]] } })).toBe(MOON);
  });

  it('no boxes: the first place; the places are the present one first, each above the Unwind ridgeline and clear of the clock', () => {
    expect(MOON_PLACES[0]).toEqual([1890, 260, 44]);
    expect(moonFor(MOON_PLACES, {})).toBe(MOON_PLACES[0]);
    expect(moonFor(MOON_PLACES, { a: { clear: [[0, 600, 2560, 120]] } })).toBe(MOON_PLACES[0]);
    for (const [x, y, r] of MOON_PLACES) {
      expect(y + r).toBeLessThan(ridgeTopY(CAMERAS.unwind, x - r, x + r)); // wholly above the drawn ranges
      expect(Math.hypot(Math.max(0, x - 560), Math.max(0, y - 136)) - r).toBeGreaterThanOrEqual(40); // the clock's digits end near 560, 136
    }
  });

  it('the wide card on Listen (stage 1740 to 2540, 24 to 486) moves it to the first clear place, 40 px from the card, the player and Up next', () => {
    const card: SkyBox = [1740, 24, 800, 462];
    const m = moonFor(MOON_PLACES, { listen: { clear: [card] } })!;
    expect(m).toBe(MOON_PLACES[1]);
    const gap = (b: SkyBox) => Math.hypot(Math.max(b[0] - m[0], 0, m[0] - b[0] - b[2]), Math.max(b[1] - m[1], 0, m[1] - b[1] - b[3])) - m[2];
    expect(gap(card)).toBeGreaterThanOrEqual(40);
    expect(gap([624, 26, 1086, 225])).toBeGreaterThanOrEqual(40); // the player at its widest
    expect(gap([124, 266, 470, 173])).toBeGreaterThanOrEqual(40); // Up next
    // A box over the second place too: the third.
    expect(moonFor(MOON_PLACES, { listen: { clear: [card] }, other: { clear: [[700, 300, 120, 80]] } })).toBe(MOON_PLACES[2]);
  });

  it('boxes over every place: no moon', () => {
    const all: SkyBox[] = MOON_PLACES.map(([x, y]) => [x - 1, y - 1, 2, 2] as const);
    expect(moonFor(MOON_PLACES, { a: { clear: all } })).toBeNull();
    expect(moonFor(MOON_PLACES, { a: { clear: all.slice(0, 2) }, b: { boxes: all.slice(2) } })).toBeNull();
  });

  it('is stable: the same claims give the same place every time, and it changes only when a box does', () => {
    const claims = { listen: { clear: [[1740, 24, 800, 462]] as SkyBox[] } };
    const first = moonFor(MOON_PLACES, claims);
    for (let i = 0; i < 50; i++) expect(moonFor(MOON_PLACES, claims)).toBe(first);
    expect(moonFor(MOON_PLACES, { listen: { clear: [[1740, 24, 800, 462]] } })).toBe(first); // equal in value
    expect(moonFor(MOON_PLACES, {})).not.toBe(first);
  });
});

describe('the sky store', () => {
  it('claims are keyed: a release drops only its own, and releasing nothing changes nothing', () => {
    const host = document.body.appendChild(document.createElement('div'));
    claimSky('a', { front: host });
    claimSky('b', { noMoon: true });
    expect(frontHost(useSkyStore.getState().claims)).toBe(host);
    const before = useSkyStore.getState().claims;
    releaseSky('nobody');
    expect(useSkyStore.getState().claims).toBe(before);
    releaseSky('a');
    expect(frontHost(useSkyStore.getState().claims)).toBeNull();
    expect(Object.keys(useSkyStore.getState().claims)).toEqual(['b']);
    host.remove();
  });

  it('a host not in the page is no host: no front layer from it', () => {
    const loose = document.createElement('div');
    claimSky('a', { front: loose });
    expect(frontHost(useSkyStore.getState().claims)).toBeNull();
    const host = document.body.appendChild(document.createElement('div'));
    claimSky('b', { front: host });
    expect(frontHost(useSkyStore.getState().claims)).toBe(host);
    host.remove();
    expect(frontHost(useSkyStore.getState().claims)).toBeNull();
  });

  it('useSkyClaim replaces its claim, without the host, as soon as the host leaves the page while the claimant stays', async () => {
    const host = document.body.appendChild(document.createElement('div'));
    function Asker() {
      useSkyClaim('watch', { front: host, boxes: [[1, 2, 3, 4]] });
      return null;
    }
    render(<Asker />);
    expect(useSkyStore.getState().claims.watch.front).toBe(host);
    host.remove();
    await act(async () => {
      await Promise.resolve(); // the page's change is reported on the next microtask
    });
    expect(useSkyStore.getState().claims).toEqual({ watch: { boxes: [[1, 2, 3, 4]] } });
  });

  it('useSkyKeepClear claims the element\'s own box in stage pixels (the stage scaled to the window), follows it, and releases it', () => {
    const stage = document.body.appendChild(document.createElement('div'));
    stage.className = 'stage';
    const card = stage.appendChild(document.createElement('section'));
    const rect = (x: number, y: number, w: number, h: number) => ({ left: x, top: y, right: x + w, bottom: y + h, width: w, height: h, x, y, toJSON() {} }) as DOMRect;
    // The stage drawn at half size, 10 px in from the window's corner; the card at stage 1740, 24, 800 by 462.
    stage.getBoundingClientRect = () => rect(10, 10, 1280, 360);
    card.getBoundingClientRect = () => rect(10 + 870, 10 + 12, 400, 231);
    expect(stageBox(card)).toEqual([1740, 24, 800, 462]);
    function Card({ el }: { el: Element | null }) {
      useSkyKeepClear('listen-card', el);
      return null;
    }
    const { rerender, unmount } = render(<Card el={card} />);
    expect(useSkyStore.getState().claims).toEqual({ 'listen-card': { clear: [[1740, 24, 800, 462]] } });
    rerender(<Card el={null} />);
    expect(useSkyStore.getState().claims).toEqual({});
    rerender(<Card el={card} />);
    unmount();
    expect(useSkyStore.getState().claims).toEqual({});
    // An element with no size claims nothing.
    card.getBoundingClientRect = () => rect(0, 0, 0, 0);
    render(<Card el={card} />);
    expect(useSkyStore.getState().claims).toEqual({});
    stage.remove();
  });

  it('useSkyClaim holds a claim while mounted, follows its value, and releases it on unmount or null', () => {
    const host = document.body.appendChild(document.createElement('div'));
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
    host.remove();
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
