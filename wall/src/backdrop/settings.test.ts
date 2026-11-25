import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SKY, SKY_KEY, resetSkyStore, skySettings, useBackdropSettings, validateSky } from './settings';

describe('sky setting', () => {
  beforeEach(() => {
    localStorage.clear();
    resetSkyStore();
  });

  it('defaults to Colour wash on Zen only', () => {
    expect(DEFAULT_SKY).toEqual({ style: 'wash', places: ['zen'] });
    expect(skySettings()).toMatchObject(DEFAULT_SKY);
  });

  it('an unknown style falls back to wash and unknown pages are dropped', () => {
    expect(validateSky({ style: 'stars', places: ['work', 'moon', 'zen', 'work'] })).toEqual({ style: 'wash', places: ['zen', 'work'] });
    expect(validateSky({ style: 'aurora', places: ['unwind'] })).toEqual({ style: 'aurora', places: ['unwind'] });
  });

  it('an empty list is valid and means off', () => {
    expect(validateSky({ style: 'wash', places: [] })).toEqual({ style: 'wash', places: [] });
  });

  it('garbage gives the default, so a bad value never turns the sky on somewhere new', () => {
    for (const bad of [null, undefined, 7, 'x', [], { places: 'work' }, { places: { 0: 'work' } }]) expect(validateSky(bad)).toEqual(DEFAULT_SKY);
    localStorage.setItem(SKY_KEY, '{not json');
    resetSkyStore();
    expect(skySettings()).toMatchObject(DEFAULT_SKY);
  });

  it('keeps the style and the pages under wall2-sky and reads them back', () => {
    useBackdropSettings.getState().setStyle('aurora');
    useBackdropSettings.getState().togglePlace('work');
    useBackdropSettings.getState().togglePlace('zen');
    expect(JSON.parse(localStorage.getItem(SKY_KEY)!)).toEqual({ style: 'aurora', places: ['work'] });
    resetSkyStore();
    expect(skySettings()).toMatchObject({ style: 'aurora', places: ['work'] });
  });

  it('a page toggles on and off by itself', () => {
    const { togglePlace } = useBackdropSettings.getState();
    togglePlace('home');
    expect(skySettings().places).toEqual(['zen', 'home']);
    togglePlace('home');
    expect(skySettings().places).toEqual(['zen']);
  });

  it('marking the sky unavailable lasts until the store is reset', () => {
    useBackdropSettings.getState().markUnavailable();
    expect(skySettings().available).toBe(false);
    resetSkyStore();
    expect(skySettings().available).toBe(true);
  });
});
