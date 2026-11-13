import { act, fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

vi.mock('../unwind/watch/looks', async (orig) => {
  const real = await orig<typeof import('../unwind/watch/looks')>();
  return {
    ...real,
    LOOKS: [
      { id: 'feather', name: 'Feathered', hint: 'one' },
      { id: 'drivein', name: 'Drive-in', hint: 'two' },
      { id: 'sky', name: 'Whole sky', hint: 'three' },
      { id: 'sun', name: 'The sun', hint: 'four' },
    ],
  };
});

import { mocks } from '../bridge/tauri';
import { DEFAULT_LOOKS } from '../unwind/watch/looks';
import { useWatchStore } from '../unwind/watch/store';
import { ToolsDrawer } from './ToolsDrawer';
import { useToolsStore } from './store';

it('the video look chips follow whatever list the Watch looks hold (four here)', () => {
  mocks.set('wall2_keys_summary', () => Promise.reject('failed'));
  mocks.set('wall2_meet_next', () => ({ accounts: [], meetings: [] }));
  mocks.set('wall2_spotify_status', () => ({ setup: false, signedIn: false }));
  useWatchStore.setState({ looks: { ...DEFAULT_LOOKS } });
  render(<ToolsDrawer />);
  act(() => useToolsStore.getState().openDrawer());
  const names = ['Feathered', 'Drive-in', 'Whole sky', 'The sun'];
  for (const n of names) expect(screen.getByRole('button', { name: n })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'The sun' }));
  expect(useWatchStore.getState().looks).toMatchObject({ mode: 'one', all: 'sun' });
  expect(screen.getByRole('button', { name: 'The sun' }).getAttribute('aria-pressed')).toBe('true');
  mocks.clear();
});
