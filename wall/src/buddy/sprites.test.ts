import { describe, expect, it } from 'vitest';
import { bodyBox, createBox, propFits, propRise } from './petFrame';
import { sheepRects } from './Pixels';
import { BLINKS, BOW_WITH_HEADPHONES, EAR, NO_HEADPHONES, POSES, PROPS, PROP_COLORS, PROP_SPRITES, ROW_DX, SPARKLE, SPRITES, SPRITE_COLORS, STAR_AT, STRANDS, WET_STRAND, WET_WOOL, earShift, pixelColor, pixelColorWet, propColor, propOrigin, type Pose, type Prop, type RowShift } from './sprites';

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

describe('the umbrella is gone', () => {
  it('is no prop, and no map or colour table still uses its letters', () => {
    expect(PROPS).not.toContain('umbrella');
    expect(Object.keys(PROP_SPRITES)).not.toContain('umbrella');
    for (const k of ['u', 'U', 'i']) expect(PROP_COLORS[k], k).toBeUndefined();
    const used = new Set<string>();
    for (const p of PROPS) for (const row of PROP_SPRITES[p].map) for (const ch of row) if (ch !== '.') used.add(ch);
    for (const ch of used) expect(PROP_COLORS[ch], `prop letter ${ch}`).toBeDefined();
    for (const k of Object.keys(PROP_COLORS)) {
      const live = used.has(k) || ['W', 'd', 'S', 'y', 'Y', 'o', 'O', 'a', 'v', 'r', 'R'].includes(k) || 'bBkcghnNxstCqQ'.includes(k);
      expect(live, `colour ${k} is used by some map`).toBe(true);
    }
  });
});

describe('the damp wool', () => {
  const rows = SPRITES.idle.length;
  const zone = (y: number) => (y < rows * 0.45 ? 0 : y < rows * 0.75 ? 1 : 2);
  const first = (pose: Pose, ch: string, y: number) => SPRITES[pose][y].indexOf(ch);

  it('is one step darker than dry in each row zone: the dry colours shifted down by one', () => {
    expect(WET_WOOL).toEqual(['#dcd3fb', '#bfb2f0', '#a79bdc']);
    for (let y = 0; y < rows; y++) {
      const x = first('idle', 'w', y);
      if (x < 0) continue;
      const dry = pixelColor(SPRITES.idle, x, y);
      const wet = pixelColorWet(SPRITES.idle, x, y);
      expect(['#f6f2ff', '#dcd3fb', '#bfb2f0'].indexOf(dry as string)).toBe(zone(y));
      // Strands are one step darker still, so look at a cell that is not one.
      const strand = STRANDS.some(([sx, sy]) => sx === x && sy === y);
      expect(wet).toBe((strand ? WET_STRAND : WET_WOOL)[zone(y)]);
    }
  });

  it('keeps every other colour as it was', () => {
    for (const pose of POSES) {
      SPRITES[pose].forEach((row, y) => {
        [...row].forEach((ch, x) => {
          if (ch === 'w' || ch === '.') return;
          expect(pixelColorWet(SPRITES[pose], x, y)).toBe(SPRITE_COLORS[ch] ?? null);
        });
      });
    }
    expect(pixelColorWet(SPRITES.idle, 0, 0)).toBeNull();
    expect(pixelColorWet(SPRITES.idle, 99, 99)).toBeNull();
  });

  it('strands are the thirteen listed cells, one step darker than the wet row, and only where the pose has wool', () => {
    expect(STRANDS).toHaveLength(13);
    expect(WET_STRAND).toEqual(['#bfb2f0', '#a79bdc', '#9388cf']);
    for (const pose of POSES) {
      const map = SPRITES[pose];
      const found: string[] = [];
      map.forEach((row, y) => {
        [...row].forEach((ch, x) => {
          const color = pixelColorWet(map, x, y);
          if (color && WET_STRAND.includes(color) && ch === 'w' && !(WET_WOOL.includes(color))) found.push(`${x},${y}`);
          if (ch !== 'w') expect(WET_STRAND.includes(color ?? '') && ch !== 'w' && color !== SPRITE_COLORS[ch]).toBe(false);
        });
      });
      for (const [x, y] of STRANDS) {
        const wool = at(pose, x, y) === 'w';
        const c = pixelColorWet(map, x, y);
        if (wool) expect(c, `${pose} ${x},${y}`).toBe(WET_STRAND[y < map.length * 0.45 ? 0 : y < map.length * 0.75 ? 1 : 2]);
        else expect(c === null || c === SPRITE_COLORS[at(pose, x, y)], `${pose} ${x},${y} is not wool`).toBe(true);
      }
    }
  });

  it('the idle pose in the wet colours is the picture of the vote: the first rows and a strand', () => {
    const colorRow = (y: number) => [...SPRITES.idle[y]].map((_, x) => pixelColorWet(SPRITES.idle, x, y));
    // Row 1, column 8 is a strand in the top zone: one step darker than the wet top row.
    expect(colorRow(1)[8]).toBe('#bfb2f0');
    expect(colorRow(1)[7]).toBe('#dcd3fb');
    // Row 8, column 12 is the lowest strand of a twelve row body, in the middle zone.
    expect(colorRow(8)[12]).toBe('#a79bdc');
    expect(colorRow(8)[11]).toBe('#bfb2f0');
    // The lowest zone's strand colour shows on the short sleeping body: row 7, column 6.
    expect(pixelColorWet(SPRITES.sleep, 6, 7)).toBe('#9388cf');
    expect(pixelColorWet(SPRITES.sleep, 7, 7)).toBe('#a79bdc');
  });
});

