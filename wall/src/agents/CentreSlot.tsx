import type { ReactNode } from 'react';
import { FocusTimer } from '../focus/FocusTimer';
import type { WeatherState } from '../weather/useWeather';
import { WeatherCardView } from '../weather/WeatherCard';
import { WeatherIcon } from '../weather/WeatherIcon';
import { Lanes } from './Lanes';
import { useAgents } from './useAgents';

/**
 * The fill: the focus timer at full size and the weather with today's range and the next
 * hours. Before the first weather reading, or when the first fetch fails, the focus card
 * takes the whole width and the weather status is one line inside it. `note` is one quiet
 * line under it (the agents' state when the lanes cannot show).
 */
function Fill({ weather, note, className = 'centre centre-fill' }: { weather: WeatherState; note?: ReactNode; className?: string }) {
  const noteRow = note ? <div className="centre-note xs">{note}</div> : null;
  if (!weather.reading) {
    return (
      <div className={`${className} solo`}>
        <FocusTimer
          note={
            <span className="wx-status">
              <WeatherIcon name="cloud" size={24} />
              {weather.failed ? 'Weather unavailable' : 'Loading weather'}
            </span>
          }
        />
        {noteRow}
      </div>
    );
  }
  return (
    <div className={className}>
      <FocusTimer />
      <WeatherCardView state={weather} />
      {noteRow}
    </div>
  );
}

/**
 * The Work centre zone (1290 px), and the one place that decides what it shows:
 * - the helper answering (fresh, or stale with an earlier answer): the agent lanes;
 * - the helper not set up: the fill, with one quiet line "Agents: not set up";
 * - the helper set up but not answering, with no earlier answer: the fill, with one quiet
 *   amber line "Agents: not reachable";
 * - before the first answer: the fill alone.
 * Never a large empty "Agents" card.
 */
export function CentreSlot({ weather }: { weather: WeatherState }) {
  const a = useAgents();
  if (a.status === 'ready' && a.summary) {
    return (
      <Lanes
        summary={a.summary}
        stale={a.summary.stale || a.readFailed}
        freshAt={a.freshAt}
        now={a.checkedAt}
        idle={<Fill weather={weather} className="centre-fill compact" />}
      />
    );
  }
  if (a.status === 'unconfigured') return <Fill weather={weather} note="Agents: not set up" />;
  if (a.status === 'unreachable') return <Fill weather={weather} note={<span className="t-amber">Agents: not reachable</span>} />;
  return <Fill weather={weather} />;
}
