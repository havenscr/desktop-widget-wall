import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mocks } from '../bridge/tauri';
import { IDLE } from '../onair/model';
import { useOnAirStore } from '../onair/store';
import { useSignalStore } from '../signals/store';
import { studioAnswer, studioWith } from './homeKit';
import { canChange, HOME_READ_EVERY_MS, homePollChange, homeView, moodsPollChange, OFF_READ_DELAY_MS, OFFER_MS, OFFICE_NUDGE, OFFICE_OFF, resetHome, TEXT, useHome } from './homeStore';
import { NOTE_MS, resetKeyLights } from './store';

vi.setConfig({ testTimeout: 20_000 });

const flush = async (ms = 0) => {
  await vi.advanceTimersByTimeAsync(ms);
};

let answer: Record<string, unknown>;
let calls: { command: string; args?: Record<string, unknown> }[];
let writeWord: string | null;
let keyReads: number;

const record = (command: string, f: (args?: Record<string, unknown>) => unknown) =>
  mocks.set(command, (args) => {
    calls.push({ command, args });
    return f(args);
  });

const reads = () => calls.filter((c) => c.command === 'wall2_studio').length;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.parse('2026-11-14T10:00:00-08:00'));
  resetKeyLights();
  useOnAirStore.setState({ saved: IDLE });
  useSignalStore.setState({ known: true, recording: false });
  resetHome();
  answer = studioAnswer();
  calls = [];
  writeWord = null;
  keyReads = 0;
  mocks.set('wall2_keylights_status', () => ({ left: { set: true }, right: { set: true } }));
  mocks.set('wall2_keylights_read', () => {
    keyReads++;
    return { left: { on: true, brightness: 60, kelvin: 4400 }, right: { on: true, brightness: 60, kelvin: 4400 } };
  });
  record('wall2_studio', () => answer);
  for (const c of ['wall2_studio_preset', 'wall2_studio_normal', 'wall2_studio_group', 'wall2_studio_look']) {
    record(c, () => {
      if (writeWord) throw writeWord;
      return answer;
    });
  }
  record('wall2_office_moods', () => ({ stale: false, moods: [{ id: 'brightDesk', label: 'Bright desk', line: 'Room 70%', active: false }], canWrite: true, writeBlock: null }));
  record('wall2_office_mood', (args) => {
    if (writeWord) throw writeWord;
    return { stale: false, moods: [{ id: 'brightDesk', label: 'Bright desk', line: 'Room 70%', active: args?.id === 'brightDesk' }], canWrite: true, writeBlock: null };
  });
});
afterEach(() => {
  resetHome();
  vi.useRealTimers();
  mocks.clear();
});

// Section: reads

it('a good read is ready; the studio is checked again on the page side', async () => {
  await useHome.getState().readStudio();
  const s = useHome.getState();
  expect(homeView(s)).toBe('ready');
  expect(canChange(s)).toBe(true);
  expect(s.studio?.presets.map((p) => p.id)).toEqual(['onAir', 'recording']);
  // A bad colour, a group the page does not know and a bad level are dropped on this side too.
  answer = studioAnswer({
    groups: [
      { id: 'panels', label: 'Panels', on: true, colour: 'red', level: 150, floor: null, canSwitch: true, canDim: true, reachable: true },
      { id: 'kitchen', label: 'Kitchen', on: true },
    ],
  });
  await useHome.getState().readStudio();
  const g = useHome.getState().studio!.groups;
  expect(g.map((x) => x.id)).toEqual(['panels']);
  expect(g[0].colour).toBeNull();
  expect(g[0].level).toBeNull();
});

it('the words of a failed read: absent words are not offered, anything else is not answering', async () => {
  for (const word of ['absent', 'not-configured', 'studio-not-set-up']) {
    mocks.set('wall2_studio', () => {
      throw word;
    });
    await useHome.getState().readStudio();
    expect(homeView(useHome.getState())).toBe('absent');
  }
  for (const word of ['unreachable', 'failed', 'forbidden']) {
    mocks.set('wall2_studio', () => {
      throw word;
    });
    await useHome.getState().readStudio();
    expect(homeView(useHome.getState())).toBe('down');
    expect(canChange(useHome.getState())).toBe(false);
  }
  // A thing that is not a studio answer at all is failed, and so down.
  mocks.set('wall2_studio', () => ({ nonsense: true }));
  await useHome.getState().readStudio();
  expect(useHome.getState().readWord).toBe('failed');
});

it('nothing is known before the first answer; a read after a failure shows the last answer as not live', async () => {
  expect(homeView(useHome.getState())).toBe('checking');
  await useHome.getState().readStudio();
  mocks.set('wall2_studio', () => {
    throw 'unreachable';
  });
  await useHome.getState().readStudio();
  const s = useHome.getState();
  expect(homeView(s)).toBe('down');
  // The last good answer stays for the dim tiles, but nothing may be changed from it.
  expect(s.studio).not.toBeNull();
  expect(canChange(s)).toBe(false);
});