describe('rows moved sideways', () => {
  const rectsAt = (rows: RowShift) => sheepRects(SPRITES.idle, 'dry', rows);
  const row = (rects: ReturnType<typeof rectsAt>, y: number) => rects.filter((r) => r.y === y).map((r) => r.x);

  it('the four shake frames move the upper five rows one way and the lower five the other, legs still, alternating', () => {
    expect(ROW_DX[1]).toEqual([-1, -1, -1, -1, -1, 1, 1, 1, 1, 1, 0, 0]);
    expect(ROW_DX[2]).toEqual([1, 1, 1, 1, 1, -1, -1, -1, -1, -1, 0, 0]);
    expect(ROW_DX[3]).toEqual(ROW_DX[1]);
    expect(ROW_DX[4]).toEqual(ROW_DX[2]);
    const none = rectsAt(0);
    const f1 = rectsAt(1);
    expect(f1).toHaveLength(none.length);
    for (let y = 0; y < SPRITES.idle.length; y++) {
      const d = ROW_DX[1][y] ?? 0;
      expect(row(f1, y)).toEqual(row(none, y).map((x) => x + d));
    }
    // legs (rows 10 and 11) did not move
    expect(row(f1, 10)).toEqual(row(none, 10));
  });

  it('the lean moves the top two rows one pixel downwind: right when he faces right, left in his own pixels when he faces left', () => {
    const none = rectsAt(0);
    for (const [rows, d] of [[5, 1], [6, -1]] as const) {
      const lean = rectsAt(rows);
      for (let y = 0; y < SPRITES.idle.length; y++) expect(row(lean, y)).toEqual(row(none, y).map((x) => x + (y < 2 ? d : 0)));
    }
  });

  it('is built once for each look: the same list comes back, and wool changes only the colours', () => {
    expect(rectsAt(1)).toBe(rectsAt(1));
    const wet = sheepRects(SPRITES.idle, 'wet', 0);
    const fluffy = sheepRects(SPRITES.idle, 'fluffy', 0);
    const dry = rectsAt(0);
    expect(fluffy).toBe(dry);
    expect(wet.map((r) => [r.x, r.y])).toEqual(dry.map((r) => [r.x, r.y]));
    expect(wet.map((r) => r.c)).not.toEqual(dry.map((r) => r.c));
    expect(sheepRects(BLINKS.idle, 'wet', 0)).not.toBe(wet);
  });

  it('props on the ear move with the ear row, the star and the cape stay', () => {
    // On the idle pose the ear is in row 2: moved by the shake, not by the lean.
    expect(earShift('headphones', 'idle', 1)).toBe(-1);
    expect(earShift('scarf', 'idle', 2)).toBe(1);
    expect(earShift('nightcap', 'idle', 3)).toBe(-1);
    expect(earShift('headphones', 'idle', 5)).toBe(0);
    expect(earShift('headphones', 'idle', 0)).toBe(0);
    for (const rows of [1, 2, 3, 4, 5, 6] as const) {
      expect(earShift('star', 'idle', rows)).toBe(0);
      expect(earShift('cape', 'idle', rows)).toBe(0);
    }
    // On the raised head the ear is in row 0: the lean moves it too.
    expect(earShift('headphones', 'look', 5)).toBe(1);
    expect(earShift('headphones', 'look', 6)).toBe(-1);
  });
});
