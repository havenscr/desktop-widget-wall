import { describe, expect, it } from 'vitest';
import { CAMERAS, CINEMATIC_SECONDS, HOME_MORNING, PANO_MAX_AZ, PANO_MIN_AZ, SWING_DEGREES, cinematicCamera, localDay, SWING_SECONDS, blendCamera, cameraFor, ease, glideCamera, glideSeconds, homeCameraFor, settled, startGlide, stepGlide, GLIDE_SECONDS } from './cameras';

const a = CAMERAS.work;
const b = CAMERAS.unwind;

describe('blendCamera', () => {
  it('is the start at 0 and the end at 1', () => {
    expect(blendCamera(a, b, 0)).toEqual(a);
    expect(blendCamera(a, b, 1)).toEqual(b);
  });

  it('is halfway at 0.5 for every key (the ease is symmetric)', () => {
    const mid = blendCamera(a, b, 0.5);
    for (const key of Object.keys(a) as (keyof typeof a)[]) {
      const x = a[key];
      const y = b[key];
      if (typeof x !== 'number' || typeof y !== 'number') continue; // the terrain name
      expect(mid[key]).toBeCloseTo((x + y) / 2, 9);
    }
  });

  it('uses the cubic ease, so a quarter of the way is under a quarter', () => {
    expect(ease(0.25)).toBeCloseTo(0.0625, 9);
    expect(blendCamera(a, b, 0.25).az0).toBeCloseTo(a.az0 + (b.az0 - a.az0) * 0.0625, 9);
  });

  it('clamps t outside 0 to 1', () => {
    expect(blendCamera(a, b, -1)).toEqual(a);
    expect(blendCamera(a, b, 4)).toEqual(b);
  });
});

describe('presets', () => {
  it('has a framing for each place with the demo values', () => {
    expect(CAMERAS.work).toMatchObject({ az0: 221.5, ppd: 34, hy: 582 });
    expect(CAMERAS.home).toMatchObject({ az0: 218.1, ppd: 54, hy: 582 });
    expect(CAMERAS.unwind).toMatchObject({ az0: 246, ppd: 49.2, hy: 505 });
  });
});

describe('glide', () => {
  it('takes 1.6 seconds to arrive', () => {
    let g = startGlide(settled(a), b, false);
    expect(glideCamera(g)).toEqual(a);
    g = stepGlide(g, GLIDE_SECONDS / 2);
    expect(g.progress).toBeCloseTo(0.5, 9);
    g = stepGlide(g, GLIDE_SECONDS / 2);
    expect(glideCamera(g)).toEqual(b);
    expect(stepGlide(g, 1)).toBe(g);
  });

  it('starts from the current mid-glide position when interrupted', () => {
    const g = stepGlide(startGlide(settled(a), b, false), 0.8);
    const mid = glideCamera(g);
    expect(startGlide(g, CAMERAS.home, false).from).toEqual(mid);
  });

  it('jumps when instant (reduced motion)', () => {
    expect(glideCamera(startGlide(settled(a), b, true))).toEqual(b);
  });

  it('swings for 3.2 seconds when the view turns more than 40 degrees', () => {
    expect(SWING_SECONDS).toBe(3.2);
    expect(SWING_DEGREES).toBe(40);
    expect(glideSeconds(CAMERAS.work, HOME_MORNING)).toBe(SWING_SECONDS); // 89.5 degrees
    expect(glideSeconds(HOME_MORNING, CAMERAS.home)).toBe(SWING_SECONDS); // 86.1 degrees
    expect(glideSeconds(CAMERAS.work, CAMERAS.unwind)).toBe(GLIDE_SECONDS); // 24.5 degrees
    expect(glideSeconds(CAMERAS.work, CAMERAS.home)).toBe(GLIDE_SECONDS);
    expect(glideSeconds(CAMERAS.work, { ...CAMERAS.work, az0: CAMERAS.work.az0 - 40 })).toBe(GLIDE_SECONDS); // exactly 40 is a glide
  });

  it('a swing from Work to the morning view moves az0 monotonically from 221.5 to 132 over SWING_SECONDS', () => {
    let g = startGlide(settled(CAMERAS.work), HOME_MORNING, false);
    expect(g.seconds).toBe(SWING_SECONDS);
    let prev = glideCamera(g).az0;
    expect(prev).toBe(221.5);
    const steps = 32;
    for (let i = 1; i <= steps; i++) {
      g = stepGlide(g, SWING_SECONDS / steps);
      const az = glideCamera(g).az0;
      expect(az).toBeLessThanOrEqual(prev);
      prev = az;
    }
    expect(g.progress).toBe(1);
    expect(glideCamera(g)).toBe(HOME_MORNING);
    expect(prev).toBe(132);
  });

  it('an interrupted swing takes its duration from where the camera is now', () => {
    const g = stepGlide(startGlide(settled(CAMERAS.work), HOME_MORNING, false), 1.6); // halfway round
    expect(startGlide(g, CAMERAS.work, false).seconds).toBe(SWING_SECONDS); // 44.75 degrees back
    const late = stepGlide(startGlide(settled(CAMERAS.work), HOME_MORNING, false), 3);
    expect(startGlide(late, HOME_MORNING, false).seconds).toBe(GLIDE_SECONDS); // a few degrees left
  });

  it('settled glides carry the usual duration', () => {
    expect(settled(a).seconds).toBe(GLIDE_SECONDS);
    expect(glideCamera(startGlide(settled(a), HOME_MORNING, true))).toBe(HOME_MORNING);
  });
});

