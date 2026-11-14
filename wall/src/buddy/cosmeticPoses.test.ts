import { describe, expect, it } from 'vitest';
import { REACT_S, createMind, createPetFrame, petFrame, type Mind, type ReactKind } from './petFrame';
import { SIT, beginCarry, carryFrame, createCarry, lookRound, moveCarry, releaseCarry, seatNow, stepCarry } from './carry';
import { GROUNDS } from './ground';
import { WALKS, middle } from './model';
import { POSES, type Pose } from './sprites';

/**
 * The star he wears is drawn in every pose he can be in. The frames come from the real code paths, every
 * one of them: the wander and its reactions (`petFrame`), being carried, falling, landing and sitting
 * (`carryFrame`), and the drive-in seat with its signs of life and the look round (`carryFrame` on a watching
 * carry). The poses seen must be exactly `POSES`, so a pose that stopped being reachable (or a new one) fails here.
 */
const walk = WALKS.work;
const HY = 582;
const SIZE = walk.px;
const none = { prop: null, scarf: false, cosmetic: null } as const;

describe('the star in every pose he reaches', () => {
  it('petFrame, carryFrame and the drive-in seat: the star is chosen in every frame and the poses seen are all 21', () => {
    const seen = new Set<Pose>();
    const f = createPetFrame();
    const take = (note: string) => {
      seen.add(f.pose);
      expect(f.cosmetic, `${f.pose} (${note})`).toBe('star');
    };
    const wear = (m: Partial<Mind> = {}) => Object.assign(createMind(), m, { cosmetic: 'star' as const });

    // The wander and its reactions, by day and at night, with and without reduced motion, with music, rain and cold.
    const reacts: (ReactKind | null)[] = [null, 'hop', 'pet', 'look', 'wake', 'eat', 'happy', 'spin', 'sparkle', 'rise'];
    const looks: Partial<Mind>[] = [{}, { focus: true }, { rain: true }, { cold: true }, { sunny: true }, { nap: true }, { lie: true }, { evening: true }, { sleepy: true }, { pointerOn: true, pointerX: 1000, pointerY: 560 }, { firefly: true, fireflyY: 100 }];
    for (const react of reacts)
      for (const over of looks)
        for (const night of [false, true])
          for (const still of [false, true])
            for (const k of [0.05, 0.2, 0.5, 0.8, 0.95]) {
              const m = wear({ ...over, react, reactT: react ? REACT_S[react as keyof typeof REACT_S] * k : 0, lieT: 3 });
              for (const t of [0, 7, 40, 61, 130]) {
                petFrame(walk, 'work', HY, night, t, k > 0.5, still, m, f);
                take(`wander react ${react} ${JSON.stringify(over)}`);
              }
            }
    // The Nap trick's lie down, step by step.
    for (let lieT = 0; lieT < 3; lieT += 0.1) {
      petFrame(walk, 'work', HY, false, 5, false, false, wear({ lie: true, lieT }), f);
      take(`lie down at ${lieT.toFixed(1)}`);
    }

    // Carried, falling, landing, sitting, dizzy, lying, looking round.
    const GROUND = GROUNDS.work;
    for (const lie of [false, true]) {
      const c = createCarry();
      beginCarry(c, 1, 1005, 560, 985, HY, 1, SIZE, 0, true);
      let T = 0;
      const m = wear({ lie });
      for (let i = 0; i < 90; i++) {
        T += 1 / 60;
        moveCarry(c, 900 + i * 7, 200);
        stepCarry(c, 1 / 60, T, HY, SIZE, middle(walk), false, none);
        petFrame(walk, 'work', HY, false, T, false, false, m, f);
        carryFrame(c, T, HY, SIZE, false, m, f);
        take('carried');
      }
      releaseCarry(c, T, GROUND, HY, SIZE, false, false);
      c.shaken = true;
      c.dizzyUntil = T + 3;
      for (let i = 0; i < 60 * 60; i++) {
        T += 1 / 60;
        stepCarry(c, 1 / 60, T, HY, SIZE, 985, false, none);
        petFrame(walk, 'work', HY, false, T, false, false, m, f);
        carryFrame(c, T, HY, SIZE, false, m, f);
        take('after the drop');
      }
    }
    // Reduced motion: held, and seated.
    {
      const c = createCarry();
      beginCarry(c, 1, 1005, 560, 985, HY, 1, SIZE, 0, true);
      petFrame(walk, 'work', HY, false, 1, false, true, wear(), f);
      carryFrame(c, 1, HY, SIZE, true, wear(), f);
      take('held, reduced motion');
    }

    // The drive-in seat: watching, his signs of life (blink, ear, tilt) and the look round once paused.
    for (const dir of [1, -1] as const) {
      const c = createCarry();
      seatNow(c, 0, 900, dir);
      expect(c.mode).toBe(SIT);
      const m = wear();
      for (let T = 0.5; T < 200; T += 0.05) {
        if (Math.abs(T - 100) < 0.03) lookRound(c, T);
        petFrame(walk, 'work', HY, false, T, false, false, m, f);
        carryFrame(c, T, HY, SIZE, false, m, f);
        take('at the drive-in');
      }
    }
    expect([...seen].sort()).toEqual([...POSES].sort());
  });
});
