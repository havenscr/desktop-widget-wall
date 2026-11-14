import { act, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { App } from '../App';
import { resetAgents } from '../agents/useAgents';
import { registerDevMocks } from '../bridge/devMocks';
import { mocks } from '../bridge/tauri';
import { useFocusStore } from '../focus/store';
import { resetNowPlaying } from '../music/store';
import { usePlaceStore, type PlaceId } from '../state/places';
import { resetWeatherStore } from '../weather/useWeather';
import { resetMeetingFeed } from '../work/useNextMeeting';

const places: PlaceId[] = ['work', 'home', 'unwind', 'meet'];
const normalized = (text: string | null) => (text ?? '').replace(/\s+/g, ' ').trim();

const weather = {
  current: { time: '2026-11-12T10:00', temperature_2m: 60, weather_code: 1, is_day: 1 },
  hourly: { time: ['2026-11-12T10:00'], temperature_2m: [60], weather_code: [1] },
  daily: { temperature_2m_max: [65], temperature_2m_min: [50] },
};

afterEach(() => {
  mocks.clear();
  history.replaceState({}, '', '/');
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function mountedText(search: string): Promise<Record<string, string>> {
  history.replaceState({}, '', `/${search}`);
  registerDevMocks();
  usePlaceStore.setState({ active: 'work', from: 'work', zenDream: false });
  const view = render(<App />);
  const text: Record<string, string> = {};
  for (const place of places) {
    await act(async () => {
      usePlaceStore.getState().setActive(place);
      await vi.advanceTimersByTimeAsync(50);
    });
    text[place] = normalized(view.container.textContent);
  }
  view.unmount();
  useFocusStore.getState().dispose();
  resetNowPlaying();
  resetMeetingFeed();
  resetWeatherStore();
  resetAgents();
  mocks.clear();
  return text;
}

it('keeps real Work, Home, Unwind and Meet text unchanged with the call development knobs set (the call has no screen yet)', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 10, 12, 10, 0));
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => weather })));
  const none = await mountedText('?call=none');
  const all = await mountedText('?call=teams&camera=1');
  expect(all).toEqual(none);
});
