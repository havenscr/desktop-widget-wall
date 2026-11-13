import type { Call } from '../work/keyPress';
import type { KeyboardEvent } from 'react';
import { tip } from '../ui/HoverTip';
import { RECORDING_KEYS, recordingKeyTip, useRecordingHows } from './recordingKeys';

type Press = (id: string, detail: number, call: Call, label: string, action: string | null, where: { name: string; general: boolean }, hold: boolean) => unknown;

/**
 * The Recording page of the Now row: Stop recording, Pause, Mark moment and Snip. They are the
 * deck's own key tiles (same classes, same height) in the capture kind, Stop with the red edge.
 * Each press sends one fixed library key by its id.
 */
export function RecordingKeys({ press, onKeyDown }: { press: Press; onKeyDown: (action: string | null) => (e: KeyboardEvent) => void }) {
  const hows = useRecordingHows();
  return (
    <div className="deck-tiles keys-tiles rec-keys" style={{ gridTemplateColumns: `repeat(${RECORDING_KEYS.length}, minmax(0, 1fr))` }}>
      {RECORDING_KEYS.map((k) => {
        const I = k.icon;
        return (
          <button
            key={k.id}
            type="button"
            className="deck-tile key-tile"
            data-kind="capture"
            data-rec={k.stop ? 'stop' : undefined}
            aria-label={k.label}
            {...tip(recordingKeyTip(k, hows.get(k.id)))}
            onKeyDown={onKeyDown(null)}
            onClick={(e) => void press(`rec:${k.id}`, e.detail, { command: 'wall2_keys_send_library', args: { id: k.id } }, k.label, null, { name: k.to, general: k.id === 'snip' }, false)}
          >
            <I size={20} stroke={1.8} aria-hidden="true" />
            <span className="deck-lbl">{k.label}</span>
          </button>
        );
      })}
    </div>
  );
}
