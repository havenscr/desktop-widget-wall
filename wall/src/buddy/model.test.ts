import { describe, expect, it } from 'vitest';
import { CAMERAS, HOME_MORNING, type CameraPreset } from '../horizon/cameras';
import { ribbonKind } from '../screens/Frame';
import { MAIN_HEIGHT, MAIN_LEFT, MAIN_TOP, MAIN_WIDTH, RAIL_WIDTH, SHELL_INSET, ZONE_GAP, ZONES, ZONES_WIDE, rowEdges, zoneEdges } from '../screens/frameLayout';
import { STAGE_HEIGHT, STAGE_WIDTH } from '../stage/fitScale';
import {
  FADE_IN_S,
  FADE_OUT_S,
  IDLES,
  NOTE_SIZES,
  UNWIND_ROW,
  WALKS,
  WALK_SPEED,
  Z_WIDTH,
  buddyFrame,
  cameraOf,
  cameraReady,
  createClock,
  createDrift,
  createFrame,
  createPresence,
  createWander,
  driftAt,
  isIdle,
  isNight,
  loopSeconds,
  middle,
  readClock,
  spriteHeight,
  spriteWidth,
  stepPresence,
  wanderAt,
  wattPlaceFor,
  type Presence,
  type WattPlace,
} from './model';
import { SPRITES, pixelColor, type Pose } from './sprites';

const at = (h: number, m = 0) => new Date(2026, 10, 11, h, m);
const PLACES = Object.keys(WALKS) as WattPlace[];

describe('night window', () => {
  it('sleeps from 9:30 PM to 6:30 AM local time', () => {
    expect(isNight(at(21, 29))).toBe(false);
    expect(isNight(at(21, 30))).toBe(true);
    expect(isNight(at(23, 59))).toBe(true);
    expect(isNight(at(0, 0))).toBe(true);
    expect(isNight(at(6, 29))).toBe(true);
    expect(isNight(at(6, 30))).toBe(false);
    expect(isNight(at(12))).toBe(false);
  });
});

describe('the clock', () => {
  it('works out night and Home\'s camera once a minute, in the same record', () => {
    const clock = createClock();
    expect(readClock(clock, at(9).getTime())).toBe(clock);
    expect(clock).toMatchObject({ night: false, home: HOME_MORNING });
    // Within the same minute nothing is worked out again (a planted value survives).
    clock.night = true;
    readClock(clock, at(9).getTime() + 59_000);
    expect(clock.night).toBe(true);
    readClock(clock, at(9, 1).getTime());
    expect(clock.night).toBe(false);
    readClock(clock, at(11, 30).getTime());
    expect(clock.home).toBe(CAMERAS.home);
    readClock(clock, at(21, 30).getTime());
    expect(clock.night).toBe(true);
  });
});

describe('the walk table', () => {
  it('centres Work near the concept (985), Home near 1616, and puts Unwind at the concept spot in f_unwind', () => {
    expect(Math.abs(middle(WALKS.work) - 985)).toBeLessThanOrEqual(10);
    expect(Math.abs(middle(WALKS.home) - 1616)).toBeLessThanOrEqual(10);
    const unwindW = spriteWidth('idle', WALKS.unwind.px);
    // The body walks between about x 430 and 580, centred near the concept's 452 + 54.
    expect(WALKS.unwind.min).toBe(430);
    expect(WALKS.unwind.max + unwindW).toBeLessThanOrEqual(580);
    expect(Math.abs(middle(WALKS.unwind) + unwindW / 2 - 500)).toBeLessThanOrEqual(10);
    expect(WALKS.meet).toEqual(WALKS.work);
    expect([WALKS.work.px, WALKS.home.px, WALKS.unwind.px]).toEqual([4, 5, 6]);
  });
});

interface Rect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}
const overlaps = (a: Rect, b: Rect) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

/**
 * Unwind's left wing in the concept: the clock and the wind down block above about y 414, the
 * Tomorrow block below the horizon. Watt walks in the gap between them, over the horizon.
 */
const UNWIND_WING_UPPER_BOTTOM = 414;

/**
 * The rest of the merged Unwind layout, measured in the Unwind still at 2560 by 720 (flow
 * layout, so not constants): the album art, and along the bottom the Tomorrow block, the status
 * line and the Screens off button. The transport and volume row is `UNWIND_ROW`.
 */