it('only the newest read lands, whatever order the answers come in', async () => {
  let release: (v: unknown) => void = () => {};
  mocks.set('wall2_studio', () => new Promise((r) => (release = r)));
  const slow = useHome.getState().readStudio();
  mocks.set('wall2_studio', () => studioWith('onAir'));
  await useHome.getState().readStudio();
  release(studioAnswer());
  await slow;
  expect(useHome.getState().studio?.presets.find((p) => p.active)?.id).toBe('onAir');
});

it('no write is possible without a token or on a base the token may not go to, and the block says why', async () => {
  answer = studioAnswer({ canWrite: false, writeBlock: 'not-set-up' });
  await useHome.getState().readStudio();
  expect(useHome.getState().studio?.writeBlock).toBe('not-set-up');
  expect(canChange(useHome.getState())).toBe(false);
  answer = studioAnswer({ canWrite: false, writeBlock: 'needs-private-address' });
  await useHome.getState().readStudio();
  expect(useHome.getState().studio?.writeBlock).toBe('needs-private-address');
  expect(canChange(useHome.getState())).toBe(false);
  // A made-up block word is dropped.
  answer = studioAnswer({ canWrite: false, writeBlock: 'whatever' });
  await useHome.getState().readStudio();
  expect(useHome.getState().studio?.writeBlock).toBeNull();
});

// Section: polling

it('one read when the first screen joins, then every 60 seconds, one poll for any number of screens, none after the last leaves', async () => {
  homePollChange(1);
  await flush();
  expect(reads()).toBe(1);
  homePollChange(1);
  await flush();
  // A screen that joins reads once at once; the timer is shared.
  expect(reads()).toBe(2);
  await flush(HOME_READ_EVERY_MS);
  expect(reads()).toBe(3);
  homePollChange(-1);
  await flush(HOME_READ_EVERY_MS);
  expect(reads()).toBe(4);
  homePollChange(-1);
  await flush(HOME_READ_EVERY_MS * 3);
  expect(reads()).toBe(4);
});

it('the moods poll is separate: one read, then every 60 seconds, then stops', async () => {
  moodsPollChange(1);
  await flush();
  expect(calls.filter((c) => c.command === 'wall2_office_moods')).toHaveLength(1);
  await flush(HOME_READ_EVERY_MS);
  expect(calls.filter((c) => c.command === 'wall2_office_moods')).toHaveLength(2);
  moodsPollChange(-1);
  await flush(HOME_READ_EVERY_MS * 2);
  expect(calls.filter((c) => c.command === 'wall2_office_moods')).toHaveLength(2);
  expect(useHome.getState().moods?.moods.map((m) => m.id)).toEqual(['brightDesk']);
});

// Section: writes

it('every control shows what the home app read back, not what was clicked', async () => {
  await useHome.getState().readStudio();
  // The home app answers that nothing changed: On air stays off on the page.
  await useHome.getState().applyPreset('onAir');
  expect(useHome.getState().studio?.presets.find((p) => p.id === 'onAir')?.active).toBe(false);
  answer = studioWith('onAir');
  await useHome.getState().applyPreset('onAir');
  expect(useHome.getState().studio?.presets.find((p) => p.id === 'onAir')?.active).toBe(true);
  expect(calls.filter((c) => c.command === 'wall2_studio_preset').map((c) => c.args)).toEqual([{ id: 'onAir' }, { id: 'onAir' }]);
});

it('a group write sends the id, on and a whole level', async () => {
  await useHome.getState().readStudio();
  await useHome.getState().setGroup('behindMonitor', true, 61.4);
  await useHome.getState().setGroup('panels', false);
  await useHome.getState().applyLook('calm');
  await useHome.getState().goNormal();
  expect(calls.filter((c) => c.command !== 'wall2_studio').map((c) => [c.command, c.args])).toEqual([
    ['wall2_studio_group', { id: 'behindMonitor', on: true, level: 61 }],
    ['wall2_studio_group', { id: 'panels', on: false }],
    ['wall2_studio_look', { id: 'calm' }],
    ['wall2_studio_normal', undefined],
  ]);
});

it('one home write at a time: the second waits for the first to answer', async () => {
  await useHome.getState().readStudio();
  const releases: (() => void)[] = [];
  mocks.set('wall2_studio_preset', (args) => {
    calls.push({ command: 'wall2_studio_preset', args });
    return new Promise((r) => releases.push(() => r(answer)));
  });
  const a = useHome.getState().applyPreset('onAir');
  const b = useHome.getState().applyPreset('recording');
  await flush();
  expect(calls.filter((c) => c.command === 'wall2_studio_preset')).toHaveLength(1);
  expect(useHome.getState().writes).toBe(2);
  releases[0]();
  await flush();
  expect(calls.filter((c) => c.command === 'wall2_studio_preset')).toHaveLength(2);
  releases[1]();
  await Promise.all([a, b]);
  expect(useHome.getState().writes).toBe(0);
  expect(calls.filter((c) => c.command === 'wall2_studio_preset').map((c) => c.args)).toEqual([{ id: 'onAir' }, { id: 'recording' }]);
});

