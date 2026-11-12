import { describe, expect, it } from 'vitest';
import { artDataUrl, formatTime, isPlaying, isQuiet, nextArt, progressSeconds } from './model';

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

describe('progress maths', () => {
  const playing = { playback_status: 'playing', position_seconds: 60, duration_seconds: 200 };
  it('advances with the clock while playing', () => {
    expect(progressSeconds(playing, 10_000, 15_000)).toEqual({ position: 65, duration: 200 });
  });
  it('never passes the duration', () => {
    expect(progressSeconds(playing, 0, 10_000_000)).toEqual({ position: 200, duration: 200 });
  });
  it('holds while paused', () => {
    expect(progressSeconds({ ...playing, playback_status: 'paused' }, 0, 50_000)).toEqual({ position: 60, duration: 200 });
  });
  it('is null without a usable duration', () => {
    expect(progressSeconds({ ...playing, duration_seconds: 0 }, 0, 0)).toBeNull();
    expect(progressSeconds({ ...playing, duration_seconds: null }, 0, 0)).toBeNull();
    expect(progressSeconds(null, 0, 0)).toBeNull();
  });
  it('treats a missing position as 0 and a clock that went backwards as no elapsed time', () => {
    expect(progressSeconds({ ...playing, position_seconds: null }, 5000, 4000)).toEqual({ position: 0, duration: 200 });
  });
  it('formats m:ss and h:mm:ss', () => {
    expect(formatTime(0)).toBe('0:00');
    expect(formatTime(155)).toBe('2:35');
    expect(formatTime(253)).toBe('4:13');
    expect(formatTime(3725)).toBe('1:02:05');
    expect(formatTime(-4)).toBe('0:00');
  });
});