const UNWIND_MEASURED: Rect[] = [
  { left: 624, right: 848, top: 126, bottom: 350 }, // art
  { left: 124, right: 594, top: 572, bottom: 626 }, // Tomorrow
  { left: 124, right: 663, top: 662, bottom: 686 }, // status line
  { left: 691, right: 876, top: 648, bottom: 700 }, // Screens off
];

/** The panel rectangles on a place, in stage pixels: the frame's layout constants, plus Unwind's transport row. */
function panels(place: WattPlace): Rect[] {
  const out: Rect[] = [{ left: SHELL_INSET, right: SHELL_INSET + RAIL_WIDTH, top: MAIN_TOP, bottom: MAIN_TOP + MAIN_HEIGHT }];
  const [band, , ribbon] = rowEdges();
  if (ribbonKind(place)) {
    // Top band zones (left wing, centre, right wing) and the ribbon across the main area.
    for (const z of zoneEdges(ZONES)) out.push({ left: MAIN_LEFT + z.left, right: MAIN_LEFT + z.right, top: band.top, bottom: band.bottom });
    out.push({ left: MAIN_LEFT, right: MAIN_LEFT + MAIN_WIDTH, top: ribbon.top, bottom: ribbon.bottom });
  } else {
    // A tall place: the left wing above the gap and below the horizon, the right wing the full
    // height, and the transport and volume row in the centre.
    const wing = { left: MAIN_LEFT, right: MAIN_LEFT + ZONES_WIDE[0] };
    out.push({ ...wing, top: MAIN_TOP, bottom: UNWIND_WING_UPPER_BOTTOM });
    out.push({ ...wing, top: CAMERAS.unwind.hy, bottom: MAIN_TOP + MAIN_HEIGHT });
    out.push({ left: MAIN_LEFT + MAIN_WIDTH - ZONES_WIDE[1], right: MAIN_LEFT + MAIN_WIDTH, top: MAIN_TOP, bottom: MAIN_TOP + MAIN_HEIGHT });
    out.push({ ...UNWIND_ROW }, ...UNWIND_MEASURED);
  }
  return out;
}

/** Every camera a place can show (Home turns to Rainier in the morning). */
const camerasOf = (place: WattPlace): CameraPreset[] => (place === 'home' ? [CAMERAS.home, HOME_MORNING] : [CAMERAS[place]]);

/** The box Watt can reach on a place: the whole walk, every pose, the notes and the z's. */
function reach(place: WattPlace, camera: CameraPreset): Rect {
  const walk = WALKS[place];
  const poses: Pose[] = ['idle', 'walk', 'sleep'];
  let right = 0;
  let top = Infinity;
  const d = createDrift();
  for (const pose of poses) {
    const w = spriteWidth(pose, walk.px);
    const y = camera.hy - spriteHeight(pose, walk.px);
    top = Math.min(top, y);
    right = Math.max(right, walk.max + w);
    for (let k = 0; k <= 1; k += 0.05) {
      for (const i of [0, 1]) {
        driftAt('note', walk, walk.max, y, w, i, k, d);
        right = Math.max(right, d.left + NOTE_SIZES[i]);
        top = Math.min(top, d.top);
        driftAt('z', walk, walk.max, y, w, i, k, d);
        right = Math.max(right, d.left + Z_WIDTH);
        top = Math.min(top, d.top);
      }
    }
  }
  return { left: walk.min, right, top, bottom: camera.hy };
}

describe('walk ranges and the panels at 2560 x 720', () => {
  for (const place of PLACES) {
    it(`${place}: Watt never reaches a card, the ribbon, the rail or Unwind's transport row`, () => {
      for (const camera of camerasOf(place)) {
        const box = reach(place, camera);
        expect(box.top).toBeGreaterThanOrEqual(WALKS[place].ceiling);
        expect(box.right).toBeLessThanOrEqual(WALKS[place].right);
        expect(box.left).toBeGreaterThan(0);
        expect(box.right).toBeLessThan(STAGE_WIDTH);
        expect(box.bottom).toBeLessThanOrEqual(STAGE_HEIGHT);
        for (const panel of panels(place)) expect(overlaps(box, panel), `${place} over ${JSON.stringify(panel)}`).toBe(false);
      }
    });
  }
  it('on the ribbon places Watt stands in the band over the horizon (feet on hy 582)', () => {
    for (const place of ['work', 'home', 'meet'] as const) {
      const box = reach(place, CAMERAS[place]);
      expect(box.top).toBeGreaterThanOrEqual(rowEdges()[0].bottom);
      expect(box.bottom).toBe(582);
      expect(box.bottom).toBeLessThan(rowEdges()[2].top);
    }
  });
});