it('a slider drag keeps only the newest waiting value for a group', async () => {
  await useHome.getState().readStudio();
  const releases: (() => void)[] = [];
  mocks.set('wall2_studio_group', (args) => {
    calls.push({ command: 'wall2_studio_group', args });
    return new Promise((r) => releases.push(() => r(answer)));
  });
  const first = useHome.getState().setGroup('overhead', true, 50);
  const second = useHome.getState().setGroup('overhead', true, 60);
  const third = useHome.getState().setGroup('overhead', true, 70);
  await flush();
  releases[0]();
  await flush();
  releases[1]?.();
  await Promise.all([first, second, third]);
  expect(calls.filter((c) => c.command === 'wall2_studio_group').map((c) => (c.args as { level: number }).level)).toEqual([50, 70]);
  expect(useHome.getState().writes).toBe(0);
});

it('a preset that sets the key lights, and As before, read the key lights again; a look does not', async () => {
  await useHome.getState().readStudio();
  await useKeyLightsRefresh();
  const before = keyReads;
  await useHome.getState().applyLook('calm');
  await flush();
  expect(keyReads).toBe(before);
  await useHome.getState().applyPreset('recording'); // setsKeyLights false
  await flush();
  expect(keyReads).toBe(before);
  await useHome.getState().applyPreset('onAir'); // setsKeyLights true
  await flush();
  expect(keyReads).toBe(before + 1);
  await useHome.getState().goNormal();
  await flush();
  expect(keyReads).toBe(before + 2);
});

async function useKeyLightsRefresh() {
  const { useKeyLights } = await import('./store');
  await useKeyLights.getState().refresh();
}

// Section: what a refused write says and does

const refuse = async (word: string, run: () => Promise<void>) => {
  writeWord = word;
  const before = reads();
  await run();
  await flush();
  return reads() - before;
};

it('room-dark: the one-room-stays-on line for 5 seconds, no read, the switch is what was read back', async () => {
  await useHome.getState().readStudio();
  const n = await refuse('room-dark', () => useHome.getState().setGroup('overhead', false));
  expect(n).toBe(0);
  expect(useHome.getState().note).toBe(TEXT.roomDark);
  expect(useHome.getState().studio?.groups.find((g) => g.id === 'overhead')?.on).toBe(true);
  await flush(NOTE_MS + 10);
  expect(useHome.getState().note).toBeNull();
});

it('busy, a light not answering, and no answer in time: their lines for 5 seconds, then a fresh read', async () => {
  await useHome.getState().readStudio();
  const cases: [string, string][] = [
    ['busy', TEXT.busy],
    ['not-answering', TEXT.notAnswering],
    ['unreachable', TEXT.unreachable],
  ];
  for (const [word, text] of cases) {
    const n = await refuse(word, () => useHome.getState().applyPreset('onAir'));
    expect(n).toBe(1);
    expect(useHome.getState().note).toBe(text);
    await flush(NOTE_MS + 10);
    expect(useHome.getState().note).toBeNull();
  }
});

it('an unknown id or nothing to undo: a fresh read at once and a line; a plain failure says so', async () => {
  await useHome.getState().readStudio();
  expect(await refuse('unknown', () => useHome.getState().applyLook('calm'))).toBe(1);
  expect(useHome.getState().note).toBe(TEXT.unknown);
  await flush(NOTE_MS + 10);
  expect(await refuse('nothing-to-undo', () => useHome.getState().goNormal())).toBe(1);
  expect(useHome.getState().note).toBe(TEXT.nothingToUndo);
  await flush(NOTE_MS + 10);
  expect(await refuse('failed', () => useHome.getState().goNormal())).toBe(1);
  expect(useHome.getState().note).toBe(TEXT.failed);
});

it('a failed read after an unreachable write leaves the page in the away state, not showing the click', async () => {
  await useHome.getState().readStudio();
  mocks.set('wall2_studio', () => {
    throw 'unreachable';
  });
  await refuse('unreachable', () => useHome.getState().applyPreset('onAir'));
  expect(homeView(useHome.getState())).toBe('down');
});

