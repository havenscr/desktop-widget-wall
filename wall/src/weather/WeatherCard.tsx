import { staleText } from './model';
import { useWeather } from './useWeather';
import { WeatherIcon } from './WeatherIcon';

export function WeatherCard() {
  const { reading, failed, now } = useWeather();
  if (!reading) {
    return (
      <section className="panel weather" aria-label="Weather">
        <span className="k">Weather</span>
        <div className="s">{failed ? 'Weather unavailable' : 'Loading weather'}</div>
      </section>
    );
  }
  const stale = staleText(reading.fetchedAt, now);
  return (
    <section className="panel weather" aria-label="Weather">
      <div className="row sb">
        <span className="k">Weather</span>
        {stale && <span className="xs">{stale}</span>}
      </div>
      <div className="wx-now">
        <span className="wx-icon">
          <WeatherIcon name={reading.look.icon} size={64} />
        </span>
        <div>
          <div className="wx-temp">{reading.temp}°</div>
          <div className="s">{reading.look.label}</div>
        </div>
        <div className="wx-range s">
          <span>High {reading.high}°</span>
          <span>Low {reading.low}°</span>
        </div>
      </div>
      <ol className="wx-hours">
        {reading.hours.map((h) => (
          <li key={h.label}>
            <span className="xs">{h.label}</span>
            <WeatherIcon name={h.look.icon} size={32} />
            <span className="b6">{h.temp}°</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