describe('homeCameraFor (the morning rule)', () => {
  const at = (h: number, m: number) => new Date(2026, 10, 11, h, m, 0);

  it('is the south view from 5:00 AM up to 11:30 AM local time', () => {
    expect(homeCameraFor(at(4, 59))).toBe(CAMERAS.home);
    expect(homeCameraFor(at(5, 0))).toBe(HOME_MORNING);
    expect(homeCameraFor(at(7, 12))).toBe(HOME_MORNING);
    expect(homeCameraFor(at(11, 29))).toBe(HOME_MORNING);
    expect(homeCameraFor(at(11, 30))).toBe(CAMERAS.home);
  });

  it('is the west Home view in the afternoon, evening and small hours', () => {
    for (const [h, m] of [[12, 0], [16, 30], [21, 15], [0, 0], [3, 40]]) expect(homeCameraFor(at(h, m))).toBe(CAMERAS.home);
  });

  it('cameraFor applies the rule to Home only', () => {
    const morning = at(8, 0).getTime();
    expect(cameraFor('home', morning)).toBe(HOME_MORNING);
    expect(cameraFor('work', morning)).toBe(CAMERAS.work);
    expect(cameraFor('unwind', morning)).toBe(CAMERAS.unwind);
  });
});

describe('the morning preset', () => {
  it('turns the panorama to the approved Rainier strip values, with no ripple', () => {
    expect(HOME_MORNING).toMatchObject({ ter: 'pano', az0: 132, ppd: 42, vex: 1.9, cs: 1, hy: 582 });
    for (const k of ['ecx', 'eamp', 'en', 'vx'] as const) expect(HOME_MORNING[k]).toBe(CAMERAS.home[k]);
    expect(HOME_MORNING.ea).toBe(0);
  });

  it('peaks clear of the top of the stage (Rainier about 168 px above the horizon)', () => {
    expect(HOME_MORNING.hy - 168).toBeGreaterThan(300);
  });

  it('every preset looks at the one panorama', () => {
    for (const cam of [...Object.values(CAMERAS), HOME_MORNING]) expect(cam.ter).toBe('pano');
  });

  it('carries a snow line per camera: 0.84 on the west presets, 0.86 in the morning, blended in a swing', () => {
    for (const cam of Object.values(CAMERAS)) expect(cam.snowDeg).toBe(0.84);
    expect(HOME_MORNING.snowDeg).toBe(0.86);
    expect(blendCamera(CAMERAS.home, HOME_MORNING, 0.5).snowDeg).toBeCloseTo(0.85, 9);
  });

  it('a glide keeps the panorama at every step', () => {
    expect(blendCamera(CAMERAS.home, HOME_MORNING, 0.5).ter).toBe('pano');
    expect(glideCamera({ from: CAMERAS.home, to: HOME_MORNING, progress: 0.3, seconds: SWING_SECONDS }).ter).toBe('pano');
  });
});