it('no desk token at the home app and a refused token stay until a write works or the token changes', async () => {
  await useHome.getState().readStudio();
  await refuse('home-not-set-up', () => useHome.getState().applyPreset('onAir'));
  expect(useHome.getState().sticky).toBe('home-not-set-up');
  await flush(NOTE_MS * 4);
  expect(useHome.getState().sticky).toBe('home-not-set-up');
  await refuse('forbidden', () => useHome.getState().applyPreset('onAir'));
  expect(useHome.getState().sticky).toBe('forbidden');
  // A good write clears it.
  writeWord = null;
  await useHome.getState().applyLook('calm');
  expect(useHome.getState().sticky).toBeNull();
  // A changed token clears it too, and reads again.
  await refuse('forbidden', () => useHome.getState().applyPreset('onAir'));
  mocks.set('wall2_desk_token_status', () => ({ set: true, unreadable: false }));
  const n = reads();
  await useHome.getState().tokenChanged();
  expect(useHome.getState().sticky).toBeNull();
  expect(useHome.getState().token).toEqual({ set: true, unreadable: false });
  expect(reads()).toBe(n + 1);
  // The moods are read after a token change only while Unwind shows them (nobody does here).
  expect(calls.filter((c) => c.command === 'wall2_office_moods')).toHaveLength(0);
});

it('office moods: a refused apply keeps the chip as read back and names the word for 5 seconds', async () => {
  await useHome.getState().readMoods();
  expect(useHome.getState().moods?.moods[0].active).toBe(false);
  writeWord = 'not-answering';
  await useHome.getState().applyMood('brightDesk');
  await flush();
  expect(useHome.getState().moodFail).toEqual({ id: 'brightDesk', word: 'not-answering' });
  expect(useHome.getState().moods?.moods[0].active).toBe(false);
  await flush(NOTE_MS + 10);
  expect(useHome.getState().moodFail).toBeNull();
  writeWord = null;
  await useHome.getState().applyMood('brightDesk');
  expect(useHome.getState().moods?.moods[0].active).toBe(true);
  // Moods that were never offered are hidden by every hiding word.
  for (const word of ['absent', 'not-configured', 'unreachable', 'failed']) {
    mocks.set('wall2_office_moods', () => {
      throw word;
    });
    await useHome.getState().readMoods();
    expect(useHome.getState().moodsWord).toBe(word);
  }
});

// Section: office Off

const offAnswer = (offActive: boolean, brightOn = false) => ({
  stale: false,
  moods: [{ id: 'brightDesk', label: 'Bright desk', line: 'Room 70%', active: brightOn }],
  off: { offered: true, active: offActive },
  canWrite: true,
  writeBlock: null,
});
const offCalls = () => calls.filter((c) => c.command === 'wall2_office_off');

it('applyOff: the write answer replaces the chips, and the read that follows waits about a second and a half', async () => {
  record('wall2_office_moods', () => offAnswer(false, true));
  record('wall2_office_off', () => offAnswer(true));
  moodsPollChange(1);
  await flush();
  expect(useHome.getState().moods?.off).toEqual({ active: false });
  const reads0 = calls.filter((c) => c.command === 'wall2_office_moods').length;
  await useHome.getState().applyOff();
  expect(offCalls()).toHaveLength(1);
  expect(offCalls()[0].args).toBeUndefined();
  expect(useHome.getState().moods?.off).toEqual({ active: true });
  expect(useHome.getState().moods?.moods[0].active).toBe(false);
  expect(useHome.getState().applying).toBeNull();
  // The answer is trusted: no read at once, one after the delay while Unwind still shows the row.
  await flush(OFF_READ_DELAY_MS - 10);
  expect(calls.filter((c) => c.command === 'wall2_office_moods')).toHaveLength(reads0);
  await flush(20);
  expect(calls.filter((c) => c.command === 'wall2_office_moods')).toHaveLength(reads0 + 1);
  moodsPollChange(-1);
});

it('applyOff: no read after the delay once Unwind has left', async () => {
  record('wall2_office_moods', () => offAnswer(false));
  record('wall2_office_off', () => offAnswer(true));
  moodsPollChange(1);
  await flush();
  await useHome.getState().applyOff();
  moodsPollChange(-1);
  const n = calls.filter((c) => c.command === 'wall2_office_moods').length;
  await flush(OFF_READ_DELAY_MS + 100);
  expect(calls.filter((c) => c.command === 'wall2_office_moods')).toHaveLength(n);
});

it('applyOff: a refusal sets moodFail on the Off id for 5 seconds and reads again; on-air has its own words', async () => {
  record('wall2_office_moods', () => offAnswer(false, true));
  let word = 'on-air';
  record('wall2_office_off', () => {
    throw word;
  });
  await useHome.getState().readMoods();
  const n = calls.filter((c) => c.command === 'wall2_office_moods').length;
  await useHome.getState().applyOff();
  expect(useHome.getState().moodFail).toEqual({ id: OFFICE_OFF, word: 'on-air' });
  expect(calls.filter((c) => c.command === 'wall2_office_moods')).toHaveLength(n + 1);
  expect(useHome.getState().moods?.moods[0].active).toBe(true);
  expect(TEXT.onAir).toBe('The studio is on air. End it with As before on On Air first.');
  await flush(NOTE_MS + 10);
  expect(useHome.getState().moodFail).toBeNull();
  word = 'forbidden';
  await useHome.getState().applyOff();
  expect(useHome.getState().sticky).toBe('forbidden');
});

