import { STORAGE_KEY, type MarkResult, type Part, type Saved, type Show } from '../../onair/model';
import { usePlaceStore } from '../../state/places';
import { mocks } from '../tauri';
import { knob } from './long';

/**
 * Dev only: On Air's files, for `npm run dev` in a plain browser and the gallery. Every name and
 * note is invented.
 *
 *   ?screen=onair                      open On Air
 *   ?show=typical|one|long|forty|empty|missing|refused|down
 *                                      the run of show (`down`: the read itself fails)
 *   ?marks=0|2|full                    marks so far today (`full`: marks.txt refuses the next mark)
 *   ?oatimer=run|stopped|idle          the stored timer: running at 42:13, stopped at 42:13, never started
 *
 * Open file turns `missing` into the starter's three parts, as the app does.
 */

const TYPICAL: Part[] = [
  { name: 'Welcome and news', minutes: 9, notes: ['Say hello and the one piece of news'] },
  { name: 'Meet the guest', minutes: 20, notes: ['Where they work and what they build', 'The project that started it'] },
  { name: 'Product demo', minutes: 20, notes: ['Point it at the real model first', 'Show cross-filtering with no extra code', 'Ask the guest what tripped them up first'] },
  { name: 'Audience questions', minutes: 15, notes: ['Take the saved questions first'] },
  { name: 'Wrap and next week', minutes: 5, notes: ['Next week\'s topic and time'] },
];

const STARTER: Part[] = [
  { name: 'Welcome', minutes: 5, notes: ['Say hello and what today is about'] },
  { name: 'Main topic', minutes: 20, notes: ['The one thing to show today'] },
  { name: 'Questions', minutes: 10, notes: ['Take questions from the chat'] },
];

const LONG_NOTE = (i: number) =>
  `Note ${i + 1}: walk through the whole setup from the empty workspace to the finished report, naming every setting on the way and why it matters for the people who wat…`;

const LONG: Part[] = [
  { name: 'Welcome, housekeeping, the schedule and a word from the host', minutes: 10, notes: ['Say hello'] },
  { name: 'A part with no planned minutes and no notes at all, to check', minutes: null, notes: [] },
  { name: 'An extremely long part name that runs right up to the limit', minutes: 240, notes: Array.from({ length: 12 }, (_, i) => LONG_NOTE(i)) },
  { name: 'Questions from the audience and the chat, then the wrap up', minutes: null, notes: [] },
];

const FORTY: Part[] = Array.from({ length: 40 }, (_, i) => ({
  name: `Segment ${i + 1}: ${['Opening', 'Demo', 'Interview', 'Break', 'Questions'][i % 5]}`,
  minutes: [5, 10, 15, 3, 8][i % 5],
  notes: [`Talking point for segment ${i + 1}`, 'Check the timing before moving on'],
}));

const show = (state: Show['state'], parts: Part[] = [], extra: Partial<Show> = {}): Show => ({ state, title: null, parts, skipped: 0, reason: null, readAt: Date.now(), ...extra });

function savedTimer(kind: string | null, now: number): Saved | null {
  const at = 42 * 60_000 + 13_000;
  if (kind === 'run') return { running: true, startedAt: now - at, accumulatedMs: 0, firstStartAt: now - at, stoppedAt: null, partIndex: 2, partSinceMs: at - 13 * 60_000 };
  if (kind === 'stopped') return { running: false, startedAt: null, accumulatedMs: at, firstStartAt: now - at - 3 * 60_000, stoppedAt: now - 3 * 60_000, partIndex: 2, partSinceMs: at - 13 * 60_000 };
  if (kind === 'idle') return { running: false, startedAt: null, accumulatedMs: 0, firstStartAt: null, stoppedAt: null, partIndex: 0, partSinceMs: 0 };
  return null;
}

export function registerOnAirMocks(): void {
  let which = knob('show') ?? 'typical';
  const marksKnob = knob('marks') ?? '2';
  const times: string[] = marksKnob === '0' ? [] : marksKnob === 'full' ? ['03:12', '09:40', '21:05'] : ['03:12', '09:40'];
  const result = (): MarkResult => ({ today: times.length, last: times.slice(-3) });

  mocks.set('wall2_onair_show', () => {
    switch (which) {
      case 'down':
        throw 'failed';
      case 'missing':
        return show('missing');
      case 'refused':
        return show('refused', [], { reason: 'run-of-show.txt is over 32 KB' });
      case 'empty':
        return show('ok', [], { skipped: 2 });
      case 'one':
        return show('ok', [TYPICAL[2]]);
      case 'long':
        return show('ok', LONG, { title: 'A very long show title that is cut at sixty characters for…', skipped: 3 });
      case 'forty':
        return show('ok', FORTY, { title: 'Marathon stream', skipped: 4 });
      case 'starter':
        return show('ok', STARTER, { title: 'My show' });
      default:
        return show('ok', TYPICAL, { title: 'Friday stream' });
    }
  });
  mocks.set('wall2_onair_marks_today', () => result());
  mocks.set('wall2_onair_mark', (args) => {
    if (marksKnob === 'full') throw 'refused';
    const ms = Number(args?.showMs ?? 0);
    const s = Math.floor(ms / 1000);
    const pad = (n: number) => String(n).padStart(2, '0');
    times.push(s >= 3600 ? `${Math.floor(s / 3600)}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}` : `${pad(Math.floor(s / 60))}:${pad(s % 60)}`);
    return result();
  });
  mocks.set('wall2_onair_open', (args) => {
    if (args?.which === 'show' && which === 'missing') which = 'starter';
    return undefined;
  });

  const saved = savedTimer(knob('oatimer'), Date.now());
  // Forty parts: the current one deep in the list, so the list has scrolled to it.
  if (saved && which === 'forty') saved.partIndex = 23;
  if (saved) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
    } catch {
      // No storage: the timer starts idle.
    }
  }
  // After the place `?hz=` names is open (the horizon applies it on mount).
  if (knob('screen') === 'onair') setTimeout(() => usePlaceStore.getState().setActive('onair'), 300);
}
