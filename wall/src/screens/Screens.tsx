import { Moods } from '../home/Moods';
import { Meet } from '../meet/Meet';
import { NetworkTile } from '../home/NetworkTile';
import { PLACES, usePlaceStore } from '../state/places';
import { Zen } from '../zen/Zen';
import { Unwind } from './Unwind';
import { Work } from './Work';

/** Work, Meet, Unwind, Zen and Home (moods and the network tile) are real; places with nothing else yet show only their name. */
export function Screens() {
  const active = usePlaceStore((s) => s.active);
  if (active === 'work') return <Work />;
  if (active === 'meet') return <Meet />;
  if (active === 'unwind') return <Unwind />;
  if (active === 'zen') return <Zen />;
  const label = PLACES.find((p) => p.id === active)?.label ?? '';
  return (
    <>
      {active !== 'home' && (
        <section className="screen" data-place={active}>
          <h1>{label}</h1>
        </section>
      )}
      {active === 'home' && <Moods />}
      {active === 'home' && <NetworkTile />}
    </>
  );
}
