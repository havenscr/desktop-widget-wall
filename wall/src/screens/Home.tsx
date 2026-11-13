import { useEffect, useState } from 'react';
import { bothOut, useCentreStatus } from '../home/centreSources';
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
/** Without an answer from Sonos for this long, the centre settles on its fallback layout. */
export const SOUND_WAIT_MS = 2500;

export function Home() {
  const moods = useCentreStatus((s) => s.moods.state);
  const sonos = useCentreStatus((s) => s.sonos.state);
  const out = bothOut(moods, sonos);
  // The centre loads at its final sizes (moods short, the Sound block full). The tall-mood
  // layout is chosen only once Sonos has said "not set up", has failed, or has been silent
  // for 2.5 seconds; the change is one slow fade (see home.css), never a jump.
  const [waited, setWaited] = useState(false);
  useEffect(() => {
    if (sonos !== 'loading') return;
    const id = setTimeout(() => setWaited(true), SOUND_WAIT_MS);
    return () => clearTimeout(id);
  }, [sonos]);
  const fallback = sonos === 'unconfigured' || sonos === 'down' || (sonos === 'loading' && waited);
  const cls = ['home-centre', out ? 'both-out' : '', fallback ? 'tall' : ''].filter(Boolean).join(' ');
  return (
    <section className="home zones" data-place="home" aria-label="Home">
      <LeftWing />
      <div className={cls}>
        {out && <CentreStatus now={(reviewNow ?? Date.now)()} />}
        <Moods />
        <Rooms />
        <Sound fallback={fallback} />
      </div>
      <div className="home-right">
        <Chores />
        <NetworkTile />
      </div>
    </section>
  );
}
