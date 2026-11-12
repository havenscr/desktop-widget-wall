import { NetworkTile } from '../home/NetworkTile';
import { PLACES, usePlaceStore } from '../state/places';
import { Unwind } from './Unwind';
import { Work } from './Work';

/** Work, Unwind and the network tile on Home are real; the rest of Home shows only the place name. */
export function Screens() {
  const active = usePlaceStore((s) => s.active);
  if (active === 'work') return <Work />;
  if (active === 'unwind') return <Unwind />;
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