describe('wandering', () => {
  it('stays inside each range, walks both ways and starts standing in the middle', () => {
    for (const place of PLACES) {
      const walk = WALKS[place];
      const dirs = new Set<number>();
      for (let t = 0; t < loopSeconds(walk) * 2; t += 0.5) {
        const w = wanderAt(walk, t);
        expect(w.x).toBeGreaterThanOrEqual(walk.min - 1e-9);
        expect(w.x).toBeLessThanOrEqual(walk.max + 1e-9);
        if (w.moving) dirs.add(w.dir);
      }
      expect([...dirs].sort()).toEqual([-1, 1]);
      expect(wanderAt(walk, 0)).toMatchObject({ x: middle(walk), moving: false });
    }
  });
  it('is slow and calm: 14 px a second, idles of 20 s or more, mostly standing', () => {
    expect(WALK_SPEED).toBe(14);
    expect(Math.min(...IDLES)).toBeGreaterThanOrEqual(20);
    for (const place of PLACES) {
      const walk = WALKS[place];
      let moving = 0;
      let n = 0;
      let prev = wanderAt(walk, 0).x;
      for (let t = 0.1; t < loopSeconds(walk); t += 0.1) {
        const w = wanderAt(walk, t);
        expect(Math.abs(w.x - prev)).toBeLessThanOrEqual(WALK_SPEED * 0.1 + 1e-6);
        prev = w.x;
        if (w.moving) moving++;
        n++;
      }
      expect(moving / n).toBeLessThan(0.3);
    }
  });
  it('never jumps at the loop seam', () => {
    const walk = WALKS.home;
    const L = loopSeconds(walk);
    expect(Math.abs(wanderAt(walk, L - 0.01).x - wanderAt(walk, L).x)).toBeLessThan(1);
  });
});

describe('buddyFrame', () => {
  const walk = WALKS.work;
  it('walks with legs moving only while moving, with notes only while music plays', () => {
    const poses = new Set<string>();
    for (let t = 0; t < loopSeconds(walk); t += 0.1) {
      const f = buddyFrame(walk, false, t, false);
      poses.add(f.pose);
      if (!wanderAt(walk, t).moving) expect(f.pose).toBe('idle');
    }
    expect([...poses].sort()).toEqual(['idle', 'walk']);
    expect(buddyFrame(walk, false, 1, false).notes).toBe(false);
    expect(buddyFrame(walk, false, 1, true).notes).toBe(true);
    expect(buddyFrame(walk, false, 1, true).z).toBe(false);
  });
  it('sleeps in the middle at night with z and no notes, even with music, on every place', () => {
    for (const place of PLACES) {
      for (const playing of [false, true]) {
        expect(buddyFrame(WALKS[place], true, 300, playing)).toMatchObject({ pose: 'sleep', z: true, notes: false, x: middle(WALKS[place]) });
      }
    }
  });
  it('is a fixed pose with nothing drifting under reduced motion', () => {
    const a = { ...buddyFrame(walk, false, 1, true, true) };
    const b = { ...buddyFrame(walk, false, 90, true, true) };
    expect(a).toEqual(b);
    expect(a).toMatchObject({ pose: 'idle', notes: false, z: false, x: middle(walk) });
    expect(buddyFrame(walk, true, 1, true, true).pose).toBe('sleep');
  });
});

