import { FocusTimer } from '../focus/FocusTimer';
import { MusicBar } from '../music/MusicBar';
import { WeatherCard } from '../weather/WeatherCard';

/** The Work tab: focus ring and weather in the middle, music bar bottom right. Clock is in App. */
export function Work() {
  return (
    <section className="work" data-place="work" aria-label="Work">
      <FocusTimer />
      <WeatherCard />
      <MusicBar />
    </section>
  );
}
