import { describe, expect, it } from 'vitest';
import { CONTEXT_TOPICS, EVENT_TOPICS, LINES, allLines, type Topic } from './lines';

describe('her lines', () => {
  const all = allLines();
  it('has at least 120, each short, plain and different', () => {
    expect(all.length).toBeGreaterThanOrEqual(120);
    expect(new Set(all).size).toBe(all.length);
    for (const l of all) {
      expect(l.length, l).toBeLessThan(60);
      expect(l.length).toBeGreaterThan(0);
      // Plain printable ASCII: no emojis, no em or en dashes, no curly quotes.
      expect(l, l).toMatch(/^[ -~]+$/);
      expect(l, l).not.toMatch(/--| - /);
      expect(l, l).not.toMatch(/!/);
    }
  });
  it('has lines for every group the brief asks for', () => {
    const want: Topic[] = ['morning', 'midday', 'afternoon', 'evening', 'late', 'rain', 'clear', 'musicPlaying', 'musicPaused', 'musicStreak', 'focusStart', 'focusHalf', 'focusDone', 'agentsWorking', 'agentFinished', 'agentWaiting', 'meetingSoon', 'meetingEnded', 'sheep'];
    for (const t of want) expect(LINES[t].length, t).toBeGreaterThanOrEqual(3);
  });
  it('event and context topics do not overlap', () => {
    for (const t of EVENT_TOPICS) expect(CONTEXT_TOPICS).not.toContain(t);
  });
});