it('a mood or Off click is ignored while a write of the page is out', async () => {
  record('wall2_office_moods', () => offAnswer(false));
  let release: (() => void) | undefined;
  record('wall2_office_off', () => new Promise((r) => (release = () => r(offAnswer(true)))));
  await useHome.getState().readMoods();
  const first = useHome.getState().applyOff();
  await flush();
  expect(useHome.getState().applying).toBe(OFFICE_OFF);
  void useHome.getState().applyOff();
  void useHome.getState().applyMood('brightDesk');
  await flush();
  expect(offCalls()).toHaveLength(1);
  expect(calls.filter((c) => c.command === 'wall2_office_mood')).toHaveLength(0);
  release?.();
  await first;
  // Nothing was queued behind it: after the answer no second write runs.
  await flush(50);
  expect(offCalls()).toHaveLength(1);
  expect(calls.filter((c) => c.command === 'wall2_office_mood')).toHaveLength(0);
  expect(useHome.getState().applying).toBeNull();
});

it('a poll tick inside the wait after an Off reads nothing; the one delayed read still comes, once', async () => {
  record('wall2_office_moods', () => offAnswer(false, true));
  record('wall2_office_off', () => offAnswer(true));
  const n = () => calls.filter((c) => c.command === 'wall2_office_moods').length;
  moodsPollChange(1);
  await flush(HOME_READ_EVERY_MS - 500);
  expect(n()).toBe(1);
  await useHome.getState().applyOff();
  // The 60 second tick lands 500 ms after the Off, inside the wait: no read, and the trusted answer stays.
  await flush(600);
  expect(n()).toBe(1);
  expect(useHome.getState().moods?.off).toEqual({ active: true });
  expect(useHome.getState().moods?.moods[0].active).toBe(false);
  await flush(OFF_READ_DELAY_MS);
  expect(n()).toBe(2);
  await flush(HOME_READ_EVERY_MS);
  expect(n()).toBe(3);
  moodsPollChange(-1);
});

it('Unwind left and shown again inside the wait after an Off reads nothing at once; the delayed read comes once', async () => {
  record('wall2_office_moods', () => offAnswer(false, true));
  record('wall2_office_off', () => offAnswer(true));
  const n = () => calls.filter((c) => c.command === 'wall2_office_moods').length;
  moodsPollChange(1);
  await flush();
  await useHome.getState().applyOff();
  moodsPollChange(-1);
  await flush(300);
  moodsPollChange(1);
  await flush(100);
  expect(n()).toBe(1);
  expect(useHome.getState().moods?.off).toEqual({ active: true });
  await flush(OFF_READ_DELAY_MS);
  expect(n()).toBe(2);
  moodsPollChange(-1);
});

it('a join after the wait has passed reads at once', async () => {
  record('wall2_office_moods', () => offAnswer(false));
  record('wall2_office_off', () => offAnswer(true));
  const n = () => calls.filter((c) => c.command === 'wall2_office_moods').length;
  moodsPollChange(1);
  await flush();
  await useHome.getState().applyOff();
  moodsPollChange(-1);
  await flush(OFF_READ_DELAY_MS + 100);
  const before = n();
  moodsPollChange(1);
  await flush();
  expect(n()).toBe(before + 1);
  moodsPollChange(-1);
});

it('a token change reads the moods only while the moods poll has users', async () => {
  mocks.set('wall2_desk_token_status', () => ({ set: true, unreadable: false }));
  await useHome.getState().tokenChanged();
  expect(calls.filter((c) => c.command === 'wall2_office_moods')).toHaveLength(0);
  moodsPollChange(1);
  await flush();
  const n = calls.filter((c) => c.command === 'wall2_office_moods').length;
  await useHome.getState().tokenChanged();
  expect(calls.filter((c) => c.command === 'wall2_office_moods')).toHaveLength(n + 1);
  moodsPollChange(-1);
});

// Section: the offer

const joinSurface = async () => {
  homePollChange(1);
  await flush();
};
const startTimer = () => useOnAirStore.setState((s) => ({ saved: { ...s.saved, running: true, startedAt: Date.now(), firstStartAt: s.saved.firstStartAt ?? Date.now(), stoppedAt: null } }));
/** The Stop button: the time is kept, the timer is no longer running. */
const stopTimer = () => useOnAirStore.setState((s) => ({ saved: { ...s.saved, running: false, startedAt: null, accumulatedMs: 5000, stoppedAt: Date.now() } }));
/** Reset: back to 00:00, only after a stop. */
const resetTimer = () => useOnAirStore.setState((s) => ({ saved: { ...s.saved, running: false, startedAt: null, accumulatedMs: 0, firstStartAt: null, stoppedAt: null } }));

