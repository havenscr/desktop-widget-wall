import { describe, expect, it } from 'vitest';
import { allWords, askGate, capTurns, checkHealth, cleanQuestion, ERROR_WORDS, errorWord, MAX_Q, SOURCE_LINE, statusWord } from './askModel';

const ready = { state: 'ready', name: 'Sonnet' } as const;

describe('askModel', () => {
  it('every status and error word is at most three words', () => {
    for (const w of allWords()) expect(w.split(/\s+/).length, w).toBeLessThanOrEqual(3);
    expect(SOURCE_LINE).toBe('Claude · brief only · can be wrong');
  });

  it('the field is on only for a ready brief, not On Air, and an ask that is not off', () => {
    expect(askGate({ briefReady: true, onAir: false, health: ready })).toEqual({ enabled: true, reason: null });
    expect(askGate({ briefReady: true, onAir: false, health: { state: 'busy', name: 'Sonnet' } }).enabled).toBe(true);
    expect(askGate({ briefReady: true, onAir: false, health: { state: 'failing', name: 'Claude' } }).enabled).toBe(true);
    expect(askGate({ briefReady: false, onAir: false, health: ready })).toEqual({ enabled: false, reason: 'Brief not ready' });
    expect(askGate({ briefReady: true, onAir: true, health: ready })).toEqual({ enabled: false, reason: 'Hidden on air' });
    expect(askGate({ briefReady: true, onAir: false, health: { state: 'off', name: 'Claude' } })).toEqual({ enabled: false, reason: 'Ask off' });
    expect(askGate({ briefReady: true, onAir: false, health: null })).toEqual({ enabled: false, reason: 'Ask off' });
  });

  it('status words', () => {
    expect(statusWord(ready)).toBe('Sonnet ready');
    expect(statusWord({ state: 'busy', name: 'Opus' })).toBe('Opus busy');
    expect(statusWord({ state: 'ready', name: 'Claude' })).toBe('Claude ready');
    expect(statusWord({ state: 'off', name: 'Claude' })).toBe('Ask off');
    expect(statusWord({ state: 'failing', name: 'Sonnet' })).toBe('Ask failing');
    expect(statusWord(null)).toBeNull();
  });

  it('health is checked against the fixed lists', () => {
    expect(checkHealth({ ask: { state: 'ready', name: 'Opus' } })).toEqual({ state: 'ready', name: 'Opus' });
    expect(checkHealth({ ask: { state: 'ready', name: 'qwen3 30B' } })).toEqual({ state: 'ready', name: 'Claude' });
    expect(checkHealth({ ask: { state: 'hacked', name: 'Sonnet' } })).toBeNull();
    expect(checkHealth({})).toBeNull();
    expect(checkHealth(null)).toBeNull();
  });

  it('error words', () => {
    expect(ERROR_WORDS['not-ready']).toBe('Brief not ready');
    expect(errorWord('busy')).toBe('Busy, try again');
    expect(errorWord('limit')).toBe('Hourly limit');
    expect(errorWord('day-limit')).toBe('Day limit');
    expect(errorWord('model-off')).toBe('Claude unreachable');
    expect(errorWord('refused')).toBe('Claude declined');
    expect(errorWord('limit-store')).toBe('Limit check failed');
    expect(errorWord('anything else')).toBe('Ask failed');
    expect(errorWord(new Error('secret text'))).toBe('Ask failed');
    expect(errorWord('toString')).toBe('Ask failed');
  });

  it('the question is cleaned and capped, and the turns are the last three', () => {
    expect(cleanQuestion('  hello\u0007 there \n')).toBe('hello there');
    expect(cleanQuestion('   ')).toBeNull();
    expect(cleanQuestion('x'.repeat(400))).toHaveLength(MAX_Q);
    const t = [1, 2, 3, 4, 5].map((i) => ({ q: `q${i}`, a: `a${i}` }));
    expect(capTurns(t).map((x) => x.q)).toEqual(['q3', 'q4', 'q5']);
  });
});
