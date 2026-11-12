import { NetworkTile } from '../home/NetworkTile';
import { PLACES, usePlaceStore } from '../state/places';
import { Work } from './Work';

/** Work is real and Home has the network tile; the rest of Home and Unwind show only the place name. */
export function Screens() {
  const active = usePlaceStore((s) => s.active);
  if (active === 'work') return <Work />;
  const label = PLACES.find((p) => p.id === active)?.label ?? '';
  return (
    <>
      <section className="screen" data-place={active}>
        <h1>{label}</h1>
      </section>
      {active === 'home' && <NetworkTile />}
    </>
  );
}
