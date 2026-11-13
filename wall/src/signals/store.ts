import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { create } from 'zustand';
import { invoke, isTauri } from '../bridge/tauri';
import { useMeetingFeed } from '../work/useNextMeeting';
import { deriveCall, deriveLeave, deriveRecording, UNKNOWN_PAYLOAD, type CallSignal, type DerivedSignals, type LeaveSignal, type SignalPayload } from './model';

interface SignalState extends DerivedSignals { init: () => () => void }
interface SignalDeps { now: () => number; zone: () => string; invoke: typeof invoke; listen: typeof listen }

const report = (word: string, value?: number) => invoke('wall2_signals_report', value === undefined ? { word } : { word, value }).catch(() => {});

export function createSignalStore(deps: SignalDeps) {
  let previous: CallSignal | null = null;
  let previousRecording = false;
  let previousLeave: LeaveSignal | null = null;
  let micFreeSince: number | null = null;
  let timer: ReturnType<typeof setInterval> | undefined;
  let unlisten: UnlistenFn | undefined;
  let payload = UNKNOWN_PAYLOAD;
  return create<SignalState>((set) => {
    const apply = (next: SignalPayload) => {
      payload = next;
      const now = deps.now();
      const feed = useMeetingFeed.getState();
      const meetings = feed.feedStale || feed.failed ? [] : feed.meetings;
      const callResult = deriveCall(next, meetings, now, previous, micFreeSince);
      if (!isTauri() && next.mockCall && !callResult.call) callResult.call = { kind: next.mockCall, since: now, camera: next.camera[next.mockCall] };
      micFreeSince = callResult.micFreeSince;
      const recording = deriveRecording(next);
      const leave = next.known ? (!isTauri() && next.mockLeave ? next.mockLeave : deriveLeave(meetings, now, deps.zone())) : null;
      if (callResult.call?.kind !== previous?.kind) void report(callResult.call ? `call start ${callResult.call.kind}` : 'call end');
      if (recording !== previousRecording) void report(recording ? 'recording on' : 'recording off');
      if (leave?.key !== previousLeave?.key && leave) void report('leave found', Math.round((leave.startsAt - leave.leaveAt) / 60_000));
      previous = callResult.call;
      previousRecording = recording;
      previousLeave = leave;
      set({ known: next.known, call: callResult.call, recording, leave });
    };
    return {
      known: false,
      call: null,
      recording: false,
      leave: null,
      init: () => {
        void deps.invoke<SignalPayload>('wall2_signals').then(apply, () => apply(UNKNOWN_PAYLOAD));
        if (isTauri()) void deps.listen<SignalPayload>('signals-changed', (e) => apply(e.payload)).then((fn) => (unlisten = fn));
        timer = setInterval(() => apply(payload), 1000);
        return () => { clearInterval(timer); unlisten?.(); };
      },
    };
  });
}

export const useSignalStore = createSignalStore({
  now: () => Date.now(),
  zone: () => Intl.DateTimeFormat().resolvedOptions().timeZone,
  invoke,
  listen,
});
