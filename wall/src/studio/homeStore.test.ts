import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mocks } from '../bridge/tauri';
import { useOnAirStore } from '../onair/store';
import { useSignalStore } from '../signals/store';
import { studioAnswer, studioWith } from './homeKit';
import { canChange, HOME_READ_EVERY_MS, homePollChange, homeView, moodsPollChange, OFFER_MS, resetHome, TEXT, useHome } from './homeStore';
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
  useOnAirStore.setState((s) => ({ saved: { ...s.saved, running: false, startedAt: null } }));
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
  record('wall2_office_moods', () => ({ stale: false, moods: [{ id: 'focus', label: 'Focus', line: 'Room 70%', active: false }], canWrite: true, writeBlock: null }));
  record('wall2_office_mood', (args) => {
    if (writeWord) throw writeWord;
    return { stale: false, moods: [{ id: 'focus', label: 'Focus', line: 'Room 70%', active: args?.id === 'focus' }], canWrite: true, writeBlock: null };
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
  expect(useHome.getState().moods?.moods.map((m) => m.id)).toEqual(['focus']);
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

it('a preset that sets the key lights, and Back to normal, read the key lights again; a look does not', async () => {
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

it('an unknown id or nothing to undo: a fresh read at once and no line; a plain failure says so', async () => {
  await useHome.getState().readStudio();
  expect(await refuse('unknown', () => useHome.getState().applyLook('calm'))).toBe(1);
  expect(await refuse('nothing-to-undo', () => useHome.getState().goNormal())).toBe(1);
  expect(useHome.getState().note).toBeNull();
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
  // The moods are not read from Tools: that row is not built yet.
  expect(calls.filter((c) => c.command === 'wall2_office_moods')).toHaveLength(0);
});

it('office moods: a refused apply keeps the chip as read back and names the word for 5 seconds', async () => {
  await useHome.getState().readMoods();
  expect(useHome.getState().moods?.moods[0].active).toBe(false);
  writeWord = 'not-answering';
  await useHome.getState().applyMood('focus');
  await flush();
  expect(useHome.getState().moodFail).toEqual({ id: 'focus', word: 'not-answering' });
  expect(useHome.getState().moods?.moods[0].active).toBe(false);
  await flush(NOTE_MS + 10);
  expect(useHome.getState().moodFail).toBeNull();
  writeWord = null;
  await useHome.getState().applyMood('focus');
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

// Section: the offer

const startTimer = () => useOnAirStore.setState((s) => ({ saved: { ...s.saved, running: true, startedAt: Date.now() } }));
const stopTimer = () => useOnAirStore.setState((s) => ({ saved: { ...s.saved, running: false, startedAt: null } }));

it('the timer starting with nothing set raises the start offer after a fresh read, and it goes away by itself after 60 seconds', async () => {
  await useHome.getState().readStudio();
  startTimer();
  await flush();
  expect(useHome.getState().offer).toEqual({ kind: 'start', what: 'timer', label: null });
  await flush(OFFER_MS - 10);
  expect(useHome.getState().offer).not.toBeNull();
  await flush(20);
  expect(useHome.getState().offer).toBeNull();
});

it('a recording starting raises it too, and an ending recording with a preset on raises the stop offer', async () => {
  await useHome.getState().readStudio();
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
  await useHome.getState().readStudio();
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
  await useHome.getState().readStudio();
  startTimer();
  await flush();
  useHome.getState().dismissOffer();
  await flush(HOME_READ_EVERY_MS * 3);
  await useHome.getState().readStudio();
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
    await useHome.getState().readStudio();
    startTimer();
    await flush();
    expect(useHome.getState().offer, name).toBeNull();
    stopTimer();
    await flush();
  }
});

it('a timer restored from storage at launch, and the first signal answer, are not starts', async () => {
  await useHome.getState().readStudio();
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
  await useHome.getState().readStudio();
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
  await useHome.getState().readStudio();
  startTimer();
  await flush();
  expect(useHome.getState().offer).not.toBeNull();
  await flush(OFFER_MS + 10);
  expect(calls.filter((c) => c.command === 'wall2_studio_preset' || c.command === 'wall2_studio_normal')).toHaveLength(0);
});
