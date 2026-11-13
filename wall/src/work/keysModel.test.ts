import { describe, expect, it } from 'vitest';
import { CAMERAS } from '../horizon/cameras';
import { ridgeTopY } from '../horizon/ridge';
import { rowEdges, zoneEdges, ZONES } from '../screens/frameLayout';
import { acceptsFront, AUTO, DECK_CLEARANCE, deckFloorY, keyChunks, keyLabel, autoPage, effectiveMode, FOR_YOU, headingFor, MODE_KEY, pagesFor, parseMode, shownSet, stepPage, stepSet, sendReason, type KeysSummary, type SetInfo } from './keysModel';

const general: SetInfo = { id: 'general', name: 'General', general: true, keys: [{ label: 'Snip', icon: 'screenshot', action: null }] };
const sales: SetInfo = { id: 'sales', name: 'Sales app', general: false, keys: [{ label: 'Refresh', icon: 'refresh', action: null }] };
const other: SetInfo = { id: 'other', name: 'Other', general: false, keys: [{ label: 'Go', icon: 'play', action: null }] };
const summary = (autoId: string | null, front: 'app' | 'idle' = 'app'): KeysSummary => ({ front, autoId, exe: null, sets: [general, sales, other], source: 'file', defaultPins: [], filePins: [] });

describe('mode storage', () => {
  it('reads a valid held mode', () => {
    expect(parseMode(JSON.stringify({ hold: true, setId: 'sales' }))).toEqual({ hold: true, setId: 'sales' });
  });
  it('reads anything odd as Auto', () => {
    for (const raw of [null, '', 'x', '{', 'null', '[]', '1', '"hold"', '{}', '{"hold":true}', '{"hold":"yes","setId":"a"}', '{"hold":true,"setId":5}', '{"hold":true,"setId":"A B"}', '{"hold":true,"setId":""}', `{"hold":true,"setId":"${'a'.repeat(25)}"}`, '{"hold":false,"setId":"sales"}']) {
      expect(parseMode(raw), String(raw)).toEqual(AUTO);
    }
  });
  it('uses one fixed storage key', () => {
    expect(MODE_KEY).toBe('wall2-keys-mode');
  });
  it('drops a held set that is no longer in keys.json', () => {
    expect(effectiveMode({ hold: true, setId: 'gone' }, [general, sales])).toEqual(AUTO);
    expect(effectiveMode({ hold: true, setId: 'sales' }, [general, sales])).toEqual({ hold: true, setId: 'sales' });
  });
});

describe('which set shows', () => {
  it('Auto shows the app in front own set, else the general one, else none', () => {
    expect(shownSet(summary('sales'), AUTO)?.id).toBe('sales');
    expect(shownSet(summary('general'), AUTO)?.id).toBe('general');
    expect(shownSet(summary(null), AUTO)).toBeNull();
  });
  it('Auto follows a change of app', () => {
    expect(shownSet(summary('sales'), AUTO)?.id).toBe('sales');
    expect(shownSet(summary('other'), AUTO)?.id).toBe('other');
    expect(shownSet(summary('general'), AUTO)?.id).toBe('general');
  });
  it('Hold survives a change of app', () => {
    const held = { hold: true, setId: 'sales' };
    for (const auto of ['sales', 'other', 'general', null]) expect(shownSet(summary(auto), held)?.id).toBe('sales');
  });
  it('steps through the sets and wraps', () => {
    expect(stepSet(summary('sales'), sales, 1)?.id).toBe('other');
    expect(stepSet(summary('sales'), other, 1)?.id).toBe('general');
    expect(stepSet(summary('sales'), general, -1)?.id).toBe('other');
    expect(stepSet(summary(null), null, 1)?.id).toBe('general');
    expect(stepSet(summary(null), null, -1)?.id).toBe('other');
    expect(stepSet({ ...summary(null), sets: [] }, null, 1)).toBeNull();
  });
});

describe('the set own rule', () => {
  it('a specific set accepts only its own app; the general set any app', () => {
    expect(acceptsFront(summary('sales'), sales)).toBe(true);
    expect(acceptsFront(summary('other'), sales)).toBe(false);
    expect(acceptsFront(summary('general'), sales)).toBe(false);
    expect(acceptsFront(summary('other'), general)).toBe(true);
    expect(acceptsFront(summary('general'), general)).toBe(true);
  });
  it('nothing in front accepts nothing', () => {
    expect(acceptsFront(summary(null, 'idle'), general)).toBe(false);
  });
});

