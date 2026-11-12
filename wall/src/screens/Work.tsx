import { FocusTimer } from '../focus/FocusTimer';
import { MusicBar } from '../music/MusicBar';
import { TaskCard } from '../tasks/TaskCard';
import { WeatherCard } from '../weather/WeatherCard';

/** The Work tab: focus ring and weather in the middle, next three tasks top right, music bar below them. Clock is in App. */
export function Work() {
  return (
    <section className="work" data-place="work" aria-label="Work">
      <FocusTimer />
      <WeatherCard />
      <TaskCard />
      <MusicBar />
    </section>
  );
}