it('the timer starting with nothing set raises the start offer after a fresh read, and it goes away by itself after 60 seconds', async () => {
  await joinSurface();
  startTimer();
  await flush();
  expect(useHome.getState().offer).toEqual({ kind: 'start', what: 'timer', label: null });
  await flush(OFFER_MS - 10);
  expect(useHome.getState().offer).not.toBeNull();
  await flush(20);
  expect(useHome.getState().offer).toBeNull();
});

it('a recording starting raises it too, and an ending recording with a preset on raises the stop offer', async () => {
  await joinSurface();
  useSignalStore.setState({ recording: true });
  await flush();
  expect(useHome.getState().offer?.what).toBe('recording');
  useHome.getState().dismissOffer();
  answer = studioWith('onAir');
  useSignalStore.setState({ recording: false });
  await flush();
  expect(useHome.getState().offer).toEqual({ kind: 'stop', what: 'recording', label: 'On air' });
});

it('the timer stopping with a preset on raises the stop offer; with nothing on it raises none', async () => {
  answer = studioWith('onAir');
  await joinSurface();
  startTimer();
  await flush();
  expect(useHome.getState().offer).toBeNull(); // a preset is already on: no start offer
  stopTimer();
  await flush();
  expect(useHome.getState().offer).toMatchObject({ kind: 'stop', what: 'timer' });
  useHome.getState().dismissOffer();
  answer = studioAnswer();
  startTimer();
  await flush();
  useHome.getState().dismissOffer();
  stopTimer();
  await flush();
  expect(useHome.getState().offer).toBeNull();
});

it('an offer comes once per start and once per stop, not on every poll', async () => {
  await joinSurface();
  startTimer();
  await flush();
  useHome.getState().dismissOffer();
  await flush(HOME_READ_EVERY_MS * 3);
  await joinSurface();
  expect(useHome.getState().offer).toBeNull();
  // The same running state set again is not a start.
  startTimer();
  await flush();
  expect(useHome.getState().offer).toBeNull();
});

it('no offer while the home part is absent, away, without a token, or without an On air preset', async () => {
  const tries: [string, () => void][] = [
    ['absent', () => (mocks.set('wall2_studio', () => { throw 'absent'; }))],
    ['away', () => (mocks.set('wall2_studio', () => { throw 'unreachable'; }))],
    ['no token', () => (answer = studioAnswer({ canWrite: false, writeBlock: 'not-set-up' }))],
    ['no On air', () => (answer = studioAnswer({ presets: [{ id: 'recording', label: 'Recording', line: 'x', active: false, setsKeyLights: false }] }))],
  ];
  for (const [name, setup] of tries) {
    resetHome();
    answer = studioAnswer();
    mocks.set('wall2_studio', () => answer);
    setup();
    await joinSurface();
    startTimer();
    await flush();
    expect(useHome.getState().offer, name).toBeNull();
    stopTimer();
    await flush();
  }
});

it('a timer restored from storage at launch, and the first signal answer, are not starts', async () => {
  await joinSurface();
  useOnAirStore.setState((s) => ({ saved: { ...s.saved, running: true, startedAt: Date.now() - 60 * 60_000 } }));
  await flush();
  expect(useHome.getState().offer).toBeNull();
  useOnAirStore.setState((s) => ({ saved: { ...s.saved, running: false, startedAt: null } }));
  useHome.getState().dismissOffer();
  useSignalStore.setState({ known: false, recording: false });
  await flush();
  useSignalStore.setState({ known: true, recording: true });
  await flush();
  expect(useHome.getState().offer).toBeNull();
});

it('no read and no offer while the page is hidden', async () => {
  await joinSurface();
  const n = reads();
  Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
  try {
    startTimer();
    await flush();
    expect(reads()).toBe(n);
    expect(useHome.getState().offer).toBeNull();
  } finally {
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  }
});

it('nothing is applied by an offer until it is clicked: the preset write count stays zero', async () => {
  await joinSurface();
  startTimer();
  await flush();
  expect(useHome.getState().offer).not.toBeNull();
  await flush(OFFER_MS + 10);
  expect(calls.filter((c) => c.command === 'wall2_studio_preset' || c.command === 'wall2_studio_normal')).toHaveLength(0);
});

// Section: fix round, offers

const deferred = () => {
  const out: { resolve: (v: unknown) => void }[] = [];
  mocks.set('wall2_studio', () => new Promise((r) => out.push({ resolve: r })));
  return out;
};

it('a recording that started and ended before the first read came back leaves no offer', async () => {
  homePollChange(1);
  await flush();
  const pending = deferred();
  useSignalStore.setState({ recording: true });
  await flush();
  useSignalStore.setState({ recording: false });
  await flush();
  for (const p of pending) p.resolve(studioAnswer());
  await flush();
  expect(useHome.getState().offer).toBeNull();
});

it('an offer the opposite edge made obsolete is cleared', async () => {
  homePollChange(1);
  await flush();
  useSignalStore.setState({ recording: true });
  await flush();
  expect(useHome.getState().offer?.kind).toBe('start');
  answer = studioAnswer();
  useSignalStore.setState({ recording: false });
  await flush();
  expect(useHome.getState().offer).toBeNull();
});

