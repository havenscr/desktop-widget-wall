import { Moods } from '../home/Moods';
import { NetworkTile } from '../home/NetworkTile';

/** The Home tab: the mood row and the network tile. Rooms, chores and the house line come in later pull requests. */
export function Home() {
  return (
    <section className="home" data-place="home" aria-label="Home">
      <Moods />
      <NetworkTile />
    </section>
  );
}
