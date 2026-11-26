import { useEffect, useState } from 'react';
import { Ribbon } from '../../ribbon/Ribbon';
import { RibbonLine } from '../../ribbon/RibbonLine';
import { useDayFeed } from '../../ribbon/useDayEvents';
import { useVisible } from '../../ui/useVisible';
import { reviewNow } from '../../ui/reviewClock';
import { useWorkLayerStore } from './layerStore';

/** The fade out lasts this long. It is the one source: written to the layer as `--u-work-out` (unwind-work.css reads it) and used for the unmount wait. */
export const LAYER_FADE_OUT_MS = 400;

/** The ribbon's drawer or panel holds the layer up while it is open (the keys row does the same through `held`). */
const holdLayer = (open: boolean) => useWorkLayerStore.setState({ held: open });

/**
 * Unwind's timeline: a thin line at rest, and the full Work timeline over it while the work layer is up. The layer
 * is `inert` and invisible while hidden, so a hidden chip never takes a click or a Tab, and the full ribbon (with its
 * polls) is mounted only while it shows and for the fade out.
 */
export function UnwindTimeline() {
  const shown = useWorkLayerStore((s) => s.shown);
  const [mounted, setMounted] = useState(false);
  // One calendar read for the line and the full ribbon.
  const feed = useDayFeed(useVisible());
  useEffect(() => {
    if (shown) {
      setMounted(true);
      return;
    }
    const id = setTimeout(() => setMounted(false), LAYER_FADE_OUT_MS);
    return () => clearTimeout(id);
  }, [shown]);
  return (
    <>
      <RibbonLine feed={feed} now={reviewNow} />
      <div className="u-work" data-shown={shown ? '' : undefined} inert={!shown} data-testid="u-work" style={{ ['--u-work-out' as string]: `${LAYER_FADE_OUT_MS}ms` }}>
        {mounted ? <Ribbon kind="work" now={reviewNow} compact feed={feed} onOverlay={holdLayer} /> : null}
      </div>
    </>
  );
}
