// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { expect, it } from 'vitest';
import { artKind, MoodArt } from './MoodArt';

const SCENES: [string, string][] = [
  ['gaming', 'gaming'],
  ['recording', 'recording'],
  ['office_recording', 'recording'],
  ['romantic', 'romantic'],
  ['romantic_mode', 'romantic'],
  ['fireplace', 'fireplace'],
  ['fireplace_cozy', 'fireplace'],
  ['movie', 'movie'],
  ['tv', 'movie'],
  ['movie_mode', 'movie'],
];

it('maps each scene id to its kind', () => {
  for (const [id, kind] of SCENES) expect(artKind(id)).toBe(kind);
  expect(artKind('Gaming')).toBe('gaming');
  expect(artKind('reading')).toBe('lamp');
});

it('renders an svg for each scene id with its own gradient ids', () => {
  for (const [id] of SCENES) {
    const { container, unmount } = render(<MoodArt id={id} />);
    const svg = container.querySelector('svg.mood-art');
    expect(svg).toBeTruthy();
    expect(svg!.querySelector('linearGradient[id$="sky"]')).toBeTruthy();
    unmount();
  }
});

it('draws the recording sign, the gaming floor in place of the near ridge, and the movie screen low', () => {
  const rec = render(<MoodArt id="recording" />).container;
  expect(rec.querySelector('text')?.textContent).toBe('ON AIR');
  const gaming = render(<MoodArt id="gaming" />).container;
  expect(gaming.querySelectorAll('line').length).toBeGreaterThan(20);
  const movie = render(<MoodArt id="movie" />).container;
  const screen = [...movie.querySelectorAll('rect')].find((r) => r.getAttribute('width') === '108');
  expect(screen?.getAttribute('y')).toBe('160');
});