describe('the cinematic turn (first turn to Rainier each morning)', () => {
  const W = 2560;
  const work = CAMERAS.work;

  it('is exactly the start at k 0 and exactly the morning camera at k 1', () => {
    expect(cinematicCamera(work, HOME_MORNING, 0)).toBe(work);
    expect(cinematicCamera(work, HOME_MORNING, 1)).toBe(HOME_MORNING);
  });

  it('at k 0.5 is halfway on the sine ease, pulled back 10 px per degree with the horizon 14 px lower', () => {
    const mid = cinematicCamera(work, HOME_MORNING, 0.5);
    expect(mid.az0).toBeCloseTo((221.5 + 132) / 2, 9);
    expect(mid.ppd).toBeCloseTo((34 + 42) / 2 - 10, 9);
    expect(mid.hy).toBeCloseTo(582 + 14, 9);
    expect(mid.vex).toBeCloseTo((1.25 + 1.9) / 2, 9);
    expect(mid.snowDeg).toBeCloseTo(0.85, 9);
    expect(mid.ter).toBe('pano');
  });

  it('uses the sine ease for every number, not the cubic glide ease', () => {
    const k = 0.25;
    const e = 0.5 - 0.5 * Math.cos(Math.PI * k);
    const cam = cinematicCamera(work, HOME_MORNING, k);
    expect(cam.vex).toBeCloseTo(1.25 + (1.9 - 1.25) * e, 9);
    expect(cam.hy).toBeCloseTo(582 + 14 * Math.sin(Math.PI * k), 9);
    expect(cam.vex).not.toBeCloseTo(blendCamera(work, HOME_MORNING, k).vex, 3);
  });

  it('clamps ppd so the right edge never passes azimuth 299.8 (Work early in the turn)', () => {
    const cam = cinematicCamera(work, HOME_MORNING, 0.1);
    const e = 0.5 - 0.5 * Math.cos(Math.PI * 0.1);
    const unclamped = 34 + 8 * e - 10 * Math.sin(Math.PI * 0.1);
    expect(unclamped).toBeLessThan(W / (PANO_MAX_AZ - cam.az0)); // the pull-back alone would overrun the data
    expect(cam.ppd).toBeCloseTo(W / (PANO_MAX_AZ - cam.az0), 9);
  });

  it('clamps az0 to at least 128.3', () => {
    const far = { ...HOME_MORNING, az0: 110 };
    expect(cinematicCamera(work, far, 0.95).az0).toBe(PANO_MIN_AZ);
  });

  it('stays on the panorama at every step from each west camera', () => {
    for (const from of [CAMERAS.work, CAMERAS.home, CAMERAS.unwind]) {
      let prev = from.az0;
      for (let i = 0; i <= 100; i++) {
        const cam = cinematicCamera(from, HOME_MORNING, i / 100);
        expect(cam.az0).toBeGreaterThanOrEqual(PANO_MIN_AZ);
        expect(cam.az0 + W / cam.ppd).toBeLessThanOrEqual(PANO_MAX_AZ + 1e-9);
        expect(cam.az0).toBeLessThanOrEqual(prev); // the turn never doubles back
        prev = cam.az0;
      }
    }
  });

  it('runs as a glide over 4.6 seconds when started as cinematic; plain glides are unchanged', () => {
    let g = startGlide(settled(work), HOME_MORNING, false, true);
    expect(g).toMatchObject({ seconds: CINEMATIC_SECONDS, cinematic: true });
    expect(CINEMATIC_SECONDS).toBe(4.6);
    g = stepGlide(g, CINEMATIC_SECONDS / 2);
    expect(glideCamera(g).hy).toBeCloseTo(596, 9);
    g = stepGlide(g, CINEMATIC_SECONDS / 2);
    expect(glideCamera(g)).toBe(HOME_MORNING);
    const plain = startGlide(settled(work), HOME_MORNING, false);
    expect(plain.cinematic).toBeUndefined();
    expect(glideCamera(stepGlide(plain, SWING_SECONDS / 2)).hy).toBe(582);
    expect(startGlide(settled(work), HOME_MORNING, true, true)).toEqual(settled(HOME_MORNING)); // instant wins
  });

  it('interrupting the cinematic turn starts from where it is on screen', () => {
    const g = stepGlide(startGlide(settled(work), HOME_MORNING, false, true), 1.2);
    const back = startGlide(g, CAMERAS.work, false);
    expect(back.from).toEqual(glideCamera(g));
    expect(back.from.hy).toBeGreaterThan(582);
  });

  it('localDay is the local calendar day', () => {
    expect(localDay(new Date(2026, 10, 11, 0, 1).getTime())).toBe('2026-11-11');
    expect(localDay(new Date(2026, 10, 11, 23, 59).getTime())).toBe('2026-11-11');
    expect(localDay(new Date(2026, 10, 12, 5, 0).getTime())).toBe('2026-11-12');
  });
});
