import { tip } from '../ui/HoverTip';
import { usageMeters, usageTip, type OmniSummary } from './model';
import { focusSession } from './open';

/**
 * Under the cards (concept `.shelf`): how many chats are parked (a click brings OmniGent
 * forward), and usage: one small meter per subscription from a newer helper (the week's
 * percent, the five hour figure inline when there is room, the reset time on hover; the
 * fullest turns amber above 90), or Claude's week as one bar from an older one, with the
 * five hour figure when the helper has one. The mail count waits for the mail scope (D7).
 */
export function Shelf({ summary, stale = false }: { summary: OmniSummary; stale?: boolean }) {
  const u = summary.usage;
  const meters = usageMeters(u);
  const perAccount = !!u?.accounts && u.accounts.length > 0;
  const inline5h = meters.length <= 2;
  return (
    <div className={`shelf${stale ? ' stale' : ''}`}>
      <button
        type="button"
        className="shelf-parked"
        onClick={() => focusSession()}
        {...tip(summary.parked > 0 ? 'Parked sessions rest in OmniGent. Click to bring OmniGent forward.' : 'Click to bring OmniGent forward.')}
      >
        {summary.parked > 0 ? (
          <>
            <b>{summary.parked}</b> parked, resting
          </>
        ) : (
          'Nothing parked'
        )}
      </button>
      <span className="grow" />
      {!perAccount && u && u.claude5hPct !== null && (
        <span>
          Claude 5 h <b>{Math.round(u.claude5hPct)}%</b>
        </span>
      )}
      {meters.map((m) => (
        <span key={m.label} className={`shelf-week${m.warn ? ' t-amber' : ''}${perAccount ? ' acct' : ''}`} {...tip(stale ? `${usageTip(m)} (may be out of date)` : usageTip(m))} aria-label={usageTip(m)}>
          <span>{m.label}</span>
          <i className="bar" aria-hidden="true">
            <i style={{ width: `${Math.round(m.pct ?? 0)}%` }} />
          </i>
          <b>{m.pct === null ? 'n/a' : `${Math.round(m.pct)}%`}</b>
          {perAccount && inline5h && m.fiveHour !== null && <span className="xs">5 h {Math.round(m.fiveHour)}%</span>}
          {m.hotHidden && <i className="hot-5h" aria-label={`Five hour window ${Math.round(m.fiveHour ?? 0)}%`} />}
        </span>
      ))}
    </div>
  );
}
