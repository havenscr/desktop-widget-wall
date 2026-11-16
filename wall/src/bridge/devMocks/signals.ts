import { reviewNow } from '../../ui/reviewClock';
import { mocks } from '../tauri';
import { EMPTY_USE, type CallKind, type SignalPayload } from '../../signals/model';

export function registerSignalMocks(): void {
  const q = new URLSearchParams(window.location.search);
  const call = q.get('call');
  const kind: CallKind | null = call === 'teams' || call === 'zoom' || call === 'browser' ? call : null;
  const mic = { ...EMPTY_USE };
  const camera = { ...EMPTY_USE };
  if (kind) mic[kind] = true;
  if (kind && q.get('camera') === '1') camera[kind] = true;
  if (q.get('rec') === '1') mic.recorder = true;
  // `callbrowserav=1` (the new On Air frame): a browser holds the camera and microphone with no call, as a broadcast from the browser does.
  if (q.get('callbrowserav') === '1') {
    mic.browser = true;
    camera.browser = true;
  }
  // `callsince=-70`: the call began that many minutes ago (a call that outlasts its meeting).
  const since = Number(q.get('callsince'));
  // `meetnow=1` (the meeting in devMocks/meet.ts, 10:00 to 11:00 on a 10:24 review clock): the call began at 9:56, four minutes before it, unless `callsince` says otherwise.
  const joinedEarly = q.get('meetnow') === '1' && !q.has('callsince');
  const payload: SignalPayload = { known: true, mic, camera, ...(kind ? { mockCall: kind } : {}), ...(kind && Number.isFinite(since) && since < 0 && q.has('callsince') ? { mockSince: (reviewNow ? reviewNow() : Date.now()) + since * 60_000 } : kind && joinedEarly ? { mockSince: (reviewNow ? reviewNow() : Date.now()) - 28 * 60_000 } : {}) };
  const leave = q.has('leave') ? Number(q.get('leave')) : Number.NaN;
  if (Number.isFinite(leave) && leave >= 0 && leave <= 180) {
    const now = Date.now();
    // The dev leave carries its own title (a real one is looked up in the meeting list by key).
    const title = q.get('long') === '1' ? "Long appointment with a very long name that goes on and on about the day's plans and the people to see (10:45 start)" : "Doctor's appointment (10:45 start)";
    payload.mockLeave = { key: 'signal-dev', leaveAt: now + leave * 60_000, startsAt: now + (leave + 30) * 60_000, title } as SignalPayload['mockLeave'];
  }
  mocks.set('wall2_signals', () => payload);
  mocks.set('wall2_signals_report', () => null);
}
