// @ts-ignore node's own file call; the stylesheet is read as text.
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

// While the work layer is shown the tall music card is 506 px high, so an opened playlist's head column cannot keep its
// full-height layout. This pins the CSS; the measured proof is the tall-card-work-layer area of the browser fit check.
const css = (readFileSync('src/styles/unwind-work.css', 'utf8') as string).replace(/\r\n/g, '\n');
const shown = ".main[data-place='unwind'][data-work-shown]";
const rule = (sel: string): string => {
  const at = css.indexOf(`\n${sel} {`);
  expect(at).toBeGreaterThan(-1);
  return css.slice(at, css.indexOf('}', at));
};

it('the cut card keeps its 506 px height', () => {
  expect(rule(`${shown} .sp-card.tall,\n${shown} .sp-card.yt.tall`)).toContain('height: 506px');
});

it('the Spotify cover shrinks with the card, on the card’s 250 ms ease', () => {
  expect(rule('.sp-songs.tall .sp-shead .sp-cover')).toContain('250ms');
  const r = rule(`${shown} .sp-songs.tall:not(.yt-songs) .sp-shead .sp-cover`);
  expect(r).toContain('width: 72px !important');
  expect(r).toContain('height: 72px !important');
});

it('the YouTube head becomes a grid with its buttons in rows that fit', () => {
  expect(rule(`${shown} .yt-songs.tall .sp-shead`)).toContain('display: grid');
  expect(rule(`${shown} .yt-songs.tall .yt-shactions`)).toContain('display: contents');
  expect(rule(`${shown} .yt-songs.tall .yt-refreshrow`)).toContain('grid-row: 1');
  expect(rule(`${shown} .yt-songs.tall .yt-playbtns`)).toContain('grid-row: 3');
});

it('every rule of the compact head sits under the layer-shown mark', () => {
  const at = css.indexOf('.sp-songs.tall .sp-shead .sp-cover {');
  const end = css.indexOf('@keyframes tall-head-settle');
  const block = css.slice(at, end);
  for (const sel of block.split('{').slice(0, -1).map((b) => b.split('}').pop()!.trim()).filter((x) => x && x !== '.sp-songs.tall .sp-shead .sp-cover')) {
    expect(sel.startsWith(shown)).toBe(true);
  }
});