describe('words', () => {
  it('headings', () => {
    expect(headingFor(sales)).toBe('Keys for Sales app');
    expect(headingFor(general)).toBe('Keys: General');
  });
  it('a held set in the wrong app says so, in fixed words', () => {
    expect(sendReason('no app', sales, true)).toBe('Wrong app in front for Sales app');
    expect(sendReason('no app', sales, false)).toBe('Sales app is not in front any more');
  });
  it('every refusal word has its own line', () => {
    const lines = ['busy', 'no key', 'no app', 'gone', 'elevated', 'not forward', 'failed', 'whatever'].map((w) => sendReason(w, sales, false));
    expect(new Set(lines).size).toBe(lines.length);
    expect(sendReason('not forward', sales, false)).toBe('Could not bring Sales app forward');
  });
});

describe('pages of the Now row', () => {
  const sum = (autoId: string | null): KeysSummary => ({ front: 'app', autoId, exe: null, sets: [other, general, sales], source: 'file', defaultPins: [], filePins: [] });

  it('puts For you first only while something waits, then the app in front, then the general set, then the rest', () => {
    expect(pagesFor(sum('sales'), false).map((p) => p.id)).toEqual(['sales', 'general', 'other']);
    expect(pagesFor(sum('sales'), true).map((p) => p.id)).toEqual(['foryou', 'sales', 'general', 'other']);
    // With the general set in front it is not listed twice; with no app set the general one leads.
    expect(pagesFor(sum('general'), false).map((p) => p.id)).toEqual(['general', 'other', 'sales']);
    expect(pagesFor(sum(null), false).map((p) => p.id)).toEqual(['general', 'other', 'sales']);
  });

  it('steps with wrapping from any page, and from none', () => {
    const pages = pagesFor(sum('sales'), true);
    expect(stepPage(pages, 'foryou', -1)?.id).toBe('other');
    expect(stepPage(pages, 'other', 1)?.id).toBe('foryou');
    expect(stepPage(pages, null, 1)?.id).toBe('foryou');
    expect(stepPage(pages, null, -1)?.id).toBe('other');
    expect(stepPage(pages, 'gone', 1)?.id).toBe('foryou');
    expect(stepPage([], null, 1)).toBeNull();
  });

  it('Auto shows the set for the app in front, else the general one, else nothing', () => {
    expect(autoPage(sum('sales'))).toMatchObject({ id: 'sales', kind: 'set' });
    expect(autoPage(sum(null))).toBeNull();
  });

  it('a held For you page is kept only while something waits', () => {
    const held = { hold: true, setId: FOR_YOU };
    expect(effectiveMode(held, [general], true)).toEqual(held);
    expect(effectiveMode(held, [general], false)).toEqual(AUTO);
    expect(parseMode(JSON.stringify(held))).toEqual(held);
  });
});

describe('the deck', () => {
  it('drops a group prefix the page name already says, and keeps every other label', () => {
    expect(keyLabel('VS Code: command palette', 'VS Code')).toBe('Command palette');
    expect(keyLabel('Excel: repeat last action', 'excel')).toBe('Repeat last action');
    expect(keyLabel('Power BI - refresh', 'Power BI')).toBe('Refresh');
    expect(keyLabel('Sonos: pause everything', 'Sound and music')).toBe('Sonos: pause everything');
    expect(keyLabel('VS Code:', 'VS Code')).toBe('VS Code:');
    expect(keyLabel('Snip', '')).toBe('Snip');
  });
  it('splits a long set into parts of five', () => {
    expect(keyChunks([1, 2, 3, 4, 5, 6, 7, 8]).map((c) => c.length)).toEqual([5, 3]);
    expect(keyChunks([1, 2, 3])).toEqual([[1, 2, 3]]);
    expect(keyChunks([])).toEqual([[]]);
  });
  it('puts the floor a clearance above the mountain ridge under the right wing, inside the top band', () => {
    const wing = zoneEdges(ZONES)[2];
    const ridge = ridgeTopY(CAMERAS.work, wing.left, wing.right);
    expect(deckFloorY()).toBe(Math.floor(ridge - DECK_CLEARANCE));
    // The ridge stands above the horizon line, and the floor sits inside the stage's top band.
    expect(ridge).toBeLessThan(CAMERAS.work.hy);
    expect(deckFloorY()).toBeLessThanOrEqual(rowEdges()[0].bottom);
  });
  it('reads the ridge higher where the mountains are taller', () => {
    expect(ridgeTopY(CAMERAS.work, 1944, 1960)).toBeLessThan(ridgeTopY(CAMERAS.work, 2500, 2540));
  });
});
