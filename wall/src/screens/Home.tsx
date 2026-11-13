import { Chores } from '../home/Chores';
import { LeftWing } from '../home/LeftWing';
import { Moods } from '../home/Moods';
import { NetworkTile } from '../home/NetworkTile';
import { Rooms } from '../home/Rooms';
import { Sound } from '../home/Sound';

/**
 * The Home tab on the concept's zones (f_home): the sun block under the clock in the
 * left wing; the centre with the concept's smaller mood cards in one row, the Rooms row's
 * place (empty until its data exists, PR 25) and the Sound block; Around the house and
 * the network card in the right wing.
 */
export function Home() {
  return (
    <section className="home zones" data-place="home" aria-label="Home">
      <LeftWing />
      <div className="home-centre">
        <Moods />
        <Rooms />
        <Sound />
      </div>
      <div className="home-right">
        <Chores />
        <NetworkTile />
      </div>
    </section>
  );
}
