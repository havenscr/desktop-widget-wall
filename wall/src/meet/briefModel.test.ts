import { describe, expect, it } from 'vitest';
import { BRIEF_BUILDING, BRIEF_CLIENT, BRIEF_EMPTY, BRIEF_MANY, BRIEF_MIXED, BRIEF_NEW_CONTACT } from '../bridge/devMocks/meetBrief';
import { BRIEF_ROWS, FAILED_LINE, FORBIDDEN_LINE, GAVE_UP_LINE, OFF_LINE, ON_AIR_LINE, briefView, shortDate } from './briefModel';

const NOW = Date.parse('2026-11-12T12:00:00Z');

describe('briefView', () => {
  it('a failed re-read with a ready brief keeps the feed and marks it stale', () => {
    const v = briefView(BRIEF_CLIENT, 'failed', NOW);
    expect(v.mode).toBe('feed');
    expect(v.stale).toBe(true);
    expect(v.rows).toHaveLength(3);
    expect(briefView(BRIEF_CLIENT, null, NOW).stale).toBe(false);
  });

  it('building after the give-up is the off line with Retry', () => {
    const v = briefView(BRIEF_BUILDING, null, NOW, { gaveUp: true });
    expect(v).toMatchObject({ mode: 'off', line: GAVE_UP_LINE, retry: true });
  });

  it('on air the empty line carries no name and the strip is blank', () => {
    const v = briefView(BRIEF_EMPTY, null, NOW, { onAir: true });
    expect(v.line).toBe(ON_AIR_LINE);
    expect(v.strip).toEqual({ who: null, company: null, deal: null, label: null });
    expect(briefView(BRIEF_EMPTY, null, NOW).line).toContain('Northwind Outfitters');
  });

  it('feed: strip from the first person, company and first deal; rows keep the helper order', () => {
    const v = briefView(BRIEF_CLIENT, null, NOW);
    expect(v.mode).toBe('feed');
    expect(v.strip).toEqual({ who: 'Priya Calder', company: 'Northwind Outfitters', deal: 'Annual renewal · Proposal sent', label: 'Northwind Outfitters' });
    expect(v.rows.map((r) => r.id)).toEqual(['i1', 'i2', 'i3']);
    expect(v.rows[0]).toMatchObject({ icon: 'mail', sub: 'Priya Calder · Email thread', when: 'Nov 11' });
    expect(v.rows[1].sub).toBe('Marcus Veld · Meeting · Recording');
    expect(v.rows[2].icon).toBe('crm');
    expect(v.more).toBe(0);
  });

  it('caps the rows at 7 and counts the rest', () => {
    const v = briefView(BRIEF_MANY, null, NOW);
    expect(v.rows).toHaveLength(BRIEF_ROWS);
    expect(v.more).toBe(3);
    expect(v.rows.map((r) => r.icon)).toContain('folder');
  });

  it('a mixed or unmatched invite shows the label only, no company or deal', () => {
    const mixed = { ...BRIEF_CLIENT, match: { kind: 'mixed' as const, label: 'Several companies' } };
    expect(briefView(mixed, null, NOW).strip).toEqual({ who: null, company: null, deal: null, label: 'Several companies' });
    expect(briefView({ ...mixed, match: { kind: 'none', label: null } }, null, NOW).strip.company).toBeNull();
  });

  it('empty: a known meeting with no history names the match and the sources not set up', () => {
    const v = briefView(BRIEF_EMPTY, null, NOW);
    expect(v.mode).toBe('empty');
    expect(v.line).toBe('No history yet with Northwind Outfitters');
    expect(v.sourceLines).toEqual(['Teams is not signed in yet']);
    expect(briefView(BRIEF_NEW_CONTACT, null, NOW).line).toBe('No history yet');
    expect(briefView(BRIEF_NEW_CONTACT, null, NOW).sourceLines).toEqual(['Teams is not signed in yet', 'Notes are not set up yet']);
  });

  it('a meeting with no brief at all (state none) is empty with its own line', () => {
    const v = briefView(BRIEF_MIXED, null, NOW);
    expect(v.mode).toBe('empty');
    expect(v.line).toBe('No brief for this meeting');
  });

  it('building', () => {
    expect(briefView(BRIEF_BUILDING, null, NOW)).toMatchObject({ mode: 'building', rows: [] });
  });

  it('errors: off words, forbidden, failed with Retry, gone with no line', () => {
    for (const e of ['not-configured', 'not-set-up', 'invalid-config'] as const) expect(briefView(null, e)).toMatchObject({ mode: 'off', line: OFF_LINE, retry: false });
    expect(briefView(null, 'forbidden')).toMatchObject({ mode: 'error', line: FORBIDDEN_LINE, retry: false });
    expect(briefView(null, 'failed')).toMatchObject({ mode: 'error', line: FAILED_LINE, retry: true });
    expect(briefView(null, 'gone')).toMatchObject({ mode: 'off', line: null });
  });

  it('nothing read yet leaves the island as it is', () => {
    expect(briefView(null, null)).toMatchObject({ mode: 'off', line: null, rows: [] });
  });

  it('shortDate: month and day, year only when not this year, empty on junk', () => {
    expect(shortDate('2026-09-18T15:00:00Z', NOW)).toBe('Sep 18');
    expect(shortDate('2025-09-18T15:00:00Z', NOW)).toBe('Sep 18, 2025');
    expect(shortDate(null, NOW)).toBe('');
    expect(shortDate('soon', NOW)).toBe('');
  });
});
