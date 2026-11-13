import { describe, expect, it } from 'vitest';
import {
  FOCUS_QUIET_MS,
  FRESH_MS,
  GAP_MS,
  createChat,
  freshEvent,
  markSpoken,
  maySpeak,
  nextBubble,
  pickLine,
  quietNow,
  type Quiet,
  type Talk,
} from './chatter';
import { LINES } from './lines';

const T0 = 1_000_000_000;
const MIN = 60_000;
const calm = (over: Partial<Quiet> = {}): Quiet => ({ chatty: 'sometimes', inCall: false, idle: false, away: false, focusSince: null, ...over });
const talk = (over: Partial<Talk> = {}): Talk => ({ events: {}, context: [], thoughts: ['sheep'], ...over });
/** A steady sequence of fake random numbers. */
const seq = (...v: number[]) => {
  let i = 0;
  return () => v[i++ % v.length];
};

describe('the bubble scheduler', () => {
  it('speaks at most once every six minutes by default, three when chatty, never when off', () => {
    expect(GAP_MS.sometimes).toBe(6 * MIN);
    const st = createChat();
    expect(maySpeak(st, calm(), T0)).toBe(true);
    markSpoken(st, 'Hmm.', T0);
    expect(maySpeak(st, calm(), T0 + 6 * MIN - 1)).toBe(false);
    expect(maySpeak(st, calm(), T0 + 6 * MIN)).toBe(true);
    expect(maySpeak(st, calm({ chatty: 'chatty' }), T0 + 3 * MIN)).toBe(true);
    expect(maySpeak(st, calm({ chatty: 'chatty' }), T0 + 3 * MIN - 1)).toBe(false);
    expect(maySpeak(createChat(), calm({ chatty: 'off' }), T0)).toBe(false);
  });

  it('is quiet in a call, while the display is idle, while away or asleep, and in the first minute of focus', () => {
    const st = createChat();
    expect(maySpeak(st, calm({ inCall: true }), T0)).toBe(false);
    expect(maySpeak(st, calm({ idle: true }), T0)).toBe(false);
    expect(maySpeak(st, calm({ away: true }), T0)).toBe(false);
    expect(maySpeak(st, calm({ focusSince: T0 - FOCUS_QUIET_MS + 1 }), T0)).toBe(false);
    expect(maySpeak(st, calm({ focusSince: T0 - FOCUS_QUIET_MS }), T0)).toBe(true);
    expect(quietNow(calm(), T0)).toBe(false);
  });

  it('over a long day never puts two bubbles closer than the gap, and never during quiet times', () => {
    const st = createChat();
    const said: number[] = [];
    const rnd = seq(0.01, 0.5, 0.9, 0.3);
    for (let t = T0; t < T0 + 8 * 60 * MIN; t += 30_000) {
      const inCall = t > T0 + 120 * MIN && t < T0 + 150 * MIN;
      const r = nextBubble(st, calm({ inCall }), talk({ events: { agentFinished: t - 1000 } }), t, rnd);
      if (r) {
        expect(inCall).toBe(false);
        said.push(t);
      }
    }
    expect(said.length).toBeGreaterThan(10);
    for (let i = 1; i < said.length; i++) expect(said[i] - said[i - 1]).toBeGreaterThanOrEqual(GAP_MS.sometimes);
  });

  it('never says the same line twice in a row', () => {
    const st = createChat();
    let last: string | null = null;
    for (let i = 0; i < 300; i++) {
      const t = T0 + i * GAP_MS.sometimes;
      const r = nextBubble(st, calm(), talk({ thoughts: ['sleepy'] }), t, () => 0);
      if (!r) continue;
      expect(r.line).not.toBe(last);
      last = r.line;
    }
  });

  it('says a fresh event once, and with nothing fresh speaks only now and then', () => {
    const st = createChat();
    const events = { focusDone: T0 };
    const first = nextBubble(st, calm(), talk({ events }), T0 + 1000, () => 0.99);
    expect(first && LINES.focusDone.includes(first.line)).toBe(true);
    // The same event later, with a high roll: nothing.
    expect(nextBubble(st, calm(), talk({ events }), T0 + 1000 + GAP_MS.sometimes, () => 0.99)).toBeNull();
    // A low roll: a line.
    expect(nextBubble(st, calm(), talk(), T0 + 1000 + GAP_MS.sometimes, () => 0.01)).not.toBeNull();
  });
});

describe('the line picker', () => {
  it('a fresh event wins over context and thoughts; the newest event first', () => {
    const t = talk({ events: { agentFinished: T0 - 5000, focusDone: T0 - 1000 }, context: ['rain', 'afternoon'] });
    for (const r of [0, 0.3, 0.6, 0.99]) {
      const p = pickLine(t, T0, null, () => r);
      expect(p.topic).toBe('focusDone');
      expect(LINES.focusDone).toContain(p.line);
    }
  });

  it('an event older than three minutes is not fresh', () => {
    expect(freshEvent(talk({ events: { meetingSoon: T0 - FRESH_MS - 1 } }), T0)).toBeNull();
    expect(freshEvent(talk({ events: { meetingSoon: T0 - FRESH_MS } }), T0)).toBe('meetingSoon');
  });

  it('context wins over plain thoughts when there is context; thoughts otherwise', () => {
    const p = pickLine(talk({ context: ['rain'] }), T0, null, seq(0.1, 0, 0));
    expect(p.topic).toBe('rain');
    let ctx = 0;
    for (let i = 0; i < 300; i++) if (pickLine(talk({ context: ['rain'] }), T0, null).topic === 'rain') ctx++;
    expect(ctx).toBeGreaterThan(150);
    expect(pickLine(talk(), T0, null, () => 0.1).topic).toBe('sheep');
  });

  it('a line from the topic, never the one to avoid', () => {
    const avoid = LINES.rain[0];
    for (let i = 0; i < 50; i++) expect(pickLine(talk({ context: ['rain'] }), T0, avoid, seq(0.1, 0)).line).not.toBe(avoid);
  });
});
