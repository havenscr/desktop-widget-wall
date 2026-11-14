import { useLinesStore, validateLines } from '../../horizon/linesSettings';

/**
 * Dev only: the Lines setting for stills, the gallery and the fit check, set for this page only
 * (nothing is saved). A release build never reads these.
 *
 *   ?lines=mountains|bars|ribbon|sparks|skyline   the type
 *   ?lively=<0 to 100>  ?smooth=<0 to 100>  ?lheight=<20 to 220>
 *   ?lcol=look|floor|sunset|ice|mint              the colours
 *   ?lrest=ridgelevels|flat                       the resting look
 *   ?lrefl=0                                      reflection off
 */
export function registerLinesMocks(search: string = window.location.search): void {
  const q = new URLSearchParams(search);
  const next: Record<string, unknown> = { ...useLinesStore.getState() };
  let any = false;
  const take = (key: string, field: string, num: boolean) => {
    const v = q.get(key);
    if (v === null) return;
    next[field] = num ? Number(v) : v;
    any = true;
  };
  take('lines', 'type', false);
  take('lively', 'lively', true);
  take('smooth', 'smooth', true);
  take('lheight', 'height', true);
  take('lcol', 'colours', false);
  take('lrest', 'rest', false);
  if (q.get('lrefl') === '0') {
    next.reflection = false;
    any = true;
  }
  if (any) useLinesStore.setState(validateLines(next));
}
