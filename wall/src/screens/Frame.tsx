import type { ReactNode } from 'react';
import { Clock } from '../clock/Clock';
import { Ribbon, type RibbonKind } from '../ribbon/Ribbon';
import type { PlaceId } from '../state/places';
import { reviewDate, reviewNow } from '../ui/reviewClock';

/** Work, Home and Meet carry the day ribbon. Unwind (it has Tomorrow instead) and Zen do not. */
export function ribbonKind(place: PlaceId): RibbonKind | null {
  if (place === 'home') return 'home';
  if (place === 'work' || place === 'meet') return 'work';
  return null;
}

/**
 * The concept frame inside the shell: the top band with the clock and the place's
 * panels, the empty band over the horizon, and the ribbon. One tree for every place, so
 * the clock and ribbon stay mounted when the place changes.
 */
export function Frame({ place, children }: { place: PlaceId; children: ReactNode }) {
  const kind = ribbonKind(place);
  return (
    <div className={kind ? 'main' : 'main tall'} data-place={place}>
      <div className="top">
        <Clock now={reviewDate} />
        {children}
      </div>
      {kind && <div className="band" aria-hidden="true" />}
      {kind && <Ribbon kind={kind} now={reviewNow} />}
    </div>
  );
}
