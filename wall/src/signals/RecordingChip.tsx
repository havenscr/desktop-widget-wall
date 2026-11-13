import { useEffect } from 'react';
import { create } from 'zustand';
import { usePlaceStore } from '../state/places';
import { tip } from '../ui/HoverTip';
import { useChipLayout } from './layout';
import { useSignalStore } from './store';
import { useClock } from './useClock';

/** A recorder that comes back within this long of going off is the same recording (one missed poll). */
export const RECORDING_GAP_MS = 10_000;

/** When the wall first saw the recorder on, or null; `off` is when it last went off. The signal says a recorder is running, not since when. */
const useRecordingSince = create<{ at: number | null; off: number | null }>(() => ({ at: null, off: null }));
useSignalStore.subscribe((s, prev) => {
  const now = Date.now();
  if (s.recording && !prev.recording) {
    const { at, off } = useRecordingSince.getState();
    // Back after a short gap: keep counting from the old start.
    useRecordingSince.setState({ at: at !== null && off !== null && now - off <= RECORDING_GAP_MS ? at : now, off: null });
  } else if (!s.recording && prev.recording) useRecordingSince.setState({ off: now });
});

/** Tests: forget when the last recording started. */
export function resetRecordingSince(): void {
  useRecordingSince.setState({ at: null, off: null });
}

/** "04:12", or "1:04:12" from the first hour. */
export function elapsedText(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const two = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${two(m)}:${two(s)}` : `${two(m)}:${two(s)}`;
}

export const CHIP_TIP = 'A recorder is using the microphone or camera (Camtasia, or OBS). The time counts from when the wall noticed it.';

export type ChipPlace = 'header' | 'banner' | 'floating';

/** The chip itself: a red dot, "Recording" and the time. `compact` drops the word. */
export function RecordingChipBody({ compact = false, place }: { compact?: boolean; place: ChipPlace }) {
  const since = useRecordingSince((s) => s.at);
  const now = useClock(1000);
  const time = elapsedText(since === null ? 0 : now - since);
  return (
    <span className={`rec-chip${compact ? ' compact' : ''}`} data-place={place} role="status" aria-label={`Recording ${time}`} tabIndex={0} {...tip(CHIP_TIP)}>
      <i aria-hidden="true" />
      {!compact && <span className="rec-word">Recording</span>}
      <span className="rec-time">{time}</span>
    </span>
  );
}

/** The chip in the Agents header on Work. Hidden while the leave banner covers the header (the banner carries the chip then). */
export function HeaderRecordingChip({ compact }: { compact: boolean }) {
  const recording = useSignalStore((s) => s.recording);
  const banner = useChipLayout((s) => s.banner);
  useEffect(() => {
    useChipLayout.setState({ header: true });
    return () => useChipLayout.setState({ header: false });
  }, []);
  if (!recording || banner) return null;
  return <RecordingChipBody place="header" compact={compact} />;
}

/**
 * The chip everywhere else, where the banner sits (the band above the ribbon off Work): on Home, Unwind and Meet, and
 * on Work when the Agents header is not showing. Not on Zen, which stays calm, and not while the
 * banner shows (it carries the chip itself).
 */
export function FloatingRecordingChip() {
  const recording = useSignalStore((s) => s.recording);
  const place = usePlaceStore((s) => s.active);
  const { banner, header } = useChipLayout();
  if (!recording || banner || place === 'zen' || (place === 'work' && header)) return null;
  return (
    <div className="rec-float" data-at={place === 'work' ? 'end' : 'start'} data-band={place === 'work' ? 'top' : 'bottom'}>
      <RecordingChipBody place="floating" />
    </div>
  );
}
