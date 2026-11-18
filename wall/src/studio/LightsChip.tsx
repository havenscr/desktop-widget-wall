import { IconBulb } from '@tabler/icons-react';
import { useSignalStore } from '../signals/store';
import { tip } from '../ui/HoverTip';
import { chipWord, type Snapshot } from './model';
import { chipPresetWord } from './homeModel';
import { useHome } from './homeStore';
import { useActivePreset } from './PresetRow';
import { StudioDrawer } from './StudioDrawer';
import { useKeyLights } from './store';
import { useHomePolling } from './useHomePolling';
import { useKeyLightPolling } from './useKeyLightPolling';

/**
 * The Lights chip, after the Recording chip on Work while a recording runs. It says what the studio lights are
 * set to in a few words: "Lights: <preset>" while a preset is on, else what the key lights report. An
 * amber dot shows while an offer waits on On Air. A click opens the same sheet as Fine tune. Hidden when
 * there is nothing to say (no preset known and the key lights are not set up).
 */
export function LightsChip({ compact = false }: { compact?: boolean }) {
  const recording = useSignalStore((s) => s.recording);
  const drawer = useKeyLights((s) => s.drawer);
  const status = useKeyLights((s) => s.status);
  const left = useKeyLights((s) => s.left);
  const right = useKeyLights((s) => s.right);
  const offer = useHome((s) => s.offer);
  const { preset, changed } = useActivePreset();
  const shows = recording;
  useKeyLightPolling(shows || drawer);
  useHomePolling(shows || drawer);
  const snap: Snapshot = { status, left, right };
  const word = chipPresetWord(preset, changed) ?? chipWord(snap, compact);
  return (
    <>
      {shows && word !== null && (
        <button
          type="button"
          className={`lights-chip${compact ? ' compact' : ''}`}
          data-st-opener=""
          aria-expanded={drawer}
          onClick={() => useKeyLights.getState().setDrawer(!drawer)}
          {...tip(
            offer
              ? 'Studio lights have an offer waiting on On Air. Click to open the studio lights.'
              : preset
                ? `${preset.label}${preset.line ? `: ${preset.line}` : ''}. Click to open the studio lights.`
                : 'What the key lights report right now. Click to open the sliders for brightness and warmth.',
          )}
        >
          <IconBulb size={18} aria-hidden="true" />
          <span>{word}</span>
          {offer && <i className="st-dot" aria-hidden="true" />}
        </button>
      )}
      {drawer && <StudioDrawer />}
    </>
  );
}
