import { useEffect, useState } from 'react';
import { Ribbon } from '../../ribbon/Ribbon';
import { RibbonLine } from '../../ribbon/RibbonLine';
import { reviewNow } from '../../ui/reviewClock';
import { useWorkLayerStore } from './layerStore';

/** The fade out lasts this long (unwind-work.css); the full ribbon stays mounted until it is done. */
export const LAYER_FADE_OUT_MS = 400;

/**
 * Unwind's timeline: a thin line at rest, and the full Work timeline over it while the work layer is up. The layer
 * is `inert` and invisible while hidden, so a hidden chip never takes a click or a Tab, and the full ribbon (with its
 * polls) is mounted only while it shows and for the fade out.
 */
export function UnwindTimeline() {
  const shown = useWorkLayerStore((s) => s.shown);
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    if (shown) {
      setMounted(true);
      return;
    }
    const id = setTimeout(() => setMounted(false), LAYER_FADE_OUT_MS + 50);
    return () => clearTimeout(id);
  }, [shown]);
  return (
    <>
      <RibbonLine now={reviewNow} />
      <div className="u-work" data-shown={shown ? '' : undefined} inert={!shown} data-testid="u-work">
        {mounted ? <Ribbon kind="work" now={reviewNow} compact /> : null}
      </div>
    </>
  );
}
