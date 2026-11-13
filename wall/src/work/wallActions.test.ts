import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mocks } from '../bridge/tauri';
import { lane, summary } from '../agents/fixtures';
import { resetSnooze, snooze } from '../agents/snooze';
import { resetAgents, useAgentsStore } from '../agents/useAgents';
import { useFocusStore } from '../focus/store';
import { NEEDS_CONFIRM } from '../home/soundModel';
import { usePlaceStore } from '../state/places';
import { useDeckStore } from './deckStore';
import { useMeetingFeed } from './useNextMeeting';
import { ActionError, runWallAction } from './wallActions';

const NOW = new Date(2026, 10, 12, 9, 0).getTime();
let calls: [string, unknown][];
const track = (name: string, answer: unknown = undefined) => mocks.set(name, (a) => (calls.push([name, a]), typeof answer === 'function' ? (answer as (x: unknown) => unknown)(a) : answer));
const fails = (name: string, e: unknown = 'boom') =>
  mocks.set(name, () => {
    throw e;
  });
const refusal = async (name: string): Promise<string> => {
  try {
    await runWallAction(name, NOW);
  } catch (e) {
    expect(e).toBeInstanceOf(ActionError);
    return (e as Error).message;
  }
  throw new Error(`${name} did not refuse`);
};
const meeting = (over = {}) => ({ key: 'm1', accountId: 'a', title: 'T', start: new Date(NOW + 5 * 60_000).toISOString(), end: new Date(NOW + 35 * 60_000).toISOString(), canJoin: true, ...over });
const feed = (over = {}) => useMeetingFeed.setState({ meetings: [meeting()], feedStale: false, failed: false, asOf: NOW, noCalendar: false, reads: 1, ...over });

beforeEach(() => {
  calls = [];
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  resetAgents();
  resetSnooze();
  useDeckStore.getState().clearApplied();
  useFocusStore.getState().dispose();
  useFocusStore.getState().init();
  usePlaceStore.setState({ active: 'work', from: 'work' });
});
afterEach(() => {
  useFocusStore.getState().dispose();
  resetAgents();
  resetSnooze();
  vi.useRealTimers();
  mocks.clear();
});

it('layouts run through the arrange command and answer how many windows moved; undo puts them back', async () => {
  track('wall2_arrange', { moved: 2, asked: 3 });
  expect(await runWallAction('layout:thirds')).toBe('2 of 3 windows arranged');
  expect(await runWallAction('layout:focus')).toBe('2 of 3 windows arranged');
  expect(await runWallAction('layout:record169')).toBe('2 of 3 windows arranged');
  expect(calls.map((c) => c[1])).toEqual([{ layout: 'thirds' }, { layout: 'focus' }, { layout: 'record' }]);
  expect(useDeckStore.getState().applied).toMatchObject({ action: 'layout:record169', until: NOW + 60_000 });
  track('wall2_arrange_undo', 3);
  expect(await runWallAction('layout:undo')).toBe('3 windows put back');
  expect(useDeckStore.getState().applied).toBeNull();
});

it('a layout refusal is one fixed line and leaves no Undo', async () => {
  for (const [word, line] of [
    ['no big screen', 'No big screen found'],
    ['no windows', 'No windows to arrange on the big screen'],
    ['busy', 'Still arranging, try again in a moment'],
    ['weird', 'Could not arrange the windows'],
  ]) {
    fails('wall2_arrange', word);
    expect(await refusal('layout:thirds')).toBe(line);
  }
  expect(useDeckStore.getState().applied).toBeNull();
  fails('wall2_arrange_undo', 'nothing to undo');
  expect(await refusal('layout:undo')).toBe('Nothing to undo');
});

it('screens off asks for them off once, and says so when they already are', async () => {
  track('wall2_monitors_mode', { active: false });
  track('wall2_monitors_off');
  expect(await runWallAction('screens-off')).toBe('Screens going off');
  expect(calls.map((c) => c[0])).toEqual(['wall2_monitors_mode', 'wall2_monitors_off']);
  track('wall2_monitors_mode', { active: true });
  expect(await refusal('screens-off')).toBe('Screens are already off');
  track('wall2_monitors_mode', { active: false });
  fails('wall2_monitors_off');
  expect(await refusal('screens-off')).toBe('Could not turn the screens off');
});

