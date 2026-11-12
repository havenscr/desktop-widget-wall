import { expect, it } from 'vitest';
import { CAMERAS } from './cameras';
import { ECHO_FADE_S, echoOptions, stepEchoFade } from './echo';

it('takes ea, en, eamp and ecx from the camera preset, with hs 900 and the animation time', () => {
  for (const place of ['work', 'home', 'unwind'] as const) {
    const cam = CAMERAS[place];
    const e = echoOptions(cam, 1, 1, 2.5)!;
    expect(e).toMatchObject({ n: cam.en, amp: cam.eamp, cx: cam.ecx, hs: 900, t: 2.5 });
    expect(e.a).toBeCloseTo(cam.ea, 9);
  }
});

it('has the values from the concept demo', () => {
  expect(CAMERAS.unwind).toMatchObject({ ea: 0.9, en: 11, eamp: 34, ecx: 1330 });
  expect(CAMERAS.work).toMatchObject({ ea: 0.3, en: 3, eamp: 8, ecx: 1900 });
  expect(CAMERAS.home).toMatchObject({ ea: 0.22, en: 3, eamp: 6, ecx: 2300 });
});

it('draws nothing when the fade is zero', () => {
  expect(echoOptions(CAMERAS.unwind, 0, 1, 0)).toBeNull();
});

it('opacity scales with loudness and with the fade', () => {
  const quiet = echoOptions(CAMERAS.unwind, 1, 0.1, 0)!.a;
  const loud = echoOptions(CAMERAS.unwind, 1, 0.9, 0)!.a;
  const half = echoOptions(CAMERAS.unwind, 0.5, 0.9, 0)!.a;
  expect(loud).toBeGreaterThan(quiet);
  expect(half).toBeCloseTo(loud / 2, 9);
  expect(loud).toBeLessThanOrEqual(CAMERAS.unwind.ea);
});

it('rounds a blended line count', () => {
  expect(echoOptions({ ...CAMERAS.unwind, en: 6.6 }, 1, 1, 0)!.n).toBe(7);
});

it('fades in and out over about a second', () => {
  let f = 0;
  for (let i = 0; i < 5; i++) f = stepEchoFade(f, true, ECHO_FADE_S / 10);
  expect(f).toBeCloseTo(0.5, 9);
  expect(stepEchoFade(0, true, 5)).toBe(1);
  expect(stepEchoFade(1, false, ECHO_FADE_S / 4)).toBeCloseTo(0.75, 9);
  expect(stepEchoFade(0.1, false, 5)).toBe(0);
});
