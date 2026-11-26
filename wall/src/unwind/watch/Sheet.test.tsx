import { act, render, screen } from '@testing-library/react';
// @ts-ignore node's own file call; the stylesheet rules are read as text.
import { readFileSync } from 'node:fs';
import { afterEach, expect, it } from 'vitest';
import { WatchSheet } from './Sheet';
import { LinesGear } from './LinesPanel';
import { WatchGear } from './Watch';
import { resetWatch, useWatchStore } from './store';

const css = () => (readFileSync('src/styles/unwind.css', 'utf8') as string).replace(/\r\n/g, '\n');
const workCss = () => (readFileSync('src/styles/unwind-work.css', 'utf8') as string).replace(/\r\n/g, '\n');

afterEach(() => {
  resetWatch();
});

it('the Lines and Lights pages put their body in one scroller with the bottom fade hook', async () => {
  render(<WatchSheet initial="lines" />);
  const lines = screen.getByRole('dialog', { name: 'How the lines move' });
  const body = lines.querySelector(':scope > .ln-body');
  expect(body).not.toBeNull();
  expect(body!.classList.contains('sb-fade-bottom')).toBe(true);
  expect(body!.querySelector('.ln-panel')).not.toBeNull();
  // The heading row and the page switch stay outside the scroller.
  expect(body!.querySelector('.ln-pages')).toBeNull();
  expect(lines.querySelector(':scope > .w-head .ln-pages')).not.toBeNull();
  await act(async () => screen.getByRole('tab', { name: 'Lights' }).click());
  const lights = document.querySelector('.w-sheet.ls-sheet');
  expect(lights!.querySelector(':scope > .ln-body.sb-fade-bottom')).not.toBeNull();
  await act(async () => screen.getByRole('tab', { name: 'Looks' }).click());
  // Looks scrolls its own settings rows (`.wk-rows`, with their own fade, proved by the watchlooks fit-check), not the shared body.
  expect(document.querySelector('.w-sheet .ln-body')).toBeNull();
  expect(document.querySelector('.w-sheet.w-tune .wk-rows')).not.toBeNull();
});

it('the sheet stops at wall y 650 and its body scrolls', () => {
  const sheet = css().match(/\.w-sheet\.ln-sheet \{[^}]*\}/)![0];
  expect(sheet).toMatch(/max-height: 630px/);
  const body = css().match(/\.w-sheet\.ln-sheet > \.ln-body \{[^}]*\}/)![0];
  expect(body).toMatch(/overflow-y: auto/);
  expect(body).toMatch(/min-height: 0/);
});

it('the day line sits 6 px below the frame and the bottom row 6 px above it', () => {
  expect(workCss().match(/\.rib-line \{[^}]*\}/)![0]).toMatch(/bottom: -6px/);
  expect(css().match(/\.u-foot \{[^}]*\}/)![0]).toMatch(/bottom: 6px/);
  expect(css().match(/\.u-office-slot \{[^}]*\}/)![0]).toMatch(/top: 636px/);
});

it('the scroll body keeps focused rows clear of the fade and its focus rings whole', () => {
  const body = css().match(/\.w-sheet\.ln-sheet > \.ln-body \{[^}]*\}/)![0];
  expect(body).toMatch(new RegExp('scroll-padding-' + 'bottom: 64px'));
  expect(body).toMatch(new RegExp('padding: 0 6' + 'px'));
});

it('switching page opens the new page at the top (the body is keyed by page)', async () => {
  render(<WatchSheet initial="lines" />);
  const first = document.querySelector('.ln-body')!;
  await act(async () => screen.getByRole('tab', { name: 'Lights' }).click());
  expect(document.querySelector('.ln-body')).not.toBe(first);
});

it('the Vibe page is the third of four pages, holds every vibe control and scrolls in the one body', async () => {
  render(<WatchSheet initial="vibe" />);
  const names = screen.getAllByRole('tab').map((t) => t.textContent);
  expect(names).toEqual(['Looks', 'Lines', 'Vibe', 'Lights']);
  const dlg = screen.getByRole('dialog', { name: 'The vibe' });
  expect(screen.getByRole('tab', { name: 'Vibe' }).getAttribute('aria-selected')).toBe('true');
  const body = dlg.querySelector(':scope > .ln-body.sb-fade-bottom');
  expect(body).not.toBeNull();
  expect(dlg.classList.contains('ln-sheet')).toBe(true);
  expect(body!.querySelector('[role="switch"]')).not.toBeNull();
  for (const n of ['Auto vibe', 'Drop Glitch', 'Tape Grain', 'Calm cap']) expect(screen.getByRole('switch', { name: n })).toBeTruthy();
  expect(screen.queryByRole('radiogroup', { name: 'Cover' })).toBeNull();
  expect(screen.getByRole('radiogroup', { name: 'Music on other tabs' })).toBeTruthy();
  await act(async () => screen.getByRole('tab', { name: 'Lines' }).click());
  expect(screen.queryByRole('switch', { name: 'Auto vibe' })).toBeNull();
  await act(async () => screen.getByRole('tab', { name: 'Vibe' }).click());
  expect(screen.getByRole('switch', { name: 'Auto vibe' })).toBeTruthy();
});

it('a request for the vibe tab opens the sheet on the Vibe page', async () => {
  render(<WatchSheet initial="lines" />);
  expect(screen.getByRole('dialog', { name: 'How the lines move' })).toBeTruthy();
  await act(async () => useWatchStore.getState().setSheet(true, 'vibe'));
  expect(screen.getByRole('dialog', { name: 'The vibe' })).toBeTruthy();
});

/** The sheet as Unwind mounts it: the gear of the tab in use opens it, Lines from Listen and Looks from Watch. */
function Mounted({ watch }: { watch: boolean }) {
  const open = useWatchStore((st) => st.sheet);
  return (
    <>
      {watch ? <WatchGear /> : <LinesGear />}
      {open ? <WatchSheet initial={watch ? 'looks' : 'lines'} /> : null}
    </>
  );
}

it('the Listen gear opens the sheet on Lines and the Watch gear on Looks', async () => {
  const listen = render(<Mounted watch={false} />);
  await act(async () => screen.getByRole('button', { name: 'How the lines move' }).click());
  expect(screen.getByRole('tab', { name: 'Lines' }).getAttribute('aria-selected')).toBe('true');
  listen.unmount();
  resetWatch();
  render(<Mounted watch />);
  await act(async () => screen.getByRole('button', { name: 'How video is shown' }).click());
  expect(screen.getByRole('tab', { name: 'Looks' }).getAttribute('aria-selected')).toBe('true');
});
