import { describe, expect, it } from 'vitest';
import { acceptsFront, AUTO, effectiveMode, headingFor, MODE_KEY, parseMode, shownSet, stepSet, sendReason, type KeysSummary, type SetInfo } from './keysModel';

const general: SetInfo = { id: 'general', name: 'General', general: true, keys: [{ label: 'Snip', icon: 'screenshot' }] };
const sales: SetInfo = { id: 'sales', name: 'Sales app', general: false, keys: [{ label: 'Refresh', icon: 'refresh' }] };
const other: SetInfo = { id: 'other', name: 'Other', general: false, keys: [{ label: 'Go', icon: 'play' }] };
const summary = (autoId: string | null, front: 'app' | 'idle' = 'app'): KeysSummary => ({ front, autoId, exe: null, sets: [general, sales, other], source: 'file' });

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
    expect(sendReason('no app', sales, true)).toBe('The app in front is not Sales app');
    expect(sendReason('no app', sales, false)).toBe('Sales app is not the app in front any more');
  });
  it('every refusal word has its own line', () => {
    const lines = ['busy', 'no key', 'no app', 'gone', 'elevated', 'not forward', 'failed', 'whatever'].map((w) => sendReason(w, sales, false));
    expect(new Set(lines).size).toBe(lines.length);
    expect(sendReason('not forward', sales, false)).toBe('Could not bring Sales app forward');
  });
});
