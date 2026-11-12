import { FocusTimer } from '../focus/FocusTimer';
import type { WeatherState } from '../weather/useWeather';
import { WeatherCardView } from '../weather/WeatherCard';

/**
 * The Work centre zone (1290 px). Until the agent lanes land (PR 13), and whenever the
 * helper answers not configured, it shows content that fills it rather than an empty
 * "Agents" card: the focus timer at full size and the weather with today's range and
 * the next hours. PR 13 changes only this file: it renders the lanes when the helper is
 * configured and keeps this fill otherwise.
 */
export function CentreSlot({ weather }: { weather: WeatherState }) {
  return (
    <div className="centre centre-fill">
      <FocusTimer />
      <WeatherCardView state={weather} />
    </div>
  );
}
