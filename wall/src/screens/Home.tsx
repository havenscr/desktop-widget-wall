import { bothOut, useCentreStatus } from '../home/centreStatus';
import { CentreStatus } from '../home/CentreStatus';
import { Chores } from '../home/Chores';
import { LeftWing } from '../home/LeftWing';
import { Moods } from '../home/Moods';
import { NetworkTile } from '../home/NetworkTile';
import { Rooms } from '../home/Rooms';
import { Sound } from '../home/Sound';
import { reviewNow } from '../ui/reviewClock';

/**
 * The Home tab on the concept's zones (f_home): the sun block under the clock in the
 * left wing; the centre with the concept's smaller mood cards in one row, the Rooms row's
 * place (empty until its data exists, PR 25) and the Sound block; Around the house and
 * the network card in the right wing. When the moods and Sonos are both out, the centre
 * shows one status card; the two blocks stay mounted (hidden) so they keep reading.
 */
export function Home() {
  const moods = useCentreStatus((s) => s.moods.state);
  const sonos = useCentreStatus((s) => s.sonos.state);
  const out = bothOut(moods, sonos);
  return (
    <section className="home zones" data-place="home" aria-label="Home">
      <LeftWing />
      <div className={out ? 'home-centre both-out' : 'home-centre'}>
        {out && <CentreStatus now={(reviewNow ?? Date.now)()} />}
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
