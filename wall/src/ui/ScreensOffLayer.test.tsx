// @ts-ignore node's own file calls; this test reads the app's source and stylesheets as text.
import { readFileSync } from 'node:fs';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const handlers = new Map<string, (e: { payload: unknown }) => void>();
const calls: string[] = [];
let modeNow = false;

vi.mock('../bridge/tauri', () => ({
  isTauri: () => true,
  invoke: vi.fn(async (cmd: string) => {
    calls.push(cmd);
    if (cmd === 'wall2_monitors_mode') return { active: modeNow };
    return undefined;
  }),
}));
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (name: string, cb: (e: { payload: unknown }) => void) => {
    handlers.set(name, cb);
    return () => handlers.delete(name);
  }),
}));

import { useBehindDrawer } from '../ribbon/DrawerScrim';
import { usePlaceStore, type PlaceId } from '../state/places';
import { useToolsStore } from '../tools/store';
import { runWallAction } from '../work/wallActions';
import { Dream } from '../zen/Dream';
import { ScreensOffLayer } from './ScreensOffLayer';

const flush = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};
const emit = async (payload: unknown) => {
  await act(async () => {
    handlers.get('monitors-off-mode')?.({ payload });
  });
};
const zenCss = readFileSync('src/styles/zen.css', 'utf8');
const soCss = readFileSync('src/styles/screens-off.css', 'utf8');
// A Record, so a place added to the store without a row here fails the type check. Dream is Zen dimmed.
const TABLE: Record<PlaceId, true> = { work: true, home: true, meet: true, onair: true, unwind: true, zen: true };
const ALL = Object.keys(TABLE) as PlaceId[];