describe('where Watt shows', () => {
  it('on Work, Home, Meet and Unwind; not on Zen, nor on Meet during a call', () => {
    for (const place of PLACES) expect(wattPlaceFor(place)).toBe(place);
    expect(wattPlaceFor('zen')).toBeNull();
    expect(wattPlaceFor('meet', true)).toBeNull();
    expect(wattPlaceFor('work', true)).toBe('work');
  });
  it('uses each place camera, and Rainier on Home in the morning', () => {
    const clock = readClock(createClock(), at(14).getTime());
    for (const place of PLACES) expect(cameraOf(place, clock)).toBe(CAMERAS[place]);
    readClock(clock, at(9).getTime());
    expect(cameraOf('home', clock)).toBe(HOME_MORNING);
  });
  it('is ready only when the horizon is settled on that camera', () => {
    expect(cameraReady('work', CAMERAS.work, { to: CAMERAS.work, moving: false })).toBe(true);
    expect(cameraReady('work', CAMERAS.work, { to: CAMERAS.work, moving: true })).toBe(false);
    expect(cameraReady('home', HOME_MORNING, { to: CAMERAS.home, moving: false })).toBe(false);
    expect(cameraReady('work', CAMERAS.work, { to: null, moving: false })).toBe(false);
    expect(cameraReady(null, null, { to: null, moving: false })).toBe(false);
  });
});

/** A fake horizon: the camera it is on or heading to, and whether it moves. */
interface Horizon {
  to: CameraPreset | null;
  moving: boolean;
}
interface Want {
  place: WattPlace | null;
  night?: boolean;
}

/** Step `p` for `seconds` in 0.05 s frames toward `want` under `h`, recording opacity and place each frame. */
function run(p: Presence, want: Want, h: Horizon, seconds: number) {
  const trace: { place: WattPlace | null; opacity: number; camera: CameraPreset | null; since: number }[] = [];
  for (let t = 0; t < seconds - 1e-9; t += 0.05) {
    const camera = want.place ? CAMERAS[want.place] : null;
    stepPresence(p, want.place, camera, want.night ?? false, cameraReady(want.place, camera, h), 0.05);
    trace.push({ place: p.place, opacity: p.opacity, camera: p.camera, since: p.since });
  }
  return trace;
}

/** A presence settled and fully up on `place`. */
function upOn(place: WattPlace): Presence {
  const p = createPresence();
  run(p, { place }, { to: CAMERAS[place], moving: false }, FADE_IN_S + 0.2);
  expect(p).toMatchObject({ place, opacity: 1 });
  return p;
}

