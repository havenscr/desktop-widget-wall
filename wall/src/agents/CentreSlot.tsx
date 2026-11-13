import type { ReactNode } from 'react';
import { FocusTimer } from '../focus/FocusTimer';
import type { WeatherState } from '../weather/useWeather';
import { WeatherCardView } from '../weather/WeatherCard';
import { WeatherIcon } from '../weather/WeatherIcon';
import { Lanes } from './Lanes';
import { cards } from './model';
import { agentsStale, retryAgents, useAgents } from './useAgents';

/**
 * The fill: the focus timer and the weather with today's range and the next hours, side
 * by side, each filling its box from the heading down. Before the first weather reading,
 * or when the first fetch fails, the focus card takes the whole width and the weather
 * status is one line inside it. `note` is a quiet header row above the two cards, in the
 * place the lanes' header takes (the agents' state when the lanes cannot show).
 */
function Fill({ weather, note, className = 'centre centre-fill' }: { weather: WeatherState; note?: ReactNode; className?: string }) {
  const noteRow = note ? <div className="centre-note">{note}</div> : null;
  const cls = `${className}${weather.reading ? '' : ' solo'}${note ? ' noted' : ''}`;
  if (!weather.reading) {
    return (
      <div className={cls}>
        {noteRow}
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
    <div className={cls}>
      {noteRow}
      <FocusTimer />
      <WeatherCardView state={weather} />
    </div>
  );
}

/** The header row's text for the agents' state: "Agents", then "not set up" or "not reachable" with "Try again". */
function AgentsNote({ unreachable }: { unreachable: boolean }) {
  return (
    <>
      <span className="k">Agents</span>
      {unreachable ? (
        <>
          <span className="xs t-amber">not reachable</span>
          <button type="button" className="note-link" onClick={retryAgents}>
            Try again
          </button>
        </>
      ) : (
        <span className="xs">not set up</span>
      )}
    </>
  );
}

/**
 * The Work centre zone (1290 px), and the one place that decides what it shows:
 * - the helper answering (fresh, or stale with an earlier answer): the agent lanes, dimmed
 *   with "updated N min ago" while stale (also just after the page comes back, until the
 *   first new read returns);
 * - the helper not set up: the fill, under a quiet header row "Agents  not set up";
 * - the helper set up but not answering, with no earlier answer (or only an answer whose own
 *   time is over 30 minutes old): the fill, under the header row "Agents  not reachable"
 *   (amber) with a "Try again" link that reads once at once;
 * - before the first answer: the fill alone.
 * Never a large empty "Agents" card.
 */
export function CentreSlot({ weather }: { weather: WeatherState }) {
  const a = useAgents();
  if (a.status === 'ready' && a.summary) {
    return (
      <Lanes
        summary={a.summary}
        stale={agentsStale(a)}
        freshAt={a.freshAt}
        now={a.checkedAt}
        idle={<Fill weather={weather} className="centre-fill compact" />}
      />
    );
  }
  if (a.status === 'unconfigured') return <Fill weather={weather} note={<AgentsNote unreachable={false} />} />;
  if (a.status === 'unreachable') return <Fill weather={weather} note={<AgentsNote unreachable />} />;
  return <Fill weather={weather} />;
}

/**
 * True when Work's centre shows the Focus card: always except when the agent lanes show at
 * least one session (the same choice `CentreSlot` makes). The left wing then hides its
 * small Focus row, so the timer is shown once.
 */
export function useCentreShowsFocus(): boolean {
  const a = useAgents();
  return !(a.status === 'ready' && a.summary && cards(a.summary).length > 0);
}
