import { expect, it } from 'vitest';
import { artDataUrl, isPlaying, isQuiet, nextArt } from './model';

it('allows only image mimes and plain base64', () => {
  expect(artDataUrl('QUJD', 'image/png')).toBe('data:image/png;base64,QUJD');
  expect(artDataUrl('QUJD', 'IMAGE/JPEG')).toBe('data:image/jpeg;base64,QUJD');
  expect(artDataUrl('QUJD', 'image/svg+xml')).toBeNull();
  expect(artDataUrl('QUJD', 'text/html')).toBeNull();
  expect(artDataUrl('QUJD', null)).toBeNull();
  expect(artDataUrl('', 'image/png')).toBeNull();
  expect(artDataUrl('QUJD"onerror=x', 'image/png')).toBeNull();
});

it('keeps the previous art when art_unchanged', () => {
  const prev = 'data:image/png;base64,AAAA';
  expect(nextArt({ art_unchanged: true }, prev)).toBe(prev);
  expect(nextArt({ art_unchanged: false, album_art_base64: 'QUJD', album_art_mime: 'image/gif' }, prev)).toBe(
    'data:image/gif;base64,QUJD',
  );
  expect(nextArt({ album_art_base64: 'QUJD', album_art_mime: 'image/svg+xml' }, prev)).toBeNull();
  expect(nextArt({}, prev)).toBeNull();
});

it('is quiet when stopped, unknown or empty', () => {
  expect(isQuiet(null)).toBe(true);
  expect(isQuiet({ playback_status: 'stopped', title: 'x' })).toBe(true);
  expect(isQuiet({ playback_status: 'unknown', title: 'x' })).toBe(true);
  expect(isQuiet({ playback_status: 'playing' })).toBe(true);
  expect(isQuiet({ playback_status: 'paused', title: 'x' })).toBe(false);
  expect(isQuiet({ playback_status: 'changing', title: 'x' })).toBe(false);
  expect(isPlaying({ playback_status: 'playing' })).toBe(true);
});
