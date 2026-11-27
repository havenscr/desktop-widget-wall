import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_VIBE, VIBE_KEY, resetVibeStore, useVibeStore, validateVibe, vibeSettings } from './vibeSettings';
import { LINES_KEY, resetLinesStore, useLinesStore } from './linesSettings';

describe('vibe settings', () => {
  beforeEach(() => {
    localStorage.clear();
    resetVibeStore();
  });

  it('defaults: Auto vibe on, the rest off', () => {
    expect(DEFAULT_VIBE).toEqual({ auto: true, dropGlitch: false, tapeGrain: false, calmCap: false, aurora: 'full', offTabMusic: 'medium' });
    expect(vibeSettings()).toMatchObject(DEFAULT_VIBE);
    expect(VIBE_KEY).toBe('wall2-vibe');
  });

  it('validates every stored field', () => {
    expect(validateVibe({ auto: 'yes', dropGlitch: 1, tapeGrain: null, calmCap: 'no', aurora: 'bright', offTabMusic: 'loud' })).toEqual(DEFAULT_VIBE);
    expect(validateVibe({ auto: false, dropGlitch: true, tapeGrain: true, calmCap: true, aurora: 'soft', offTabMusic: 'full' })).toEqual({
      auto: false, dropGlitch: true, tapeGrain: true, calmCap: true, aurora: 'soft', offTabMusic: 'full',
    });
    expect(validateVibe(null)).toEqual(DEFAULT_VIBE);
    expect(validateVibe('scene')).toEqual(DEFAULT_VIBE);
    expect(validateVibe([true, true])).toEqual(DEFAULT_VIBE);
    expect(validateVibe(7)).toEqual(DEFAULT_VIBE);
  });

  it('the frame reads the settings alone, without the store actions', () => {
    expect(Object.keys(vibeSettings()).sort()).toEqual(['aurora', 'auto', 'calmCap', 'dropGlitch', 'offTabMusic', 'tapeGrain']);
    useVibeStore.getState().setVibe({ tapeGrain: true });
    expect(vibeSettings().tapeGrain).toBe(true);
    expect(vibeSettings()).toBe(vibeSettings());
  });

  it('the aurora level defaults to Full, keeps Off and Soft, and Reset vibe restores Full', () => {
    expect(vibeSettings().aurora).toBe('full');
    useVibeStore.getState().setVibe({ aurora: 'off' });
    expect(JSON.parse(localStorage.getItem(VIBE_KEY)!)).toMatchObject({ aurora: 'off' });
    useVibeStore.getState().setVibe({ aurora: 'soft' });
    resetVibeStore();
    expect(vibeSettings().aurora).toBe('soft');
    useVibeStore.getState().setVibe({ aurora: 'loud' as never });
    expect(vibeSettings().aurora).toBe('full');
    useVibeStore.getState().setVibe({ aurora: 'off' });
    useVibeStore.getState().reset();
    expect(vibeSettings().aurora).toBe('full');
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
    useVibeStore.getState().setVibe({ aurora: 'soft', calmCap: true });
    expect(JSON.parse(localStorage.getItem(VIBE_KEY)!)).toMatchObject({ aurora: 'soft', calmCap: true });
    resetVibeStore();
    expect(vibeSettings()).toMatchObject({ aurora: 'soft', calmCap: true });
    useVibeStore.getState().reset();
    expect(JSON.parse(localStorage.getItem(VIBE_KEY)!)).toEqual(DEFAULT_VIBE);
  });

  it('loads settings saved with the old Cover row, ignores it, and drops it on the next save', () => {
    localStorage.setItem(VIBE_KEY, JSON.stringify({ tapeGrain: true, cover: 'scene' }));
    resetVibeStore();
    expect(vibeSettings()).toMatchObject({ ...DEFAULT_VIBE, tapeGrain: true });
    expect('cover' in vibeSettings()).toBe(false);
    useVibeStore.getState().setVibe({ calmCap: true });
    expect('cover' in JSON.parse(localStorage.getItem(VIBE_KEY)!)).toBe(false);
  });

  it('is separate from the Lines settings: a Lines reset never touches the vibe', () => {
    useVibeStore.getState().setVibe({ dropGlitch: true });
    useLinesStore.getState().reset();
    resetLinesStore();
    expect(vibeSettings().dropGlitch).toBe(true);
    expect(localStorage.getItem(LINES_KEY) ?? '').not.toContain('dropGlitch');
  });
});
