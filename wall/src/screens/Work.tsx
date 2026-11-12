import { useContext } from 'react';
import { createPortal } from 'react-dom';
import { CentreSlot } from '../agents/CentreSlot';
import { TaskCard } from '../tasks/TaskCard';
import { useWeather } from '../weather/useWeather';
import { WeatherLine } from '../weather/WeatherCard';
import { LeftWing } from '../work/LeftWing';
import { ClockSlot } from './Frame';

/**
 * The Work tab on the concept's zones (`f_work`): the left wing under the clock, the
 * centre slot, and the next three tasks on the right. One weather read feeds the line
 * after the date and the centre card.
 */
export function Work() {
  const weather = useWeather();
  const slot = useContext(ClockSlot);
  return (
    <section className="work zones" data-place="work" aria-label="Work">
      {slot && createPortal(<WeatherLine state={weather} />, slot)}
      <LeftWing />
      <CentreSlot weather={weather} />
      <div className="wing wr">
        <TaskCard />
      </div>
    </section>
  );
}
