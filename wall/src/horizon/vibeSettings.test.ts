import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_VIBE, VIBE_KEY, resetVibeStore, useVibeStore, validateVibe, vibeSettings } from './vibeSettings';
import { LINES_KEY, resetLinesStore, useLinesStore } from './linesSettings';

describe('vibe settings', () => {
  beforeEach(() => {
    localStorage.clear();
    resetVibeStore();
  });

  it('defaults: Auto vibe on, the rest off, effects pass over the title', () => {
    expect(DEFAULT_VIBE).toEqual({ auto: true, dropGlitch: false, tapeGrain: false, calmCap: false, cover: 'title', offTabMusic: 'medium' });
    expect(vibeSettings()).toMatchObject(DEFAULT_VIBE);
    expect(VIBE_KEY).toBe('wall2-vibe');
  });

  it('validates every stored field', () => {
    expect(validateVibe({ auto: 'yes', dropGlitch: 1, tapeGrain: null, calmCap: 'no', cover: 'all', offTabMusic: 'loud' })).toEqual(DEFAULT_VIBE);
    expect(validateVibe({ auto: false, dropGlitch: true, tapeGrain: true, calmCap: true, cover: 'scene', offTabMusic: 'full' })).toEqual({
      auto: false, dropGlitch: true, tapeGrain: true, calmCap: true, cover: 'scene', offTabMusic: 'full',
    });
    expect(validateVibe(null)).toEqual(DEFAULT_VIBE);
    expect(validateVibe('scene')).toEqual(DEFAULT_VIBE);
    expect(validateVibe([true, true])).toEqual(DEFAULT_VIBE);
    expect(validateVibe(7)).toEqual(DEFAULT_VIBE);
  });

  it('the frame reads the settings alone, without the store actions', () => {
    expect(Object.keys(vibeSettings()).sort()).toEqual(['auto', 'calmCap', 'cover', 'dropGlitch', 'offTabMusic', 'tapeGrain']);
    useVibeStore.getState().setVibe({ tapeGrain: true });
    expect(vibeSettings().tapeGrain).toBe(true);
    expect(vibeSettings()).toBe(vibeSettings());
  });

  it('a broken or older stored value falls back field by field', () => {
    localStorage.setItem(VIBE_KEY, '{not json');
    resetVibeStore();
    expect(vibeSettings()).toMatchObject(DEFAULT_VIBE);
    localStorage.setItem(VIBE_KEY, JSON.stringify({ tapeGrain: true, sparkle: 3 }));
    resetVibeStore();
    expect(vibeSettings()).toMatchObject({ ...DEFAULT_VIBE, tapeGrain: true });
  });

  it('keeps changes and reset in local storage', () => {
    useVibeStore.getState().setVibe({ cover: 'scene', calmCap: true });
    expect(JSON.parse(localStorage.getItem(VIBE_KEY)!)).toMatchObject({ cover: 'scene', calmCap: true });
    resetVibeStore();
    expect(vibeSettings()).toMatchObject({ cover: 'scene', calmCap: true });
    useVibeStore.getState().reset();
    expect(JSON.parse(localStorage.getItem(VIBE_KEY)!)).toEqual(DEFAULT_VIBE);
  });

  it('is separate from the Lines settings: a Lines reset never touches the vibe', () => {
    useVibeStore.getState().setVibe({ dropGlitch: true });
    useLinesStore.getState().reset();
    resetLinesStore();
    expect(vibeSettings().dropGlitch).toBe(true);
    expect(localStorage.getItem(LINES_KEY) ?? '').not.toContain('dropGlitch');
  });
});
