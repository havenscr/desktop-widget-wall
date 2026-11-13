import { invoke } from '../bridge/tauri';
import { agentsStale, useAgentsStore } from '../agents/useAgents';
import { snoozedAt, useSnoozeStore } from '../agents/snooze';
import { waitingIds } from '../agents/model';
import { useFocusStore } from '../focus/store';
import { suggestedKey, chipLabel, NEEDS_CONFIRM, STALE_MS, type PlayResult, type SonosSummary } from '../home/soundModel';
import { nextMeeting } from '../meet/model';
import { usePlaceStore } from '../state/places';
import { useMeetingFeed } from './useNextMeeting';
import { arrangedText, arrangeReason, errorText, windowsText } from './deckModel';
import { useDeckStore } from './deckStore';

/** A wall action that cannot run now. `message` is one short fixed line for the row. */
export class ActionError extends Error {}

const refuse = (message: string): never => {
  throw new ActionError(message);
};

const LAYOUTS: Record<string, string> = { 'layout:thirds': 'thirds', 'layout:focus': 'focus', 'layout:record169': 'record' };

/** The meeting the wall calls next, only when its list can be trusted. */
function nextJoinable(now: number) {
  const feed = useMeetingFeed.getState();
  if (feed.noCalendar || feed.failed || feed.feedStale) return refuse('The meeting list is out of date');
  const m = nextMeeting(feed.meetings, now);
  return m ?? refuse('No meeting coming up');
}

/** The first task of "Next three", read fresh; its id came from the task read Rust remembers. */
async function firstTaskId(): Promise<string> {
  let list: unknown;
  try {
    list = await invoke<unknown>('wall2_tasks_next');
  } catch {
    return refuse('The task app is not answering');
  }
  const first = Array.isArray(list) ? (list as { id?: unknown }[])[0] : undefined;
  return typeof first?.id === 'string' ? first.id : refuse('No tasks to open');
}

export async function viaCommand(command: string, args: Record<string, unknown> | undefined, done: string, failed: string): Promise<string> {
  try {
    await invoke(command, args);
  } catch {
    return refuse(failed);
  }
  return done;
}

async function playSuggested(): Promise<string> {
  let s: SonosSummary;
  try {
    s = await invoke<SonosSummary>('wall2_sonos_summary');
  } catch {
    return refuse('Sound is not answering');
  }
  if (!s || !Array.isArray(s.music) || Date.now() - s.readAtMs > STALE_MS) return refuse('Sound data is out of date');
  const key = suggestedKey(s.music, new Date());
  const routine = s.music.find((r) => r.key === key);
  if (!routine) return refuse('Nothing suits this hour');
  try {
    const a = await invoke<PlayResult>('wall2_sonos_play', { routineKey: routine.key });
    return a?.started === false ? refuse(a.reason ? `Skipped: ${a.reason}` : 'Skipped, see Home') : `Playing ${chipLabel(routine.name)}`;
  } catch (e) {
    if (e instanceof ActionError) throw e;
    // A key never bypasses a confirm: a loud routine is confirmed on Home's own control.
    if (errorText(e) === NEEDS_CONFIRM) {
      usePlaceStore.getState().setActive('home');
      return refuse('Loud: confirm it on Home');
    }
    return refuse('Could not start the music');
  }
}

/**
 * Runs one wall action by its fixed name, through the command or store the wall already has
 * for it, and answers with one short line. A refusal throws `ActionError` with a fixed line.
 * Nothing here is new power: each action is what a visible control already does.
 */
export async function runWallAction(name: string, now: number = Date.now()): Promise<string> {
  const layout = LAYOUTS[name];
  if (layout) {
    try {
      const r = await invoke<{ moved: number; asked: number }>('wall2_arrange', { layout });
      const text = arrangedText(r);
      useDeckStore.getState().setApplied(name, text);
      return text;
    } catch (e) {
      return refuse(arrangeReason(errorText(e)));
    }
  }
  if (name.startsWith('mood:')) {
    const id = name.slice(5);
    return viaCommand('wall2_apply_mood', { id }, 'Lights set', 'Could not set the lights');
  }
  switch (name) {
    case 'layout:undo':
      try {
        const n = await invoke<number>('wall2_arrange_undo');
        useDeckStore.getState().clearApplied();
        return windowsText(typeof n === 'number' ? n : 0, 'put back');
      } catch (e) {
        return refuse(arrangeReason(errorText(e)));
      }
    case 'screens-off': {
      let active = false;
      try {
        active = (await invoke<{ active: boolean }>('wall2_monitors_mode'))?.active === true;
      } catch {
        // Unknown: ask for them off, as the Unwind button does.
      }
      return active ? refuse('Screens are already off') : viaCommand('wall2_monitors_off', undefined, 'Screens going off', 'Could not turn the screens off');
    }
    case 'focus:start':
    case 'focus:25':
    case 'focus:50': {
      const f = useFocusStore.getState();
      if (f.state.status === 'running' || f.state.status === 'paused') return refuse('Focus is already going');
      if (name !== 'focus:start') f.setMinutes(name === 'focus:25' ? 25 : 50);
      useFocusStore.getState().start();
      return `Focus started, ${useFocusStore.getState().state.minutes} min`;
    }
    case 'focus:stop': {
      const f = useFocusStore.getState();
      if (f.state.status !== 'running' && f.state.status !== 'paused') return refuse('No focus session to stop');
      f.reset();
      return 'Focus stopped';
    }
    case 'mixer':
      return viaCommand('open_volume_mixer', undefined, 'Volume mixer opened', 'Could not open the mixer');
    case 'sonos:pause-all':
      return viaCommand('wall2_sonos_pause_all', undefined, 'Paused every speaker', 'Could not pause the speakers');
    case 'sonos:play-suggested':
      return playSuggested();
    case 'tasks:open':
    case 'task:first': {
      const id = await firstTaskId();
      return viaCommand('wall2_open_task', { id }, 'Opened your first task', 'Could not open the task');
    }
    case 'omnigent:front':
      return viaCommand('wall2_focus_omnigent', { id: null }, 'OmniGent brought forward', 'Could not bring OmniGent forward');
    case 'agents:open-waiting': {
      const st = useAgentsStore.getState();
      if (!st.summary || agentsStale(st)) return refuse('The agents helper is not answering');
      const quiet = snoozedAt(useSnoozeStore.getState().entries, now);
      const ids = waitingIds(st.summary);
      const id = ids.find((i) => !quiet.has(i)) ?? ids[0];
      if (!id) return refuse('Nothing is waiting on you');
      return viaCommand('wall2_focus_omnigent', { id }, 'Opened the chat', 'Could not open the chat');
    }
    case 'meet:join-next': {
      const m = nextJoinable(now);
      if (!m.canJoin) return refuse('That meeting has no join link');
      return viaCommand('wall2_meet_join', { key: m.key }, 'Joining the meeting', 'Could not open the meeting');
    }
    case 'event:open-next': {
      const m = nextJoinable(now);
      return viaCommand('wall2_open_event', { key: m.key }, 'Opened the event', 'Could not open the event');
    }
    case 'zen':
      usePlaceStore.getState().setActive('zen');
      return 'Zen opened';
    case 'dream':
      usePlaceStore.getState().openDream();
      return 'Dream opened';
    default:
      return refuse('That key does nothing here');
  }
}