describe('moving between places', () => {
  it('fades out where it stands, moves unseen and fades in once the camera has settled', () => {
    const p = upOn('work');
    // The camera glides to Unwind for 1.6 s.
    const gliding = run(p, { place: 'unwind' }, { to: CAMERAS.unwind, moving: true }, 1.6);
    for (const s of gliding) expect(s.place === 'unwind' && s.opacity > 0).toBe(false);
    expect(p.opacity).toBe(0);
    const settled = run(p, { place: 'unwind' }, { to: CAMERAS.unwind, moving: false }, FADE_IN_S + 0.1);
    expect(settled[0]).toMatchObject({ place: 'unwind', since: 0 });
    expect(p).toMatchObject({ place: 'unwind', opacity: 1 });
  });

  for (const [label, firstLeg] of [
    ['before the fade out completes', 0.2],
    ['after the fade out completes', 1],
  ] as const) {
    it(`a quick Work to Home to Work reversal ${label} stays hidden until the camera is back and settled`, () => {
      const p = upOn('work');
      const out = run(p, { place: 'home' }, { to: CAMERAS.home, moving: true }, firstLeg);
      const back = run(p, { place: 'work' }, { to: CAMERAS.work, moving: true }, 1.6);
      const visible = [...out, ...back].filter((s) => s.opacity > 0);
      // Only the fading-out frames at Work, all before the reversal; nothing while it moves back.
      for (const s of back) expect(s.opacity === 0 || s.opacity < out[out.length - 1].opacity + 1e-9).toBe(true);
      for (const s of visible) expect(s.place).toBe('work');
      expect(back[back.length - 1].opacity).toBe(0);
      run(p, { place: 'work' }, { to: CAMERAS.work, moving: false }, FADE_IN_S + 0.1);
      expect(p).toMatchObject({ place: 'work', opacity: 1 });
    });
  }

  it('Work to Unwind to Work: never up during either glide', () => {
    const p = upOn('work');
    const legs = [...run(p, { place: 'unwind' }, { to: CAMERAS.unwind, moving: true }, 0.8), ...run(p, { place: 'work' }, { to: CAMERAS.work, moving: true }, 1.6)];
    for (const s of legs.slice(Math.round(FADE_OUT_S / 0.05))) expect(s.opacity).toBe(0);
  });

  it('hides while the horizon has not yet turned to the camera Watt expects (Home at 5:00 before the horizon looks)', () => {
    const p = createPresence();
    const clock = readClock(createClock(), at(4, 59).getTime());
    const step = (h: Horizon) => stepPresence(p, 'home', cameraOf('home', clock), clock.night, cameraReady('home', cameraOf('home', clock), h), 0.05);
    for (let i = 0; i < 30; i++) step({ to: CAMERAS.home, moving: false });
    expect(p.opacity).toBe(1);
    readClock(clock, at(5).getTime());
    for (let i = 0; i < 30; i++) step({ to: CAMERAS.home, moving: false });
    expect(p.opacity).toBe(0);
  });

  it('goes away on Zen and stops (idle), then comes back once the horizon is settled', () => {
    const p = upOn('work');
    run(p, { place: null }, { to: CAMERAS.work, moving: false }, 1);
    expect(p).toMatchObject({ place: null, opacity: 0 });
    expect(isIdle(p, null, false)).toBe(true);
    // Leaving Zen to Home: the horizon glides from the Work camera first.
    const glide = run(p, { place: 'home' }, { to: CAMERAS.home, moving: true }, 1.6);
    for (const s of glide) expect(s.opacity).toBe(0);
    // Waiting unseen for the camera: idle (the camera signal wakes it); once ready it is not.
    expect(isIdle(p, 'home', false)).toBe(true);
    expect(isIdle(p, 'home', true)).toBe(false);
    run(p, { place: 'home' }, { to: CAMERAS.home, moving: false }, FADE_IN_S + 0.1);
    expect(p.opacity).toBe(1);
  });

  it('fades out, moves to the middle and fades in asleep at 9:30 PM, and awake at 6:30 AM, starting the wander over', () => {
    const p = upOn('work');
    run(p, { place: 'work' }, { to: CAMERAS.work, moving: false }, 3);
    expect(p.since).toBeGreaterThan(2);
    for (const [night, label] of [
      [true, '9:30 PM'],
      [false, '6:30 AM'],
    ] as const) {
      const trace = run(p, { place: 'work', night }, { to: CAMERAS.work, moving: false }, FADE_OUT_S + FADE_IN_S + 0.2);
      const flip = trace.findIndex((s) => s.opacity === 0);
      expect(flip, label).toBeGreaterThan(0);
      for (let i = 1; i < flip; i++) expect(trace[i].opacity).toBeLessThan(trace[i - 1].opacity);
      expect(trace[flip].since).toBe(0);
      expect(p).toMatchObject({ night, opacity: 1 });
    }
  });

  it('jumps straight there under reduced motion', () => {
    const p = createPresence();
    stepPresence(p, 'work', CAMERAS.work, false, true, 0, true);
    expect(p).toMatchObject({ place: 'work', opacity: 1 });
    stepPresence(p, 'unwind', CAMERAS.unwind, false, true, 0, true);
    expect(p).toMatchObject({ place: 'unwind', opacity: 1, since: 0 });
    stepPresence(p, 'home', CAMERAS.home, false, false, 0, true);
    expect(p).toMatchObject({ place: null, opacity: 0 });
  });

  it('reuses its records: 400 steps change the same presence, frame, drift and clock objects', () => {
    const p = createPresence();
    const f = createFrame();
    const d = createDrift();
    const w = createWander();
    const clock = createClock();
    const walk = WALKS.home;
    for (let i = 0; i < 400; i++) {
      const ms = at(14).getTime() + i * 50;
      expect(readClock(clock, ms)).toBe(clock);
      expect(stepPresence(p, 'home', cameraOf('home', clock), clock.night, true, 0.05)).toBe(p);
      expect(buddyFrame(walk, clock.night, p.since, true, false, f)).toBe(f);
      expect(wanderAt(walk, p.since, w)).toBe(w);
      expect(driftAt('note', walk, f.x, 522, 90, 0, (i % 20) / 20, d)).toBe(d);
    }
    expect(p.opacity).toBe(1);
  });
});

