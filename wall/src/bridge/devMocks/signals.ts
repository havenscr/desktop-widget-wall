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
  const payload: SignalPayload = { known: true, mic, camera, ...(kind ? { mockCall: kind } : {}) };
  const leave = q.has('leave') ? Number(q.get('leave')) : Number.NaN;
  if (Number.isFinite(leave) && leave >= 0 && leave <= 180) {
    const now = Date.now();
    payload.mockLeave = { key: 'signal-dev', leaveAt: now + leave * 60_000, startsAt: now + (leave + 30) * 60_000 };
  }
  mocks.set('wall2_signals', () => payload);
  mocks.set('wall2_signals_report', () => null);
}
