import { Unwind } from '../../screens/Unwind';
import { usePlaceStore } from '../../state/places';
import { WatchStageLayer } from './StageLayer';

/**
 * Tests only: Unwind as the screens frame holds it, with the video's layer beside it in the same
 * box (`Frame.tsx` mounts the layer for every place; Unwind alone has no video). Unwind shows only
 * while it is the place, as in the frame.
 */
export function UnwindView() {
  const place = usePlaceStore((s) => s.active);
  return (
    <div className="main tall" data-place={place}>
      <div className="top">
        <WatchStageLayer />
        {place === 'unwind' ? <Unwind /> : null}
      </div>
    </div>
  );
}
