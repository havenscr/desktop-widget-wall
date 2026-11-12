import type { OmniSummary } from './model';

/**
 * Under the lanes (concept `.shelf`): how many chats are parked, and Claude's usage this
 * week as a bar, with the five hour figure when the helper has one. The mail count waits
 * for the mail scope (D7).
 */
export function Shelf({ summary }: { summary: OmniSummary }) {
  const u = summary.usage;
  return (
    <div className="shelf">
      <span>{summary.parked > 0 ? <><b>{summary.parked}</b> parked, resting</> : 'Nothing parked'}</span>
      <span className="grow" />
      {u && u.claude5hPct !== null && (
        <span>
          Claude 5 h <b>{Math.round(u.claude5hPct)}%</b>
        </span>
      )}
      {u && (
        <span className="shelf-week">
          <span>Claude this week</span>
          <i className="bar" aria-hidden="true">
            <i style={{ width: `${Math.round(u.claudeWeekPct)}%` }} />
          </i>
          <b>{Math.round(u.claudeWeekPct)}%</b>
        </span>
      )}
    </div>
  );
}