it('Stop with a preset on raises the stop offer; Start after it with the preset still on raises nothing', async () => {
  answer = studioWith('onAir');
  homePollChange(1);
  startTimer();
  await flush();
  expect(useHome.getState().offer).toBeNull();
  stopTimer();
  await flush();
  expect(useHome.getState().offer).toMatchObject({ kind: 'stop', what: 'timer', label: 'On air' });
  useHome.getState().dismissOffer();
  startTimer();
  await flush();
  expect(useHome.getState().offer).toBeNull();
});

it('Start after a Stop with no preset on raises the start offer: carrying on counts as a start', async () => {
  homePollChange(1);
  startTimer();
  await flush();
  useHome.getState().dismissOffer();
  stopTimer();
  await flush();
  expect(useHome.getState().offer).toBeNull();
  startTimer();
  await flush();
  expect(useHome.getState().offer).toMatchObject({ kind: 'start', what: 'timer' });
});

it('Reset raises nothing more, not a stop offer and never a start offer', async () => {
  answer = studioWith('onAir');
  homePollChange(1);
  startTimer();
  await flush();
  stopTimer();
  await flush();
  useHome.getState().dismissOffer();
  resetTimer();
  await flush();
  expect(useHome.getState().offer).toBeNull();
  answer = studioAnswer();
  resetTimer();
  await flush();
  expect(useHome.getState().offer).toBeNull();
});

it('a start, a stop with no preset on, the start offer dismissed, then Reset: no offer of any kind', async () => {
  homePollChange(1);
  startTimer();
  await flush();
  expect(useHome.getState().offer).toMatchObject({ kind: 'start', what: 'timer' });
  stopTimer();
  await flush();
  useHome.getState().dismissOffer();
  expect(useHome.getState().offer).toBeNull();
  resetTimer();
  await flush();
  expect(useHome.getState().offer).toBeNull();
});

it('a timer that stopped itself at 24 hours is a stop', async () => {
  answer = studioWith('onAir');
  homePollChange(1);
  startTimer();
  await flush();
  useOnAirStore.setState((s) => ({ saved: { ...s.saved, running: false, startedAt: null, accumulatedMs: 24 * 3600_000 } }));
  await flush();
  expect(useHome.getState().offer).toMatchObject({ kind: 'stop', what: 'timer' });
});

it('a quick Stop then Start before the read returns leaves no stop offer standing', async () => {
  answer = studioWith('onAir');
  homePollChange(1);
  startTimer();
  await flush();
  useHome.getState().dismissOffer();
  const pending = deferred();
  stopTimer();
  await flush();
  startTimer();
  await flush();
  for (const p of pending) p.resolve(studioWith('onAir'));
  await flush();
  expect(useHome.getState().offer).toBeNull();
});

it('no read and no offer on an edge while no studio surface is shown; a surface that shows within seconds gets the offer', async () => {
  useSignalStore.setState({ recording: true });
  await flush();
  expect(reads()).toBe(0);
  expect(useHome.getState().offer).toBeNull();
  // The chip mounts a moment later: its read settles the edge.
  homePollChange(1);
  await flush();
  expect(reads()).toBe(1);
  expect(useHome.getState().offer).toMatchObject({ kind: 'start', what: 'recording' });
});

it('an edge that nobody showed is forgotten after a while', async () => {
  useSignalStore.setState({ recording: true });
  await flush(20_000);
  homePollChange(1);
  await flush();
  expect(useHome.getState().offer).toBeNull();
});

// Section: fix round, a refused action says why

