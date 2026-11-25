import { act, render, screen } from '@testing-library/react';
// @ts-ignore node's own file call; the stylesheet rules are read as text.
import { readFileSync } from 'node:fs';
import { afterEach, expect, it } from 'vitest';
import { WatchSheet } from './Sheet';
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
  expect(document.querySelector('.w-sheet .ln-body')).toBeNull();
  expect(useWatchStore.getState().sheet).toBeDefined();
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
