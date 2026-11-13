import { act, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { App } from '../App';
import { mocks } from '../bridge/tauri';
import { registerSignalMocks } from '../bridge/devMocks/signals';

vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock('../audio/capture', () => ({ startAudio: () => () => {} }));
vi.mock('../music/store', () => ({ acquireNowPlaying: () => () => {} }));
vi.mock('../horizon/HorizonCanvas', () => ({ HorizonCanvas: () => null }));
vi.mock('../buddy/Watt', () => ({ Watt: () => null }));
vi.mock('../rail/Rail', () => ({ Rail: () => null }));
vi.mock('../stage/Stage', () => ({ Stage: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('../ui/HoverTip', () => ({ HoverTipLayer: () => null }));
vi.mock('../screens/Screens', () => ({ Screens: () => <main>Work Home Unwind Meet</main> }));

afterEach(() => {
  mocks.clear();
  history.replaceState({}, '', '/');
  vi.useRealTimers();
});

async function mountedText(search: string): Promise<string> {
  history.replaceState({}, '', `/${search}`);
  registerSignalMocks();
  const view = render(<App />);
  await act(async () => { await Promise.resolve(); });
  const text = view.container.textContent ?? '';
  view.unmount();
  return text;
}

it('keeps every screen text unchanged with every signal development knob set', async () => {
  vi.useFakeTimers();
  const none = await mountedText('');
  const all = await mountedText('?call=teams&camera=1&rec=1&leave=15');
  expect(all).toBe(none);
  expect(all).toBe('Work Home Unwind Meet');
});

