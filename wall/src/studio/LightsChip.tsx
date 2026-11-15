import { IconBulb } from '@tabler/icons-react';
import { useSignalStore } from '../signals/store';
import { tip } from '../ui/HoverTip';
import { chipWord, type Snapshot } from './model';
import { StudioDrawer } from './StudioDrawer';
import { useKeyLights } from './store';
import { useKeyLightPolling } from './useKeyLightPolling';

/**
 * The Lights chip on Work, after the Recording chip, while a recording runs: what the key lights are
 * doing in a few words. A click opens the same drawer as Fine tune on On Air. Hidden when no recording
 * runs, and when the key lights are not set up (there is nothing to say or open).
 */
export function LightsChip({ compact = false }: { compact?: boolean }) {
  const recording = useSignalStore((s) => s.recording);
  const drawer = useKeyLights((s) => s.drawer);
  const status = useKeyLights((s) => s.status);
  const left = useKeyLights((s) => s.left);
  const right = useKeyLights((s) => s.right);
  useKeyLightPolling(recording || drawer);
  const snap: Snapshot = { status, left, right };
  const word = chipWord(snap, compact);
  return (
    <>
      {recording && word !== null && (
        <button
          type="button"
          className="lights-chip"
          data-st-opener=""
          aria-expanded={drawer}
          onClick={() => useKeyLights.getState().setDrawer(!drawer)}
          {...tip('What the key lights report right now. Click to open the sliders for brightness and warmth.')}
        >
          <IconBulb size={18} aria-hidden="true" />
          <span>{word}</span>
        </button>
      )}
      {drawer && <StudioDrawer />}
    </>
  );
}
