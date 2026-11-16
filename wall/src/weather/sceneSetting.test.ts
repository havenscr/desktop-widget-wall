import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SCENE_WEATHER_KEY, readSceneWeather, useSceneWeather } from './sceneSetting';

beforeEach(() => localStorage.clear());
afterEach(() => {
  vi.restoreAllMocks();
  useSceneWeather.setState({ on: true });
});

describe('the scene weather switch', () => {
  it('is on by default and a bad or unreadable value reads as on', () => {
    expect(readSceneWeather(null)).toBe(true);
    for (const bad of ['', 'x', '{', 'null', '1', '"off"', '{"on":"false"}', '{"on":0}', '{}', '[]', '{"on":null}']) expect(readSceneWeather(bad), bad).toBe(true);
    expect(readSceneWeather('{"on":true}')).toBe(true);
    expect(readSceneWeather('{"on":false}')).toBe(false);
  });

  it('stores {"on":false} and {"on":true} when set', () => {
    useSceneWeather.getState().setOn(false);
    expect(localStorage.getItem(SCENE_WEATHER_KEY)).toBe('{"on":false}');
    expect(useSceneWeather.getState().on).toBe(false);
    useSceneWeather.getState().setOn(true);
    expect(localStorage.getItem(SCENE_WEATHER_KEY)).toBe('{"on":true}');
    expect(useSceneWeather.getState().on).toBe(true);
  });

  it('keeps the session value when the write fails', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('full');
    });
    useSceneWeather.getState().setOn(false);
    expect(useSceneWeather.getState().on).toBe(false);
  });
});