describe('drifting notes and z', () => {
  it('stay at or under the ceiling and start beside the head on Work, as in the concept', () => {
    const walk = WALKS.work;
    const w = spriteWidth('idle', walk.px);
    const y = 582 - spriteHeight('idle', walk.px);
    expect(y).toBe(534);
    for (let k = 0; k <= 1; k += 0.1) expect(driftAt('note', walk, 985, y, w, 0, k).top).toBeGreaterThanOrEqual(walk.ceiling);
    // The concept's notes sit at about (1065, 530) beside a sheep at (985, 534).
    const n = driftAt('note', walk, 985, y, w, 0, 0);
    expect(Math.abs(n.left - 1065)).toBeLessThanOrEqual(10);
    expect(Math.abs(n.top - 530)).toBeLessThanOrEqual(6);
  });
  it('Unwind\'s transport row starts at the centre zone\'s left edge (stage x 624)', () => {
    expect(UNWIND_ROW.left).toBe(MAIN_LEFT + ZONES_WIDE[0] + ZONE_GAP);
    expect(UNWIND_ROW.left).toBe(624);
  });
  it('on Unwind stop short of the transport row and under the wind down block', () => {
    const walk = WALKS.unwind;
    const w = spriteWidth('idle', walk.px);
    for (let k = 0; k <= 1; k += 0.1) {
      const n = driftAt('note', walk, walk.max, 433, w, 0, k);
      expect(n.left + NOTE_SIZES[0]).toBeLessThan(UNWIND_ROW.left);
      expect(n.top).toBeGreaterThanOrEqual(UNWIND_WING_UPPER_BOTTOM);
    }
  });
});

/** The concept's `SH.idle`, copied from the reference file. */
const REFERENCE_IDLE = [
  '....wwwwwww.......',
  '..wwwwwwwwwww.....',
  '.wwwwwwwwwwwwwpf..',
  '.wwwwwwwwwwwwwffff',
  'wwwwwwwwwwwwwwfeff',
  'wwwwwwwwwwwwwwffff',
  'wwwwwwwwwwwwwwwff.',
  '.wwwwwwwwwwwwww...',
  '.wwwwwwwwwwwww....',
  '..wwwwwwwwwww.....',
  '...l..l...l..l....',
  '...l..l...l..l....',
];

/** The concept's `SH.sleep`, copied from the reference file. */
const REFERENCE_SLEEP = [
  '....wwwwwww.......',
  '..wwwwwwwwwww.....',
  '.wwwwwwwwwwwww....',
  '.wwwwwwwwwwwwwpf..',
  'wwwwwwwwwwwwwwffff',
  'wwwwwwwwwwwwwwf-ff',
  'wwwwwwwwwwwwwwwfff',
  '.wwwwwwwwwwwwwww..',
];

describe('sprites', () => {
  it('idle equals the concept map exactly', () => {
    expect([...SPRITES.idle]).toEqual(REFERENCE_IDLE);
  });
  it('has every row the same width and only known pixels', () => {
    for (const map of Object.values(SPRITES)) {
      for (const row of map) {
        expect(row).toHaveLength(map[0].length);
        expect(row).toMatch(/^[.wfe\-pl]+$/);
      }
    }
  });
  it('sleep equals the concept map exactly', () => {
    expect([...SPRITES.sleep]).toEqual(REFERENCE_SLEEP);
  });
  it('walk is the idle body rows plus two leg rows', () => {
    expect(SPRITES.walk.slice(0, 10)).toEqual(REFERENCE_IDLE.slice(0, 10));
    expect(SPRITES.walk[10]).toBe('..l...l....l..l...');
    expect(SPRITES.walk).toHaveLength(12);
  });
  it('shades the wool by row and leaves empty pixels empty', () => {
    expect(pixelColor(SPRITES.idle, 6, 1)).toBe('#f6f2ff');
    expect(pixelColor(SPRITES.idle, 6, 9)).toBe('#bfb2f0');
    expect(pixelColor(SPRITES.idle, 0, 0)).toBeNull();
  });
});
