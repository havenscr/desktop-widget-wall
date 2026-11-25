import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SKY, SKY_KEY, resetSkyStore, skySettings, useBackdropSettings, validateSky } from './settings';

describe('sky setting', () => {
  beforeEach(() => {
    localStorage.clear();
    resetSkyStore();
  });

  it('defaults to Colour wash on Zen only', () => {
    expect(DEFAULT_SKY).toEqual({ style: 'wash', places: ['zen'], strength: 0.35 });
    expect(skySettings()).toMatchObject(DEFAULT_SKY);
  });

  it('an unknown style falls back to wash and unknown pages are dropped', () => {
    expect(validateSky({ style: 'stars', places: ['work', 'moon', 'zen', 'work'] })).toEqual({ style: 'wash', places: ['zen', 'work'], strength: 0.35 });
    expect(validateSky({ style: 'aurora', places: ['unwind'] })).toEqual({ style: 'aurora', places: ['unwind'], strength: 0.35 });
  });

  it('an empty list is valid and means off', () => {
    expect(validateSky({ style: 'wash', places: [] })).toEqual({ style: 'wash', places: [], strength: 0.35 });
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
    expect(JSON.parse(localStorage.getItem(SKY_KEY)!)).toEqual({ style: 'aurora', places: ['work'], strength: 0.35 });
    resetSkyStore();
    expect(skySettings()).toMatchObject({ style: 'aurora', places: ['work'] });
  });

  it('the strength is kept under wall2-sky, clamped to 10 to 100 percent, and falls back to the default', () => {
    useBackdropSettings.getState().setStrength(0.8);
    expect(JSON.parse(localStorage.getItem(SKY_KEY)!).strength).toBe(0.8);
    resetSkyStore();
    expect(skySettings().strength).toBe(0.8);
    useBackdropSettings.getState().setStrength(5);
    expect(skySettings().strength).toBe(1);
    useBackdropSettings.getState().setStrength(-1);
    expect(skySettings().strength).toBe(0.1);
    for (const bad of ['high', null, NaN, Infinity, {}]) expect(validateSky({ style: 'wash', places: ['zen'], strength: bad }).strength).toBe(DEFAULT_SKY.strength);
    localStorage.setItem(SKY_KEY, JSON.stringify({ style: 'wash', places: ['work'] }));
    resetSkyStore();
    expect(skySettings().strength).toBe(DEFAULT_SKY.strength);
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
