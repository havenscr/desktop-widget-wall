import { createContext, useState, type ReactNode } from 'react';
import { Clock } from '../clock/Clock';
import { Ribbon, type RibbonKind } from '../ribbon/Ribbon';
import type { PlaceId } from '../state/places';
import { reviewDate, reviewNow } from '../ui/reviewClock';
import { WatchStageLayer } from '../unwind/watch/StageLayer';

/**
 * The end of the clock's date line, for a place to fill through a portal (Work puts the
 * weather there). Null until the line has mounted.
 */
export const ClockSlot = createContext<HTMLElement | null>(null);

/** Work, Home, Meet and On Air carry the day ribbon. Unwind (it has Tomorrow instead) and Zen do not. */
export function ribbonKind(place: PlaceId): RibbonKind | null {
  if (place === 'home') return 'home';
  if (place === 'work' || place === 'meet' || place === 'onair') return 'work';
  return null;
}

/**
 * The concept frame inside the shell: the top band with the clock and the place's
 * panels, the empty band over the horizon, and the ribbon. One tree for every place, so
 * the clock and ribbon stay mounted when the place changes.
 */
export function Frame({ place, children }: { place: PlaceId; children: ReactNode }) {
  const kind = ribbonKind(place);
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  return (
    <div className={kind ? 'main' : 'main tall'} data-place={place}>
      <div className="top">
        <Clock now={reviewDate}>
          <span className="clk-slot" ref={setSlot} />
        </Clock>
        {/* The video's layer: mounted once for every place, so a video plays on when he leaves Unwind. */}
        <WatchStageLayer />
        <ClockSlot.Provider value={slot}>{children}</ClockSlot.Provider>
      </div>
      {kind && <div className="band" aria-hidden="true" />}
      {kind && <Ribbon kind={kind} now={reviewNow} />}
    </div>
  );
}