it('the focus actions start at the default, 25 or 50 minutes, refuse a second start, and stop only a running session', async () => {
  expect(await refusal('focus:stop')).toBe('No focus session to stop');
  expect(await runWallAction('focus:start')).toBe('Focus started, 25 min');
  expect(useFocusStore.getState().state.status).toBe('running');
  expect(await refusal('focus:start')).toBe('Focus is already going');
  expect(await refusal('focus:50')).toBe('Focus is already going');
  expect(await runWallAction('focus:stop')).toBe('Focus stopped');
  expect(useFocusStore.getState().state.status).toBe('idle');
  expect(await runWallAction('focus:50')).toBe('Focus started, 50 min');
  await runWallAction('focus:stop');
  expect(await runWallAction('focus:25')).toBe('Focus started, 25 min');
});

it('mixer, pause everything, moods and OmniGent each call their existing command, and refuse in one line when it fails', async () => {
  track('open_volume_mixer');
  track('wall2_sonos_pause_all');
  track('wall2_apply_mood');
  track('wall2_focus_omnigent');
  expect(await runWallAction('mixer')).toBe('Volume mixer opened');
  expect(await runWallAction('sonos:pause-all')).toBe('Paused every speaker');
  expect(await runWallAction('mood:evening')).toBe('Lights set');
  expect(await runWallAction('omnigent:front')).toBe('OmniGent brought forward');
  expect(calls).toEqual([
    ['open_volume_mixer', undefined],
    ['wall2_sonos_pause_all', undefined],
    ['wall2_apply_mood', { id: 'evening' }],
    ['wall2_focus_omnigent', { id: null }],
  ]);
  for (const [name, command, line] of [
    ['mixer', 'open_volume_mixer', 'Could not open the mixer'],
    ['sonos:pause-all', 'wall2_sonos_pause_all', 'Could not pause the speakers'],
    ['mood:evening', 'wall2_apply_mood', 'Could not set the lights'],
    ['omnigent:front', 'wall2_focus_omnigent', 'Could not bring OmniGent forward'],
  ]) {
    fails(command);
    expect(await refusal(name)).toBe(line);
  }
});

const music = [{ key: 'k1', name: 'Evening Jazz', favorite: null, volume: 20 }];
const sonos = (readAtMs = NOW) => ({ speakers: [], groups: [], presets: [], music, controls: [], scenes: [], sleepTimers: [], nowPlaying: null, currentGroup: null, readAtMs });

it('play what suits the hour plays the suggested routine, never bypasses a confirm, and refuses stale or skipped', async () => {
  track('wall2_sonos_summary', () => sonos());
  track('wall2_sonos_play', { started: true, reason: null });
  vi.setSystemTime(new Date(2026, 10, 12, 20, 0));
  const t = Date.now();
  track('wall2_sonos_summary', () => sonos(t));
  expect(await runWallAction('sonos:play-suggested')).toBe('Playing Evening Jazz');
  expect(calls.find((c) => c[0] === 'wall2_sonos_play')![1]).toEqual({ routineKey: 'k1' });
  // A loud routine needs a confirm: the key sends none and opens Home, where the confirm lives.
  fails('wall2_sonos_play', NEEDS_CONFIRM);
  expect(await refusal('sonos:play-suggested')).toBe('Loud: confirm it on Home');
  expect(usePlaceStore.getState().active).toBe('home');
  track('wall2_sonos_play', { started: false, reason: 'quiet hours' });
  expect(await refusal('sonos:play-suggested')).toBe('Skipped: quiet hours');
  track('wall2_sonos_summary', () => sonos(t - 10 * 60_000));
  expect(await refusal('sonos:play-suggested')).toBe('Sound data is out of date');
  fails('wall2_sonos_summary');
  expect(await refusal('sonos:play-suggested')).toBe('Sound is not answering');
  vi.setSystemTime(new Date(2026, 10, 12, 3, 0));
  const n = Date.now();
  track('wall2_sonos_summary', () => ({ ...sonos(n), music: [] }));
  expect(await refusal('sonos:play-suggested')).toBe('Nothing suits this hour');
});

