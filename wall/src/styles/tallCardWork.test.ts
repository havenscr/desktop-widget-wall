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

it('the YouTube head becomes a grid only once its mark is set, and fades around the switch', () => {
  const head = '.yt-songs.tall .sp-shead';
  expect(rule(`${head}[data-compact]`)).toContain('display: grid');
  expect(rule(`${head}[data-compact] .yt-shactions`)).toContain('display: contents');
  expect(rule(`${head}[data-compact] .yt-refreshrow`)).toContain('grid-row: 1');
  expect(rule(`${head}[data-compact] .yt-playbtns`)).toContain('grid-row: 3');
  expect(rule(`${head}[data-compact] .yt-songthumb`)).toContain('display: none');
  expect(rule(head)).toContain('opacity 130ms');
  const out = rule(`${head}[data-fading]`);
  expect(out).toContain('opacity: 0');
  expect(out).toContain('120ms');
});

it('the head hook waits the fade out before it switches, and the same times are in the CSS', () => {
  const hook = (readFileSync('src/unwind/ytmusic/useCompactHead.ts', 'utf8') as string).replace(/\r\n/g, '\n');
  expect(hook).toContain('HEAD_OUT_MS = 120');
  expect(hook).toContain('HEAD_IN_MS = 130');
  expect(hook).toContain("attributeFilter: ['data-work-shown']");
  const songs = (readFileSync('src/unwind/ytmusic/YtSongs.tsx', 'utf8') as string).replace(/\r\n/g, '\n');
  expect(songs).toContain('data-compact');
  expect(songs).toContain('data-fading');
});

it('both fades stop under reduced motion', () => {
  const at = css.indexOf('@media (prefers-reduced-motion: reduce) {\n  .sp-songs.tall .sp-shead .sp-cover,');
  expect(at).toBeGreaterThan(-1);
  const block = css.slice(at, css.indexOf('\n}\n', at));
  expect(block).toContain('.yt-songs.tall .sp-shead');
  expect(block).toContain('transition: none');
});