it('a refused action says why in fixed words, then reads again', async () => {
  await useHome.getState().readStudio();
  const cases: [string, string][] = [
    ['refused', TEXT.refused],
    ['unknown', TEXT.unknown],
    ['not-set-up', TEXT.writeNotSetUp],
    ['needs-private-address', TEXT.needsPrivate],
    ['nothing-to-undo', TEXT.nothingToUndo],
  ];
  for (const [word, text] of cases) {
    const n = await refuse(word, () => useHome.getState().applyPreset('onAir'));
    expect(n, word).toBe(1);
    expect(useHome.getState().note, word).toBe(text);
    await flush(NOTE_MS + 10);
  }
  expect(TEXT.needsPrivate).toBe('The desk token goes only to this PC or a tailnet address.');
  expect(JSON.stringify(TEXT)).not.toMatch(/https?:\/\//);
});

it('key light writes through the home app wait their turn behind a preset', async () => {
  await useHome.getState().readStudio();
  const { homeBackend } = await import('./keyLights');
  const releases: (() => void)[] = [];
  mocks.set('wall2_studio_preset', (args) => {
    calls.push({ command: 'wall2_studio_preset', args });
    return new Promise((r) => releases.push(() => r(answer)));
  });
  record('wall2_studio_keys', () => studioAnswer({ keys: { canSet: true, left: { on: true, brightness: 50, kelvin: 4000 }, right: { on: true, brightness: 50, kelvin: 4000 } } }));
  const preset = useHome.getState().applyPreset('onAir');
  const keys = homeBackend.set('both', { brightness: 50 });
  await flush();
  expect(calls.filter((c) => c.command === 'wall2_studio_keys')).toHaveLength(0);
  releases[0]();
  await preset;
  await keys;
  expect(calls.filter((c) => c.command === 'wall2_studio_keys')).toHaveLength(1);
});

it('a replaced slider write goes to the end of the queue: slider 1, preset, slider 2 sends the preset, then slider 2, and never slider 1', async () => {
  await useHome.getState().readStudio();
  const releases: (() => void)[] = [];
  const sent: string[] = [];
  const hold = (command: string, label: (a?: Record<string, unknown>) => string) =>
    mocks.set(command, (args) => {
      sent.push(label(args));
      return new Promise((r) => releases.push(() => r(answer)));
    });
  hold('wall2_studio_look', (a) => `look ${a?.id}`);
  hold('wall2_studio_preset', (a) => `preset ${a?.id}`);
  hold('wall2_studio_group', (a) => `slider ${(a as { level: number }).level}`);
  const running = useHome.getState().applyLook('calm'); // runs now and holds the queue
  const one = useHome.getState().setGroup('overhead', true, 50);
  const preset = useHome.getState().applyPreset('onAir');
  const two = useHome.getState().setGroup('overhead', true, 70);
  await flush();
  expect(sent).toEqual(['look calm']);
  expect(useHome.getState().writes).toBe(3);
  for (let i = 0; i < 6; i++) {
    releases.splice(0).forEach((r) => r());
    await flush();
  }
  await Promise.all([running, one, preset, two]);
  expect(sent).toEqual(['look calm', 'preset onAir', 'slider 70']);
  expect(useHome.getState().writes).toBe(0);
});

const nudgeAnswer = (level: number) => ({
  stale: false,
  moods: [{ id: 'brightDesk', label: 'Bright desk', line: 'Room 70%', active: true }],
  nudge: { mood: 'brightDesk', level, floor: 45, step: 10 },
  canWrite: true,
  writeBlock: null,
});
const nudgeCalls = () => calls.filter((c) => c.command === 'wall2_office_mood_nudge');

it('nudgeMood: sends the direction, the answer replaces the moods, and no apply spinner key is used for a card', async () => {
  record('wall2_office_moods', () => nudgeAnswer(62));
  let release: (() => void) | undefined;
  record('wall2_office_mood_nudge', () => new Promise((r) => (release = () => r(nudgeAnswer(72)))));
  await useHome.getState().readMoods();
  const n = calls.filter((c) => c.command === 'wall2_office_moods').length;
  const done = useHome.getState().nudgeMood('up');
  await flush();
  expect(useHome.getState().applying).toBe(`${OFFICE_NUDGE}-up`);
  release?.();
  await done;
  expect(nudgeCalls().map((c) => c.args)).toEqual([{ dir: 'up' }]);
  expect(useHome.getState().moods?.nudge?.level).toBe(72);
  expect(useHome.getState().applying).toBeNull();
  expect(calls.filter((c) => c.command === 'wall2_office_moods')).toHaveLength(n);
});

it('nudgeMood: a click while a write is out is ignored', async () => {
  record('wall2_office_moods', () => nudgeAnswer(62));
  let release: (() => void) | undefined;
  record('wall2_office_mood_nudge', () => new Promise((r) => (release = () => r(nudgeAnswer(72)))));
  await useHome.getState().readMoods();
  const first = useHome.getState().nudgeMood('up');
  await flush();
  void useHome.getState().nudgeMood('down');
  void useHome.getState().nudgeMood('up');
  await flush();
  expect(nudgeCalls()).toHaveLength(1);
  release?.();
  await first;
  expect(useHome.getState().applying).toBeNull();
});

it('nudgeMood: a refusal sets moodFail for 5 seconds, reads again, and keeps what the home app reports', async () => {
  record('wall2_office_moods', () => nudgeAnswer(45));
  record('wall2_office_mood_nudge', () => {
    throw 'at-floor';
  });
  await useHome.getState().readMoods();
  const n = calls.filter((c) => c.command === 'wall2_office_moods').length;
  await useHome.getState().nudgeMood('down');
  expect(useHome.getState().moodFail).toEqual({ id: `${OFFICE_NUDGE}-down`, word: 'at-floor' });
  expect(calls.filter((c) => c.command === 'wall2_office_moods')).toHaveLength(n + 1);
  expect(useHome.getState().moods?.nudge?.level).toBe(45);
  await flush(NOTE_MS + 10);
  expect(useHome.getState().moodFail).toBeNull();
});
