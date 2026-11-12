import { afterEach, beforeEach, expect, it, vi } from 'vitest';

let tauri = true;
let fullscreen = false;
let gate: Promise<void> | null = null;
let resized: (() => void) | null = null;
const log: string[] = [];
const POS = { x: 100, y: 5 };
const SIZE = { width: 2560, height: 720 };
const win = {
  isFullscreen: vi.fn(async () => fullscreen),
  outerPosition: vi.fn(async () => POS),
  outerSize: vi.fn(async () => SIZE),
  setFullscreen: vi.fn(async (v: boolean) => {
    if (gate) await gate;
    fullscreen = v;
    log.push(`fs:${v}`);
  }),
  setPosition: vi.fn(async (p: { x: number; y: number }) => void log.push(`pos:${p.x},${p.y}`)),
  setSize: vi.fn(async (s: { width: number; height: number }) => void log.push(`size:${s.width}x${s.height}`)),
  onResized: vi.fn(async (cb: () => void) => {
    resized = cb;
    return () => {};
  }),
};

vi.mock('../bridge/tauri', () => ({ isTauri: () => tauri }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => win }));

import { installFullscreenKeys, resetFullscreenForTests, toggleFullscreen } from './fullscreen';

let remove = () => {};
const press = (init: KeyboardEventInit) => {
  const e = new KeyboardEvent('keydown', { cancelable: true, ...init });
  window.dispatchEvent(e);
  return e;
};
const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  tauri = true;
  fullscreen = false;
  gate = null;
  resized = null;
  log.length = 0;
  resetFullscreenForTests();
  vi.clearAllMocks();
});
afterEach(() => remove());

it('F11 enters fullscreen and prevents the default', async () => {
  remove = installFullscreenKeys();
  const e = press({ key: 'F11' });
  await settle();
  expect(e.defaultPrevented).toBe(true);
  expect(log).toEqual(['fs:true']);
});

it('Ctrl+F11 toggles too', async () => {
  remove = installFullscreenKeys();
  press({ key: 'F11', ctrlKey: true });
  await settle();
  expect(log).toEqual(['fs:true']);
});

it('leaving restores the position and size saved before entering', async () => {
  remove = installFullscreenKeys();
  press({ key: 'F11' });
  await settle();
  // The window moves while fullscreen; the restore must still use the saved values.
  win.outerPosition.mockResolvedValue({ x: 0, y: 0 });
  win.outerSize.mockResolvedValue({ width: 3840, height: 2160 });
  press({ key: 'F11' });
  await settle();
  expect(log).toEqual(['fs:true', 'fs:false', 'pos:100,5', 'size:2560x720']);
  win.outerPosition.mockResolvedValue(POS);
  win.outerSize.mockResolvedValue(SIZE);
});

it('Esc exits and prevents the default only when fullscreen', async () => {
  remove = installFullscreenKeys();
  const idle = press({ key: 'Escape' });
  await settle();
  expect(idle.defaultPrevented).toBe(false);
  expect(log).toEqual([]);
  press({ key: 'F11' });
  await settle();
  const e = press({ key: 'Escape' });
  await settle();
  expect(e.defaultPrevented).toBe(true);
  expect(log.slice(1, 2)).toEqual(['fs:false']);
});

it('ignores key repeats', async () => {
  remove = installFullscreenKeys();
  press({ key: 'F11', repeat: true });
  await settle();
  expect(win.setFullscreen).not.toHaveBeenCalled();
});

it('does nothing outside Tauri', async () => {
  tauri = false;
  remove = installFullscreenKeys();
  const e = press({ key: 'F11' });
  await settle();
  expect(e.defaultPrevented).toBe(false);
  expect(win.setFullscreen).not.toHaveBeenCalled();
});

it('overlapping toggles run one at a time and never restore into fullscreen', async () => {
  remove = installFullscreenKeys();
  let release!: () => void;
  gate = new Promise<void>((r) => (release = r));
  press({ key: 'F11' });
  press({ key: 'F11' });
  toggleFullscreen().catch(() => {});
  await settle();
  release();
  await settle();
  expect(log).toEqual(['fs:true']);
  expect(win.setFullscreen).toHaveBeenCalledTimes(1);
});

it('reconciles with the real window on resize', async () => {
  remove = installFullscreenKeys();
  await settle();
  fullscreen = true;
  resized?.();
  await settle();
  const e = press({ key: 'Escape' });
  expect(e.defaultPrevented).toBe(true);
});