beforeEach(() => {
  vi.useFakeTimers();
  handlers.clear();
  calls.length = 0;
  modeNow = false;
  usePlaceStore.setState({ active: 'work' });
  useToolsStore.setState({ open: false });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it('the app mounts it once, and no place mounts a copy', () => {
  const src = (f: string): string => readFileSync(`src/${f}`, 'utf8');
  expect(src('App.tsx').match(/<ScreensOffLayer \/>/g)).toHaveLength(1);
  for (const f of ['screens/Unwind.tsx', 'screens/Work.tsx', 'screens/Home.tsx', 'zen/Zen.tsx', 'zen/Dream.tsx', 'meet/Meet.tsx', 'onair/OnAir.tsx']) expect(src(f)).not.toMatch(/ScreensOff/);
  // Behind the shell and below the drawers' own layers in the tree, above the places.
  const app = src('App.tsx');
  expect(app.indexOf('<ScreensOffLayer />')).toBeGreaterThan(app.indexOf('<Screens />'));
});

it.each(ALL)('is mounted once, as one button in the tab order, on %s', async (place) => {
  usePlaceStore.setState({ active: place });
  const { container } = render(<ScreensOffLayer />);
  await flush();
  expect(container.querySelectorAll('.so-layer')).toHaveLength(1);
  const buttons = screen.getAllByRole('button', { name: 'Hide screen' });
  expect(buttons).toHaveLength(1);
  expect(buttons[0].tabIndex).toBe(0);
  expect(buttons[0].closest('.so-layer')?.getAttribute('data-place')).toBe(place);
  expect(container.querySelector('.so-layer')?.hasAttribute('inert')).toBe(false);
});

it('follows the place store without a second copy', async () => {
  const { container } = render(<ScreensOffLayer />);
  await flush();
  for (const place of ALL) {
    act(() => usePlaceStore.setState({ active: place }));
    expect(container.querySelectorAll('.screens-off')).toHaveLength(1);
    expect(container.querySelector('.so-layer')?.getAttribute('data-place')).toBe(place);
  }
});

it('keeps one box: 36 px at stage 2504, 664 for every place, above them and below the drawers; Zen rides above its own layer', () => {
  const rule = (css: string, sel: string) => css.match(new RegExp(`${sel.replace(/[[\]'.]/g, '\\$&')}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
  const base = rule(soCss, '.so-layer');
  expect(base).toMatch(/left:\s*2504px/);
  expect(base).toMatch(/top:\s*664px/);
  expect(base).toMatch(/width:\s*36px/);
  expect(base).toMatch(/height:\s*36px/);
  const z = (s: string) => Number(s.match(/z-index:\s*(\d+)/)?.[1]);
  expect(z(base)).toBeGreaterThan(40);
  expect(z(base)).toBeLessThan(45); // the Tools drawer is 45, the Day drawer 47
  expect(z(rule(soCss, ".so-layer[data-place='zen']"))).toBeGreaterThan(z(rule(zenCss, '.zen')));
});

it('Zen and Dream make room: the Leave block 28 px up, the hint clear of the grown pill', () => {
  expect(zenCss.match(/\.zen-br\s*\{[^}]*bottom:\s*(\d+)px/)?.[1]).toBe('72'); // was 44
  expect(zenCss.match(/\.dream-hint\s*\{[^}]*right:\s*(\d+)px/)?.[1]).toBe('190'); // was 124; the pill starts 174 px in and the hint drifts 15 px
});

it('is not clickable or focusable while the Tools drawer is open, and is again when it closes', async () => {
  render(<ScreensOffLayer />);
  await flush();
  const layer = () => document.querySelector('.so-layer')!;
  act(() => useToolsStore.getState().openDrawer());
  expect(layer().hasAttribute('inert')).toBe(true);
  act(() => useToolsStore.getState().close());
  expect(layer().hasAttribute('inert')).toBe(false);
});

it('stays live on Zen even if the Tools drawer was left open beneath it', async () => {
  usePlaceStore.setState({ active: 'zen' });
  render(<ScreensOffLayer />);
  await flush();
  act(() => useToolsStore.getState().openDrawer());
  expect(document.querySelector('.so-layer')!.hasAttribute('inert')).toBe(false);
});

function Drawer({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useBehindDrawer(ref, onClose);
  return (
    <div ref={ref} tabIndex={-1} data-testid="drawer">
      drawer
    </div>
  );
}

it('is not clickable or focusable while the Day drawer is open (the drawer holds the rest of the wall inert)', async () => {
  render(
    <div className="stage">
      <div className="shell">
        <Drawer onClose={() => undefined} />
      </div>
      <ScreensOffLayer />
    </div>,
  );
  await flush();
  expect(document.querySelector('.so-layer')!.hasAttribute('inert')).toBe(true);
});

it('a click on the control on Dream hides the screens and does not wake Dream', async () => {
  usePlaceStore.setState({ active: 'zen' });
  const onWake = vi.fn();
  render(
    <>
      <Dream onWake={onWake} />
      <ScreensOffLayer />
    </>,
  );
  await flush();
  fireEvent.click(screen.getByRole('button', { name: 'Hide screen' }), { detail: 1 });
  await flush();
  expect(calls).toContain('wall2_monitors_off');
  expect(onWake).not.toHaveBeenCalled();
  // The keys on the control do not wake it either.
  fireEvent.keyDown(screen.getByRole('button', { name: 'Hiding' }), { key: 'Enter' });
  fireEvent.keyDown(screen.getByRole('button', { name: 'Hiding' }), { key: ' ' });
  expect(onWake).not.toHaveBeenCalled();
  // Anywhere else on Dream still wakes it.
  fireEvent.click(screen.getByLabelText('Wake'));
  expect(onWake).toHaveBeenCalledTimes(1);
});

it('the corner control and the Work key agree on the mode', async () => {
  render(<ScreensOffLayer />);
  await flush();
  modeNow = true;
  await emit({ active: true });
  expect(screen.getByRole('button', { name: 'Cancel hide' }).getAttribute('aria-pressed')).toBe('true');
  // The key reads the same mode and refuses with its own words.
  await expect(runWallAction('screens-off')).rejects.toThrow('Screens are already off');
  calls.length = 0;
  modeNow = false;
  await emit({ active: false, reason: 'cancelled' });
  expect(screen.getByRole('button', { name: 'Hide screen' }).getAttribute('aria-pressed')).toBe('false');
});
