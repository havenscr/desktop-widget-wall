import { describe, expect, it } from 'vitest';
import { bodyBox, createBox, propFits, propRise } from './petFrame';
import { BOW_WITH_HEADPHONES, EAR, NO_HEADPHONES, POSES, PROPS, PROP_COLORS, PROP_SPRITES, SPARKLE, SPRITES, STAR_AT, propColor, propOrigin, type Pose, type Prop } from './sprites';

/** Every pixel (x, y) of `map` that is drawn, placed at (ox, oy). */
function pixels(map: readonly string[], ox: number, oy: number): { x: number; y: number; ch: string }[] {
  const out: { x: number; y: number; ch: string }[] = [];
  map.forEach((row, y) => [...row].forEach((ch, x) => ch !== '.' && out.push({ x: x + ox, y: y + oy, ch })));
  return out;
}
const at = (pose: Pose, x: number, y: number) => SPRITES[pose][y]?.[x] ?? '.';
const key = (x: number, y: number) => `${x},${y}`;
/** The pixels of `prop` on `pose`, or none when it is not drawn there. */
const placed = (prop: Prop, pose: Pose) => {
  const [ox, oy] = propOrigin(prop, pose);
  return propFits(prop, pose) ? pixels(PROP_SPRITES[prop].map, ox, oy) : [];
};

describe('the chosen drawings', () => {
  it('headphones: one big cup on the ear, the band over his head, placed from the ear at (-2, -1)', () => {
    expect(PROP_SPRITES.headphones).toEqual({ map: ['..kk.', 'ccc.k', 'cCc..', 'ccc..'], dx: -2, dy: -1, anchor: 'ear' });
  });
  it('star: a five-point star patch on the wool, at (5, 3) when he stands, in two colours', () => {
    expect(PROP_SPRITES.star).toEqual({ map: ['..s..', '.sts.', 'sttts', '.sts.', '.s.s.'], dx: 5, dy: 3, anchor: 'body' });
    expect(STAR_AT.idle).toEqual([5, 3]);
    expect(propOrigin('star', 'idle')).toEqual([5, 3]);
    expect(PROP_COLORS.s).toBe('#ffc24d');
    expect(PROP_COLORS.t).toBe('#fff0b8');
    expect(PROP_COLORS.C).toBe('#ff7ab8');
    expect(PROP_COLORS.c).toBe('#ff3d9a');
    expect(PROP_COLORS.k).toBe('#35e6ea');
  });
  it('the happy sparkle keeps its small plus; it is not the star he wears', () => {
    expect(SPARKLE).toEqual(['.s.', 'sss', '.s.']);
  });
  it('every pose has a place for the star: the whole table, pinned', () => {
    expect(Object.keys(STAR_AT).sort()).toEqual([...POSES].sort());
    expect(STAR_AT).toEqual({
      idle: [5, 3],
      walk: [5, 3],
      sleep: [5, 2],
      read: [5, 3],
      look: [5, 3],
      yawn: [5, 3],
      stretch: [5, 3],
      eat: [5, 3],
      held: [5, 3],
      held2: [5, 3],
      land: [5, 2],
      sit: [5, 3],
      dizzy: [5, 3],
      alert: [5, 3],
      hop: [5, 2],
      spin1: [2, 3],
      spin2: [2, 3],
      lie: [5, 2],
      watch: [5, 3],
      watchEar: [5, 3],
      front: [2, 3],
    });
  });
});

describe('the star patch', () => {
  const others: Prop[] = ['headphones', 'scarf', 'sunglasses', 'nightcap', 'book'];
  for (const pose of POSES) {
    it(`${pose}: every pixel lies on wool, inside the sprite, clear of what is worn with it`, () => {
      expect(propFits('star', pose)).toBe(true);
      const px = placed('star', pose);
      expect(px).toHaveLength(14);
      const taken = new Set(others.flatMap((p) => placed(p, pose).map((q) => key(q.x, q.y))));
      for (const p of px) {
        expect(at(pose, p.x, p.y), `${pose}: star pixel at ${p.x},${p.y} is not on wool`).toBe('w');
        expect(taken.has(key(p.x, p.y)), `${pose}: star pixel at ${p.x},${p.y} is under another prop`).toBe(false);
        expect(propColor(PROP_SPRITES.star.map, p.x - STAR_AT[pose][0], p.y - STAR_AT[pose][1])).not.toBeNull();
      }
    });
  }
  it('never rises above the sprite, so the rise limit cannot drop it; it adds nothing to his box', () => {
    for (const pose of POSES) {
      expect(propOrigin('star', pose)[1]).toBeGreaterThanOrEqual(0);
      expect(propRise({ pose, prop: null, scarf: false, cosmetic: 'star' })).toBe(0);
      for (const dir of [1, -1] as const) {
        const bare = bodyBox({ pose, prop: null, scarf: false, cosmetic: null }, dir, 6, 100, 200);
        const worn = bodyBox({ pose, prop: null, scarf: false, cosmetic: 'star' }, dir, 6, 100, 200, createBox());
        expect(worn).toEqual(bare);
      }
    }
  });
  it('it is drawn where the sheep is drawn, so it flips with him: the box holds for either direction', () => {
    const cols = SPRITES.idle[0].length;
    expect(propOrigin('star', 'idle')[0] + PROP_SPRITES.star.map[0].length).toBeLessThanOrEqual(cols);
  });
});

