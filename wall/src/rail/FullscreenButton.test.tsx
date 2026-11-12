import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

let tauri = true;
let fullscreen = false;
const win = {
  isFullscreen: vi.fn(async () => fullscreen),
  setFullscreen: vi.fn(async (v: boolean) => {
    fullscreen = v;
  }),
  outerPosition: vi.fn(async () => ({ x: 0, y: 0 })),
  outerSize: vi.fn(async () => ({ width: 2560, height: 720 })),
  setPosition: vi.fn(async () => {}),
  setSize: vi.fn(async () => {}),
  onResized: vi.fn(async () => () => {}),
};
vi.mock('../bridge/tauri', () => ({ isTauri: () => tauri }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => win }));

import { Rail } from './Rail';
import { installFullscreenKeys, resetFullscreenForTests } from '../ui/fullscreen';

beforeEach(() => {
  tauri = true;
  fullscreen = false;
  resetFullscreenForTests();
  vi.clearAllMocks();
});

it('sits just above Tools and toggles, with the label following the state', async () => {
  render(<Rail />);
  const enter = await screen.findByRole('button', { name: 'Enter fullscreen' });
  const buttons = screen.getAllByRole('button');
  expect(buttons[buttons.indexOf(enter) + 1].getAttribute('aria-label')).toBe('Tools');
  await act(async () => {
    fireEvent.click(enter);
  });
  expect(win.setFullscreen).toHaveBeenCalledWith(true);
  // No resize event fired: the label follows the toggle itself.
  expect(screen.getByRole('button', { name: 'Exit fullscreen' })).toBeTruthy();
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Exit fullscreen' }));
  });
  expect(screen.getByRole('button', { name: 'Enter fullscreen' })).toBeTruthy();
});

it('label follows a change made elsewhere (Esc or F11)', async () => {
  const remove = installFullscreenKeys();
  render(<Rail />);
  await screen.findByRole('button', { name: 'Enter fullscreen' });
  fullscreen = true;
  await act(async () => {
    window.dispatchEvent(new Event('focus'));
    await Promise.resolve();
  });
  expect(screen.getByRole('button', { name: 'Exit fullscreen' })).toBeTruthy();
  remove();
});

it('arrow keys from the fullscreen button are not swallowed', async () => {
  render(<Rail />);
  const b = await screen.findByRole('button', { name: 'Enter fullscreen' });
  b.focus();
  const e = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true });
  b.dispatchEvent(e);
  expect(e.defaultPrevented).toBe(false);
});

it('is hidden outside Tauri', () => {
  tauri = false;
  render(<Rail />);
  expect(screen.queryByRole('button', { name: /fullscreen/ })).toBeNull();
});
