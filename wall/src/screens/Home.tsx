import { Chores } from '../home/Chores';
import { LeftWing } from '../home/LeftWing';
import { Moods } from '../home/Moods';
import { NetworkTile } from '../home/NetworkTile';

/**
 * The Home tab on the concept's zones (f_home): the sun block under the clock in the
 * left wing, the mood cards across the centre, Around the house and the network card in
 * the right wing. The Rooms row stays hidden until its data exists (PR 25), so the mood
 * cards take the centre's full height.
 */
export function Home() {
  return (
    <section className="home zones" data-place="home" aria-label="Home">
      <LeftWing />
      <Moods />
      <div className="home-right">
        <Chores />
        <NetworkTile />
      </div>
    </section>
  );
}
