import { keyboardOnMouseKey, useKeyPress } from '../../work/keyPress';
import { isLayoutAction, layoutOffReason, useArrangeStatus } from '../../work/arrangeStatus';
import { KeyIcon } from '../../work/keyIcons';
import { loadKeys } from '../../work/keysFeed';
import { usePins } from '../../work/usePins';
import { useBrief } from '../../work/useBrief';
import { previewTip } from '../../work/ZonesPreview';
import { useWorkLayerStore } from './layerStore';
import { shortLabels } from './shortLabel';

/**
 * The "Always here" keys under the Watch list, shown with the work layer: the same five keys, pressed the same way
 * (one press is one action, a key that only runs from a click ignores Enter and Space). No picker and no menu here;
 * the row on Work is where keys are changed. It fades with the layer, and under the Watch list while that grows
 * (unwind-work.css). Hidden, it is `inert`, so it takes no click or Tab stop.
 */
export function UnwindKeys() {
  const shown = useWorkLayerStore((s) => s.shown);
  const { read, lib, pins } = usePins();
  const arrange = useArrangeStatus();
  const [brief, showBrief] = useBrief();
  const { press, onKeyDown } = useKeyPress(showBrief, loadKeys);
  if (read.status === 'absent' || !lib || pins.length === 0) return null;
  const words = shortLabels(pins.map((p) => p.label));
  return (
    <section className="u-keys" data-shown={shown ? '' : undefined} inert={!shown} aria-label="Always here keys" data-testid="u-keys">
      <div className="u-keys-tiles">
        {pins.map((p, i) => {
          const layoutOff = isLayoutAction(p.action) && arrange !== true;
          const off = layoutOff || !p.runnable;
          const where = { name: p.group ?? 'the app in front', general: p.group === null };
          const run = (detail: number) => {
            if (off || keyboardOnMouseKey(p.action, detail)) return;
            const [kind, id] = [p.ref.slice(0, 4), p.ref.slice(4)];
            const call = kind === 'lib:' ? ({ command: 'wall2_keys_send_library', args: { id } } as const) : ({ command: 'wall2_keys_send', args: { setId: 'pinned', index: Number(p.ref.slice(5)) } } as const);
            void press(`pin:${p.ref}`, detail, call, p.label, p.action, where, false);
          };
          return (
            <button
              key={p.ref}
              type="button"
              className={`u-key${off ? ' off' : ''}`}
              aria-label={p.label}
              aria-disabled={off || undefined}
              {...previewTip(p.action, layoutOff, layoutOff ? layoutOffReason(arrange) : !p.runnable ? `${p.label}: ${p.how}. Change it on Work.` : `${p.label}${p.group ? ` (${p.group})` : ''}. ${p.how ? `${p.how}. ` : ''}Always here keys are changed on Work.`)}
              onKeyDown={onKeyDown(p.action)}
              onClick={(e) => run(e.detail)}
            >
              <KeyIcon name={p.icon} size={22} />
              <span className="u-key-l">{words[i]}</span>
            </button>
          );
        })}
      </div>
      <div className="u-keys-line" role="status">
        {brief}
      </div>
    </section>
  );
}
