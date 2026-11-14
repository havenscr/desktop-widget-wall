import { IconCar } from '@tabler/icons-react';
import { useEffect } from 'react';
import { invoke } from '../bridge/tauri';
import { usePlaceStore } from '../state/places';
import { tip } from '../ui/HoverTip';
import { useLeaveDismissed } from './leaveDismiss';
import { useChipLayout } from './layout';
import { RecordingChipBody } from './RecordingChip';
import { useLeaveBanner } from './useLeaveBanner';
import { useSignalStore } from './store';

/**
 * "Leave in 12 min. Doctor's appointment starts 10:45", on every place but Zen (concept `set-dynamic`):
 * over the top band on Work, in the empty band above the ribbon on the other places, where it
 * covers no button (Home's moods and Unwind's tabs sit in the top band). Cyan at rest, amber at 5 minutes with Dismiss, "Leave now." from the
 * leave time. The text opens the event. On Work it hides the Agents header while it shows.
 */
export function LeaveBanner() {
  const place = usePlaceStore((s) => s.active);
  const shown = useLeaveBanner();
  const recording = useSignalStore((s) => s.recording);
  const visible = shown !== null && place !== 'zen';
  useEffect(() => {
    useChipLayout.setState({ banner: visible });
    if (!visible) return;
    document.documentElement.dataset.leaveBanner = 'on';
    return () => {
      delete document.documentElement.dataset.leaveBanner;
      useChipLayout.setState({ banner: false });
    };
  }, [visible]);
  if (!shown || !visible) return null;
  const { leave, view } = shown;
  return (
    <div className="leave-banner" data-phase={view.phase} data-band={place === 'work' ? 'top' : 'bottom'} role="status">
      <IconCar size={26} stroke={1.8} aria-hidden="true" />
      <button type="button" className="lb-main" aria-label={`${view.lead} ${view.rest}. Opens the event`} {...tip(view.tip)} onClick={() => void invoke('wall2_open_event', { key: leave.key }).catch(() => undefined)}>
        <b>{view.lead}</b>
        <span className="lb-rest">{view.rest}</span>
      </button>
      {recording && <RecordingChipBody place="banner" />}
      {view.phase === 'lead' ? (
        <span className="lb-hint">turns amber at 5 minutes</span>
      ) : (
        <button type="button" className="lb-dismiss" {...tip('Hide this banner for this event')} onClick={() => useLeaveDismissed.getState().dismiss(leave.key, leave.startsAt)}>
          Dismiss
        </button>
      )}
    </div>
  );
}
