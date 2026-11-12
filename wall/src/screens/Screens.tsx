import { Meet } from '../meet/Meet';
import { usePlaceStore, type PlaceId } from '../state/places';
import { Zen } from '../zen/Zen';
import { Frame } from './Frame';
import { Home } from './Home';
import { Unwind } from './Unwind';
import { Work } from './Work';

function Place({ id }: { id: PlaceId }) {
  switch (id) {
    case 'work':
      return <Work />;
    case 'home':
      return <Home />;
    case 'meet':
      return <Meet />;
    case 'unwind':
      return <Unwind />;
    case 'zen':
      return <Zen />;
  }
}

/** Every place inside the concept frame. Each place's own layout lives in its own file. */
export function Screens() {
  const active = usePlaceStore((s) => s.active);
  return (
    <Frame place={active}>
      <Place id={active} />
    </Frame>
  );
}