it('the task actions open the first of Next three by its id', async () => {
  track('wall2_tasks_next', [{ id: 't1' }, { id: 't2' }]);
  track('wall2_open_task');
  expect(await runWallAction('task:first')).toBe('Opened your first task');
  expect(await runWallAction('tasks:open')).toBe('Opened your first task');
  expect(calls.filter((c) => c[0] === 'wall2_open_task').map((c) => c[1])).toEqual([{ id: 't1' }, { id: 't1' }]);
  track('wall2_tasks_next', []);
  expect(await refusal('task:first')).toBe('No tasks to open');
  track('wall2_tasks_next', { not: 'a list' });
  expect(await refusal('tasks:open')).toBe('No tasks to open');
  fails('wall2_tasks_next');
  expect(await refusal('task:first')).toBe('The task app is not answering');
  track('wall2_tasks_next', [{ id: 't1' }]);
  fails('wall2_open_task');
  expect(await refusal('task:first')).toBe('Could not open the task');
});

const waiting = (over = {}) =>
  summary({
    now: new Date(NOW).toISOString(),
    yourMove: { total: 2, first: null, ids: ['w1', 'w2'] },
    lanes: [lane({ id: 'w1', waiting: true }), lane({ id: 'w2', waiting: true })],
    ...over,
  });

it('open what waits opens the first session not snoozed, and refuses with no helper, a stale one, or nothing waiting', async () => {
  track('wall2_focus_omnigent');
  expect(await refusal('agents:open-waiting')).toBe('The agents helper is not answering');
  useAgentsStore.setState({ status: 'ready', summary: waiting(), readFailed: false, awaiting: false });
  expect(await runWallAction('agents:open-waiting', NOW)).toBe('Opened the chat');
  snooze('w1', waiting(), NOW);
  expect(await runWallAction('agents:open-waiting', NOW)).toBe('Opened the chat');
  expect(calls.map((c) => c[1])).toEqual([{ id: 'w1' }, { id: 'w2' }]);
  useAgentsStore.setState({ readFailed: true });
  expect(await refusal('agents:open-waiting')).toBe('The agents helper is not answering');
  useAgentsStore.setState({ readFailed: false, summary: waiting({ yourMove: { total: 0, first: null }, lanes: [lane()] }) });
  expect(await refusal('agents:open-waiting')).toBe('Nothing is waiting on you');
});

it('join and open the event use the next meeting, and refuse an out-of-date list, no meeting, or no link', async () => {
  track('wall2_meet_join');
  track('wall2_open_event');
  feed();
  expect(await runWallAction('meet:join-next', NOW)).toBe('Joining the meeting');
  expect(await runWallAction('event:open-next', NOW)).toBe('Opened the event');
  expect(calls).toEqual([
    ['wall2_meet_join', { key: 'm1' }],
    ['wall2_open_event', { key: 'm1' }],
  ]);
  feed({ meetings: [meeting({ canJoin: false })] });
  expect(await refusal('meet:join-next')).toBe('That meeting has no join link');
  expect(await runWallAction('event:open-next', NOW)).toBe('Opened the event');
  feed({ meetings: [] });
  expect(await refusal('meet:join-next')).toBe('No meeting coming up');
  for (const stale of [{ feedStale: true }, { failed: true }, { noCalendar: true }]) {
    feed(stale);
    expect(await refusal('event:open-next')).toBe('The meeting list is out of date');
  }
  feed();
  fails('wall2_meet_join');
  expect(await refusal('meet:join-next')).toBe('Could not open the meeting');
});

it('zen and dream change the place', async () => {
  expect(await runWallAction('zen')).toBe('Zen opened');
  expect(usePlaceStore.getState().active).toBe('zen');
  usePlaceStore.setState({ active: 'work', from: 'work', zenDream: false });
  expect(await runWallAction('dream')).toBe('Dream opened');
  expect(usePlaceStore.getState()).toMatchObject({ active: 'zen', zenDream: true });
});

it('a name outside the list does nothing', async () => {
  expect(await refusal('lock')).toBe('That key does nothing here');
  for (const bad of ['', 'rm', 'open:https://x', 'task:add']) expect(await refusal(bad)).toBe('That key does nothing here');
  expect(calls).toEqual([]);
});
