import { useLayoutEffect, useRef, useState } from 'react';
import { keyboardOnMouseKey, useKeyPress } from '../../work/keyPress';
import { isLayoutAction, layoutOffReason, useArrangeStatus } from '../../work/arrangeStatus';
import { KeyIcon } from '../../work/keyIcons';
import { loadKeys } from '../../work/keysFeed';
import { MAX_PINS } from '../../work/libraryModel';
import { tip } from '../../ui/HoverTip';
import { makeKindOf, usePins } from '../../work/usePins';
import { useBrief } from '../../work/useBrief';
import { previewTip } from '../../work/ZonesPreview';
import { useWorkLayerStore } from './layerStore';
import { canvasMeasure, labelCandidates, pickLabel, type Measure } from './shortLabel';

/**
 * One label for each key, chosen by measuring: the width a label may take is the first tile's inside width (a tile
 * is one fifth of the row, less its edge and padding), the font is the one the label is drawn in, and the measure waits
 * for the fonts to load. `measure` stands in for the canvas under test. Until it is measured the first candidate shows.
 */
function useFittedLabels(labels: readonly string[], measure?: Measure) {
  const tilesRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<{ avail: number; measure: Measure | null }>({ avail: 0, measure: null });
  const key = labels.join('\n');
  useLayoutEffect(() => {
    let live = true;
    const read = () => {
      const tile = tilesRef.current?.querySelector<HTMLElement>('.u-key:not(.empty)');
      if (!tile || !live) return;
      const cs = getComputedStyle(tile);
      const avail = tile.clientWidth - parseFloat(cs.paddingLeft || '0') - parseFloat(cs.paddingRight || '0');
      const m = measure ?? (avail > 0 ? canvasMeasure(`${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`) : null);
      setFit((f) => (f.avail === avail && f.measure === m ? f : { avail, measure: m }));
    };
    read();
    void document.fonts?.ready.then(read);
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(read);
    if (tilesRef.current) ro?.observe(tilesRef.current);
    return () => {
      live = false;
      ro?.disconnect();
    };
  }, [key, measure]);
  const words = labels.map((l) => {
    const cands = labelCandidates(l, labels);
    return fit.measure ? pickLabel(cands, fit.avail, fit.measure) : cands[0]!;
  });
  return { tilesRef, words };
}

/**
 * The "Always here" keys under the Watch list, shown with the work layer: the same five keys, pressed the same way
 * (one press is one action, a key that only runs from a click ignores Enter and Space). No picker and no menu here;
 * the row on Work is where keys are changed. It fades with the layer, and under the Watch list while that grows
 * (unwind-work.css). Hidden, it is `inert`, so it takes no click or Tab stop.
 */
export function UnwindKeys({ measure }: { measure?: Measure } = {}) {
  const shown = useWorkLayerStore((s) => s.shown);
  const { read, lib, pins } = usePins(shown);
  const arrange = useArrangeStatus();
  const [brief, showBrief] = useBrief();
  const { press, onKeyDown } = useKeyPress(showBrief, loadKeys);
  const kindOf = makeKindOf(lib);
  const { tilesRef, words } = useFittedLabels(pins.map((p) => p.label), measure);
  if (read.status === 'absent' || !lib) return null;
  return (
    <section className="u-keys" data-shown={shown ? '' : undefined} inert={!shown} aria-label="Always here keys" data-testid="u-keys">
      <div className="u-keys-tiles" ref={tilesRef}>
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
              className={`deck-tile key-tile u-key${off ? ' off' : ''}`}
              data-kind={off ? undefined : kindOf(p)}
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
        {Array.from({ length: Math.max(0, MAX_PINS - pins.length) }, (_, i) => (
          <div key={`empty-${i}`} className="u-key empty" aria-hidden="true" {...tip('An empty place. Add keys to Always here on Work.')} />
        ))}
      </div>
      <div className="u-keys-line" role="status">
        {brief}
      </div>
    </section>
  );
}
