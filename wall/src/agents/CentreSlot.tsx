import { FocusTimer } from '../focus/FocusTimer';
import type { WeatherState } from '../weather/useWeather';
import { WeatherCardView } from '../weather/WeatherCard';
import { WeatherIcon } from '../weather/WeatherIcon';

/**
 * The Work centre zone (1290 px). Until the agent lanes land (PR 13), and whenever the
 * helper answers not configured, it shows content that fills it rather than an empty
 * "Agents" card: the focus timer at full size and the weather with today's range and
 * the next hours. Before the first weather reading, or when the first fetch fails, the
 * focus card takes the whole centre and the weather status is one line inside it. PR 13
 * changes only this file: it renders the lanes when the helper is configured and keeps
 * this fill otherwise.
 */
export function CentreSlot({ weather }: { weather: WeatherState }) {
  if (!weather.reading) {
    return (
      <div className="centre centre-fill solo">
        <FocusTimer
          note={
            <span className="wx-status">
              <WeatherIcon name="cloud" size={24} />
              {weather.failed ? 'Weather unavailable' : 'Loading weather'}
            </span>
          }
        />
      </div>
    );
  }
  return (
    <div className="centre centre-fill">
      <FocusTimer />
      <WeatherCardView state={weather} />
    </div>
  );
}