describe('the headphones', () => {
  const worn = POSES.filter((p) => propFits('headphones', p));
  it('are worn on every pose with a side view, and not on the poses seen from the front or the back', () => {
    expect(POSES.filter((p) => !worn.includes(p)).sort()).toEqual([...NO_HEADPHONES].sort());
    expect([...NO_HEADPHONES].sort()).toEqual(['front', 'spin1', 'spin2']);
  });
  for (const pose of worn) {
    it(`${pose}: the cup covers the ear pixel, and the band sits on the head with no row of sky between`, () => {
      const [ex, ey] = EAR[pose];
      const px = pixels(PROP_SPRITES.headphones.map, ...propOrigin('headphones', pose));
      expect(px.find((p) => p.x === ex && p.y === ey)?.ch, `${pose}: the cup is not on the ear at ${ex},${ey}`).toBe('c');
      const bands = px.filter((p) => p.ch === 'k');
      expect(bands.length).toBeGreaterThan(0);
      // A band pixel with a pixel of his head (not a leg, not empty) straight under it.
      const sits = bands.filter((b) => !'.l'.includes(at(pose, b.x, b.y + 1)));
      expect(sits.length, `${pose}: no band pixel touches the head`).toBeGreaterThan(0);
      // The cup is on his head: at least six of its nine pixels over his sprite (the raised head's
      // neck leaves a small gap behind the cup, as in the chosen picture).
      const cup = px.filter((p) => p.ch === 'c' || p.ch === 'C');
      expect(cup).toHaveLength(9);
      expect(cup.filter((c) => at(pose, c.x, c.y) !== '.').length).toBeGreaterThanOrEqual(6);
    });
  }
  it('rise at most two sprite pixels above the sprite, even on the raised head', () => {
    for (const pose of worn) expect(propRise({ pose, prop: 'headphones', scarf: false, cosmetic: null })).toBeLessThanOrEqual(2);
  });
});

describe('every prop and pose', () => {
  it('a prop that is drawn lies inside the sprite box (the rise limit and the sides)', () => {
    for (const pose of POSES)
      for (const prop of PROPS) {
        if (!propFits(prop, pose)) continue;
        const [ox, oy] = propOrigin(prop, pose);
        expect(oy).toBeGreaterThanOrEqual(-2);
        expect(ox).toBeGreaterThanOrEqual(-2);
      }
  });
  it('the bow is drawn on every pose (it is not dropped the way the star used to be)', () => {
    expect(POSES.filter((p) => !propFits('bow', p))).toEqual([]);
  });
});

describe('the bow with the headphones', () => {
  const wearing = POSES.filter((p) => propFits('headphones', p));
  const keyOf = (p: { x: number; y: number }) => key(p.x, p.y);
  it('alone it is where it always was: from the ear at (-3, -1)', () => {
    expect(PROP_SPRITES.bow).toEqual({ map: ['xx.xx', '.xxx.'], dx: -3, dy: -1, anchor: 'ear' });
    for (const pose of POSES) {
      const [ex, ey] = EAR[pose];
      expect(propOrigin('bow', pose)).toEqual([ex - 3, ey - 1]);
      expect(propOrigin('bow', pose, null)).toEqual([ex - 3, ey - 1]);
      expect(propOrigin('bow', pose, 'scarf')).toEqual([ex - 3, ey - 1]);
    }
  });
  it('the moves are pinned: three pixels back, five back and one down on the raised head', () => {
    for (const pose of POSES) expect(BOW_WITH_HEADPHONES[pose]).toEqual(pose === 'look' || pose === 'watch' || pose === 'watchEar' ? [-5, 1] : [-3, 0]);
  });
  for (const pose of wearing) {
    it(`${pose}: the cup and the band hide none of the bow (all 7 of its pixels show), the bow is on his wool, and the headphones show whole`, () => {
      const hp = placed('headphones', pose);
      const hpKeys = new Set(hp.map(keyOf));
      const [bx, by] = propOrigin('bow', pose, 'headphones');
      const bow = pixels(PROP_SPRITES.bow.map, bx, by);
      expect(bow).toHaveLength(7);
      // The headphones are drawn over the bow: the bow pixels that show are the ones not under a headphone pixel.
      expect(bow.filter((b) => !hpKeys.has(keyOf(b)))).toHaveLength(7);
      for (const b of bow) expect(at(pose, b.x, b.y), `${pose}: bow pixel at ${b.x},${b.y} is not on wool`).toBe('w');
      // The headphones draw over the bow, so every one of their pixels shows.
      expect(hp).toHaveLength(12);
      expect(propFits('bow', pose, 'headphones')).toBe(true);
      // Where the bow sat before the fix, it would have lost pixels under the cup and the band.
      const [ox, oy] = propOrigin('bow', pose);
      const old = pixels(PROP_SPRITES.bow.map, ox, oy).filter((b) => hpKeys.has(keyOf(b)));
      expect(old.length).toBeGreaterThan(0);
    });
  }
  it('the bow alone is not moved by any other prop', () => {
    for (const pose of POSES) for (const prop of PROPS) if (prop !== 'headphones') expect(propOrigin('bow', pose, prop)).toEqual(propOrigin('bow', pose));
  });
});
