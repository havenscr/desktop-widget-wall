import { localDate as localDateOf, MAX_SHOW_MS, STORAGE_KEY, type MarkResult, type Part, type Saved, type Show } from '../../onair/model';
import { usePlaceStore } from '../../state/places';
import { resetTakes } from '../../onair/takes';
import { STORAGE_KEY as TAKES_KEY } from '../../onair/takeModel';
import { LAST_KEY } from '../../onair/lastOnAir';
import { MODE_STORAGE_KEY } from '../../onair/modes';
import { reviewNow } from '../../ui/reviewClock';
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
 *   ?oatimer=run|stopped|idle|limit    the stored timer: running at 42:13, stopped at 42:13, never started, stopped itself at 24 hours
 *   ?openfail=show|marks               Open file (or Open marks.txt) fails
 *   ?oamode=live|rec|meet              On Air starts held on that page
 *   ?oalast=1                          the idle page's last time on air: Live for 58:12, 4 marks, the review day at 9:12 AM
 *   ?oatake=N                          the new frame's takes: N today, the running one began 4:12 before the review clock, the longest ran 06:40
 *   ?oapaused=1                        with oatake, the running take is paused
 *   ?meetnow=1                         the one meeting a call belongs to, 10:00 to 11:00 (devMocks/meet.ts); ?meetlong=1 gives it a 120 character title
 *   ?callbrowserav=1                   a browser holds the camera and microphone with no call (devMocks/signals.ts)
 *   ?recorder=open|none|unknown        the Camtasia Recorder read (default open)
 *   ?whylong=1                         the new frame's reason is longer than any real one
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
  if (kind === 'run') return { running: true, startedAt: now - at, accumulatedMs: 0, firstStartAt: now - at, stoppedAt: null };
  if (kind === 'stopped') return { running: false, startedAt: null, accumulatedMs: at, firstStartAt: now - at - 3 * 60_000, stoppedAt: now - 3 * 60_000 };
  if (kind === 'limit') return { running: false, startedAt: null, accumulatedMs: MAX_SHOW_MS, firstStartAt: now - MAX_SHOW_MS - 3_600_000, stoppedAt: now - 3_600_000 };
  if (kind === 'idle') return { running: false, startedAt: null, accumulatedMs: 0, firstStartAt: null, stoppedAt: null };
  return null;
}

export function registerOnAirMocks(): void {
  let which = knob('show') ?? 'typical';
  const marksKnob = knob('marks') ?? '2';
  const times: string[] = marksKnob === '0' ? [] : marksKnob === 'full' ? ['03:12', '09:40', '21:05'] : ['03:12', '09:40'];
  const PARTS = ['Load the data', 'Shape the columns', 'End on the chart'];
  const parts: string[] = marksKnob === '0' ? [] : marksKnob === 'full' ? [PARTS[0], PARTS[1], PARTS[2]] : [PARTS[0], PARTS[0]];
  const result = (): MarkResult => ({ today: times.length, last: times.slice(-3), lastParts: parts.slice(-3) });

  mocks.set('wall2_recorder_status', () => ({ state: ['open', 'none', 'unknown'].includes(knob('recorder') ?? '') ? knob('recorder') : 'open' }));
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
    parts.push(String(args?.part ?? ''));
    times.push(s >= 3600 ? `${Math.floor(s / 3600)}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}` : `${pad(Math.floor(s / 60))}:${pad(s % 60)}`);
    return result();
  });
  mocks.set('wall2_onair_save_notes', (args) => {
    const lines = ((args?.lines as string[] | undefined) ?? []).map((l) => l.trim()).filter(Boolean);
    if (lines.length > 40) throw 'refused: more than 40 notes';
    if (lines.some((l) => l.length > 160)) throw 'refused: a note is over 160 characters';
    which = 'typical';
    TYPICAL.splice(0, TYPICAL.length, { name: '', minutes: null, notes: lines });
    return lines.length;
  });
  mocks.set('wall2_onair_open', (args) => {
    if (args?.which && args.which === knob('openfail')) throw 'failed';
    if (args?.which === 'show' && which === 'missing') which = 'starter';
    return undefined;
  });

  const saved = savedTimer(knob('oatimer'), Date.now());
  if (saved) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
    } catch {
      // No storage: the timer starts idle.
    }
  }
  // The new frame's hold and takes (development only; nothing is written without the knob).
  const hold = knob('oamode');
  if (hold === 'live' || hold === 'rec' || hold === 'meet') {
    try {
      window.localStorage.setItem(MODE_STORAGE_KEY, JSON.stringify({ held: hold }));
    } catch {
      // No storage: the page is in Auto.
    }
  }
  if (knob('oalast') === '1') {
    try {
      const at = reviewNow ? reviewNow() : Date.now();
      window.localStorage.setItem(LAST_KEY, JSON.stringify({ endedAt: at - 72 * 60_000, mode: 'live', lengthMs: 58 * 60_000 + 12_000, marks: 4 }));
    } catch {
      // No storage: no record.
    }
  }
  const took = Number(knob('oatake'));
  if (knob('oatake') !== null && Number.isInteger(took) && took > 0) {
    const at = reviewNow ? reviewNow() : Date.now();
    const paused = knob('oapaused') === '1';
    const startedAt = at - (paused ? 6 * 60_000 : 4 * 60_000 + 12_000);
    try {
      window.localStorage.setItem(TAKES_KEY, JSON.stringify({ day: localDateOf(at), count: took, longestMs: 6 * 60_000 + 40_000, current: { startedAt, pausedAt: paused ? at - (6 * 60_000 - 4 * 60_000 - 12_000) : null, pausedMs: 0, seenAt: at } }));
    } catch {
      // No storage: no takes.
    }
    resetTakes();
  }
  // After the place `?hz=` names is open (the horizon applies it on mount).
  if (knob('screen') === 'onair') setTimeout(() => usePlaceStore.getState().setActive('onair'), 300);
}
