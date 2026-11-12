import { staleText } from './model';
import { useWeather, type WeatherState } from './useWeather';
import { WeatherIcon } from './WeatherIcon';

/** The full weather card: now, today's range and the next hours. Reads the weather itself. */
export function WeatherCard() {
  return <WeatherCardView state={useWeather()} />;
}

/** The card for a reading someone else holds (Work reads once for its clock line and this card). */
export function WeatherCardView({ state }: { state: WeatherState }) {
  const { reading, failed, now } = state;
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

/** The weather after the date on Work: icon, temperature and a short condition ("58°, clearing"). Empty until a reading. */
export function WeatherLine({ state }: { state: WeatherState }) {
  const r = state.reading;
  if (!r) return null;
  return (
    <span className="wx-line" aria-label={`Weather ${r.temp} degrees, ${r.look.label}`}>
      <WeatherIcon name={r.look.icon} size={24} />
      {`${r.temp}°, ${r.look.label.toLowerCase()}`}
    </span>
  );
}
