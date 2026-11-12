import { describe, expect, it } from 'vitest';
import { CAMERAS, CINEMATIC_SECONDS, GLIDE_SECONDS, HOME_MORNING, SWING_SECONDS, type CameraPreset } from '../horizon/cameras';
import { ribbonKind } from '../screens/Frame';
import { MAIN_HEIGHT, MAIN_LEFT, MAIN_TOP, MAIN_WIDTH, RAIL_WIDTH, SHELL_INSET, ZONES, ZONES_WIDE, rowEdges, zoneEdges } from '../screens/frameLayout';
import { STAGE_HEIGHT, STAGE_WIDTH } from '../stage/fitScale';
import {
  FADE_OUT_S,
  IDLES,
  NOTE_SIZES,
  WALKS,
  WALK_SPEED,
  buddyFrame,
  driftAt,
  initialPresence,
  isNight,
  loopSeconds,
  middle,
  spotFor,
  spriteSize,
  stepPresence,
  wanderAt,
  type Presence,
  type Spot,
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

describe('the walk table', () => {
  it('centres Work near the concept (985), Home near 1616, and keeps Unwind at 960 to 1220', () => {
    expect(Math.abs(middle(WALKS.work) - 985)).toBeLessThanOrEqual(10);
    expect(Math.abs(middle(WALKS.home) - 1616)).toBeLessThanOrEqual(10);
    expect(WALKS.unwind).toMatchObject({ min: 960, max: 1220, px: 6 });
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

/** The frame's panel rectangles on a place, in stage pixels, from the layout constants. */
function panels(place: WattPlace): Rect[] {
  const out: Rect[] = [{ left: SHELL_INSET, right: SHELL_INSET + RAIL_WIDTH, top: MAIN_TOP, bottom: MAIN_TOP + MAIN_HEIGHT }];
  const [band, , ribbon] = rowEdges();
  if (ribbonKind(place)) {
    // Top band zones (left wing, centre, right wing) and the ribbon across the main area.
    for (const z of zoneEdges(ZONES)) out.push({ left: MAIN_LEFT + z.left, right: MAIN_LEFT + z.right, top: band.top, bottom: band.bottom });
    out.push({ left: MAIN_LEFT, right: MAIN_LEFT + MAIN_WIDTH, top: ribbon.top, bottom: ribbon.bottom });
  } else {
    // A tall place (no ribbon): its two wings run the full height.
    out.push({ left: MAIN_LEFT, right: MAIN_LEFT + ZONES_WIDE[0], top: MAIN_TOP, bottom: MAIN_TOP + MAIN_HEIGHT });
    out.push({ left: MAIN_LEFT + MAIN_WIDTH - ZONES_WIDE[1], right: MAIN_LEFT + MAIN_WIDTH, top: MAIN_TOP, bottom: MAIN_TOP + MAIN_HEIGHT });
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
  for (const pose of poses) {
    const { w, h } = spriteSize(pose, walk.px);
    const y = camera.hy - h;
    top = Math.min(top, y);
    right = Math.max(right, walk.max + w);
    for (const k of [0, 0.5, 1]) {
      for (const i of [0, 1]) {
        const n = driftAt('note', walk, walk.max, y, w, i, k);
        const z = driftAt('z', walk, walk.max, y, w, i, k);
        right = Math.max(right, n.left + NOTE_SIZES[0], z.left + 22);
        top = Math.min(top, n.top, z.top);
      }
    }
  }
  return { left: walk.min, right, top, bottom: camera.hy };
}

describe('walk ranges and the panels at 2560 x 720', () => {
  for (const place of PLACES) {
    it(`${place}: Watt never reaches a card, the ribbon or the rail`, () => {
      for (const camera of camerasOf(place)) {
        const box = reach(place, camera);
        expect(box.top).toBeGreaterThanOrEqual(WALKS[place].ceiling);
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
  it('is slow and calm: today\'s 14 px a second, idles of 20 s or more, mostly standing', () => {
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
      const f = buddyFrame(walk, at(14), t, false);
      poses.add(f.pose);
      if (!wanderAt(walk, t).moving) expect(f.pose).toBe('idle');
    }
    expect([...poses].sort()).toEqual(['idle', 'walk']);
    expect(buddyFrame(walk, at(14), 1, false).notes).toBe(false);
    expect(buddyFrame(walk, at(14), 1, true).notes).toBe(true);
    expect(buddyFrame(walk, at(14), 1, true).z).toBe(false);
  });
  it('sleeps in the middle at night with z and no notes, even with music, on every place', () => {
    for (const place of PLACES) {
      for (const playing of [false, true]) {
        const f = buddyFrame(WALKS[place], at(23), 300, playing);
        expect(f).toMatchObject({ pose: 'sleep', z: true, notes: false, x: middle(WALKS[place]) });
      }
    }
  });
  it('is a fixed pose with nothing drifting under reduced motion', () => {
    const a = buddyFrame(walk, at(14), 1, true, true);
    const b = buddyFrame(walk, at(14), 90, true, true);
    expect(a).toEqual(b);
    expect(a).toMatchObject({ pose: 'idle', notes: false, z: false, x: middle(walk) });
    expect(buddyFrame(walk, at(2), 1, true, true).pose).toBe('sleep');
  });
});

describe('where Watt shows', () => {
  const ms = at(14).getTime();
  it('on Work, Home, Meet and Unwind, on the place camera', () => {
    for (const place of PLACES) expect(spotFor(place, ms)).toEqual({ place, camera: CAMERAS[place] });
  });
  it('not on Zen, and not on Meet during a call', () => {
    expect(spotFor('zen', ms)).toBeNull();
    expect(spotFor('meet', ms, true)).toBeNull();
    expect(spotFor('work', ms, true)).not.toBeNull();
  });
  it('on Home in the morning it stands on the Rainier camera', () => {
    expect(spotFor('home', at(9).getTime())!.camera).toBe(HOME_MORNING);
  });
});

/** Step a presence `seconds` forward in frames of 0.05 s toward `want`, recording each frame. */
function run(p: Presence, want: Spot | null, seconds: number, ms: number): { p: Presence; trace: Presence[] } {
  const trace: Presence[] = [];
  for (let t = 0; t < seconds - 1e-9; t += 0.05) {
    p = stepPresence(p, want, 0.05, ms);
    trace.push(p);
  }
  return { p, trace };
}

describe('moving between places', () => {
  const day = at(14).getTime();
  const work = spotFor('work', day)!;
  const unwind = spotFor('unwind', day)!;

  it('fades out where it stands and fades back in at the new place once the camera has settled', () => {
    const start = run(initialPresence(work), work, 5, day).p;
    expect(start.opacity).toBe(1);
    const { p, trace } = run(start, unwind, 4, day);
    // While the camera glides, Watt is either at Work fading out or at Unwind at opacity 0: never in between.
    const arrive = trace.findIndex((s) => s.at?.place === 'unwind');
    expect(arrive).toBeGreaterThan(0);
    expect(arrive * 0.05 + 0.05).toBeGreaterThanOrEqual(Math.max(FADE_OUT_S, GLIDE_SECONDS) - 1e-6);
    for (const s of trace.slice(0, arrive)) expect(s.at?.place).toBe('work');
    expect(trace[arrive].opacity).toBe(0);
    expect(trace[arrive].since).toBe(0);
    expect(p.at?.place).toBe('unwind');
    expect(p.opacity).toBe(1);
  });

  it('stays hidden through the cinematic morning turn on Home, then a later turn that morning is a swing', () => {
    const morning = at(9).getTime();
    const w = spotFor('work', morning)!;
    const h = spotFor('home', morning)!;
    let p = run(initialPresence(w), w, 2, morning).p;
    let r = run(p, h, CINEMATIC_SECONDS + 1.5, morning);
    let arrive = r.trace.findIndex((s) => s.at?.place === 'home');
    expect((arrive + 1) * 0.05).toBeGreaterThanOrEqual(CINEMATIC_SECONDS - 1e-6);
    for (const s of r.trace.slice(0, arrive)) expect(s.at?.place === 'home' && s.opacity > 0).toBe(false);
    p = run(r.p, w, 4, morning).p;
    r = run(p, h, 5, morning);
    arrive = r.trace.findIndex((s) => s.at?.place === 'home');
    expect((arrive + 1) * 0.05).toBeGreaterThanOrEqual(SWING_SECONDS - 1e-6);
    expect((arrive + 1) * 0.05).toBeLessThan(CINEMATIC_SECONDS);
  });

  it('hides when Home swings back west at 11:30 AM and reappears after the swing', () => {
    const before = spotFor('home', at(11, 29).getTime())!;
    const after = spotFor('home', at(11, 30).getTime())!;
    expect(before.camera).not.toBe(after.camera);
    const p = run(initialPresence(before), before, 1, at(11, 29).getTime()).p;
    const r = run(p, after, 5, at(11, 30).getTime());
    const arrive = r.trace.findIndex((s) => s.at?.camera === after.camera);
    expect((arrive + 1) * 0.05).toBeGreaterThanOrEqual(SWING_SECONDS - 1e-6);
  });

  it('goes away on Zen and comes back with no camera wait when Zen closes on the same place', () => {
    let p = run(initialPresence(work), null, 2, day).p;
    expect(p.at).toBeNull();
    expect(p.opacity).toBe(0);
    const r = run(p, work, 2, day);
    expect(r.trace[0].at?.place).toBe('work');
    expect(r.p.opacity).toBe(1);
  });

  it('opened on Zen, it waits for the glide from the Work camera the horizon starts on', () => {
    const r = run(initialPresence(null), unwind, 3, day);
    const arrive = r.trace.findIndex((s) => s.at?.place === 'unwind');
    expect((arrive + 1) * 0.05).toBeGreaterThanOrEqual(GLIDE_SECONDS - 1e-6);
  });

  it('jumps straight there under reduced motion', () => {
    const p = stepPresence(initialPresence(work), unwind, 0, day, true);
    expect(p).toMatchObject({ at: unwind, opacity: 1, wait: 0 });
    expect(stepPresence(p, null, 0, day, true)).toMatchObject({ at: null, opacity: 0 });
  });
});

describe('drifting notes and z', () => {
  it('stay at or under the ceiling and start beside the head on Work, as in the concept', () => {
    const walk = WALKS.work;
    const { w, h } = spriteSize('idle', walk.px);
    const y = 582 - h;
    expect(y).toBe(534);
    for (let k = 0; k <= 1; k += 0.1) expect(driftAt('note', walk, 985, y, w, 0, k).top).toBeGreaterThanOrEqual(walk.ceiling);
    // The concept's notes sit at about (1065, 530) beside a sheep at (985, 534).
    const n = driftAt('note', walk, 985, y, w, 0, 0);
    expect(Math.abs(n.left - 1065)).toBeLessThanOrEqual(10);
    expect(Math.abs(n.top - 530)).toBeLessThanOrEqual(6);
  });
  it('keep today\'s offsets on Unwind', () => {
    const walk = WALKS.unwind;
    expect(driftAt('note', walk, 1000, 433, 108, 1, 0.5)).toEqual({ left: 1000 + 108 + 4 + 15 + 10, top: 433 - 6 - 22 });
    expect(driftAt('z', walk, 1000, 457, 108, 0, 0.5)).toEqual({ left: 1000 + 108 - 4 + 13, top: 457 - 14 - 23 });
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
