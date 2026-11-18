import { tip } from '../ui/HoverTip';
import { useHome } from './homeStore';

/**
 * The 68 px offer bar: it takes the place of the preset row and the summary line when the show timer
 * or a recording starts with no preset on, or stops with one on. Nothing applies without a click.
 */
export function StudioOffer() {
  const offer = useHome((s) => s.offer);
  const studio = useHome((s) => s.studio);
  if (!offer) return null;
  const what = offer.what === 'timer' ? 'The show timer' : 'The recording';
  const active = studio?.presets.find((p) => p.active)?.label ?? offer.label ?? 'a preset';
  const title = offer.kind === 'start' ? 'Studio lights are not set.' : `${what} ${offer.what === 'timer' ? 'stopped' : 'ended'}.`;
  const sub = offer.kind === 'start' ? (offer.what === 'timer' ? 'The timer started just now.' : 'A recording started just now.') : `The room is still on ${active}.`;
  const dismiss = () => useHome.getState().dismissOffer();
  const doIt = () => {
    dismiss();
    void (offer.kind === 'start' ? useHome.getState().applyPreset('onAir') : useHome.getState().goNormal());
  };
  const onAir = studio?.presets.find((p) => p.id === 'onAir');
  return (
    <div className="st-offer" role="status" data-offer={offer.kind}>
      <div className="st-offer-tx">
        <span className="st-offer-t">{title}</span>
        <span className="st-offer-s">{sub}</span>
      </div>
      <button type="button" className="st-chip st-go" onClick={doIt} {...tip(offer.kind === 'start' ? (onAir?.line ? `${onAir.label}: ${onAir.line}` : `Applies ${onAir?.label ?? 'the preset'}`) : 'Puts the room back the way it was before')}>
        {offer.kind === 'start' ? 'Set for the stream' : 'As before'}
      </button>
      <button type="button" className="st-chip" onClick={dismiss} {...tip(offer.kind === 'start' ? 'Leaves the lights as they are. This offer goes away by itself after a minute.' : 'Keeps the room as it is. This offer goes away by itself after a minute.')}>
        {offer.kind === 'start' ? 'Not now' : 'Keep'}
      </button>
    </div>
  );
}
