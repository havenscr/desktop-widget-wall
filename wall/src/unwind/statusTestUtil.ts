import { cards, laneWorks, needsYouCount, waitingIds, type Lane, type OmniSummary } from '../agents/model';
import type { FocusSeen, StatusSummary } from './model';

/** Test helpers only: what the status marks on Unwind draw, read from the page. */
export interface DrawnLine {
  /** `put-away` (briefcase) or `focus` (focus-2). */
  mark: 'put-away' | 'focus' | null;
  dots: number;
  more: string | null;
  ring: boolean;
  /** The network alerts count in the capsule, or null. */
  net: string | null;
  /** The amber pill's words, or null. */
  pill: string | null;
}

/** The marks on the page, or null when the line draws nothing. */
export function drawnLine(): DrawnLine | null {
  const l = document.querySelector('.u-line');
  if (!l) return null;
  const mark = l.querySelector('.u-mark');
  return {
    mark: mark ? (mark.classList.contains('tabler-icon-focus-2') ? 'focus' : 'put-away') : null,
    dots: l.querySelectorAll('.u-cap .u-dot').length,
    more: l.querySelector('.u-more')?.textContent ?? null,
    ring: l.querySelector('.u-ring') !== null,
    net: l.querySelector('.u-cap-net')?.textContent ?? null,
    pill: l.querySelector('.u-need')?.textContent ?? null,
  };
}

/*
 * The old status sentence ("Work is put away. 2 agents still running. No agent needs you."), frozen here as the
 * reference the table test holds the status marks to. Nothing in the app calls it: Unwind draws marks now, and
 * `statusMarks` in `model.ts` does the counting. Do not change it to follow the marks; the point is that it does not.
 */
/**
 * One part of the status line: plain text, the running agents (a chip that switches to
 * Work), or the things that need the owner (an amber chip that opens the first waiting
 * chat, `open` being its session id; null when it cannot be opened, then plain text).
 */
export type StatusPart =
  | { kind: 'text'; text: string }
  | { kind: 'running'; text: string }
  | { kind: 'needs'; text: string; open: string | null };

/**
 * "Work is put away. 2 agents still running. No agent needs you." as parts. The first
 * sentence needs the focus store loaded: a session running or paused says "Focus is still
 * on.", and before it has loaded nothing is said about it. The agent and needs-you parts
 * need a current helper summary: without the helper, or when it says its data is stale,
 * they are left out, and so is a needs-you count that is not a number. "No agent needs
 * you." is plain text; "N things need you" opens the first waiting chat when links are
 * available (the summary's first your-move session, else the first lane that waits).
 */
export function statusParts(focus: FocusSeen, summary: StatusSummary | null, snoozed: ReadonlySet<string> = new Set()): StatusPart[] {
  const parts: StatusPart[] = [];
  if (focus === 'on') parts.push({ kind: 'text', text: 'Focus is still on.' });
  else if (focus === 'off') parts.push({ kind: 'text', text: 'Work is put away.' });
  if (summary && summary.stale !== true) {
    // The same rules Work and Dream use: a lane that waits on the owner is not running, and a
    // waiting lane counts as needing the owner even when the helper's your-move total is lower.
    const lanes = cards({ lanes: summary.lanes as Lane[], sessionsList: summary.sessionsList as Lane[] | null | undefined ?? null });
    const running = lanes.filter(laneWorks).length;
    if (running > 0) parts.push({ kind: 'running', text: `${running} ${running === 1 ? 'agent' : 'agents'} still running.` });
    const total = summary.yourMove.total;
    if (typeof total === 'number' && Number.isFinite(total) && total >= 0) {
      // A session quietened with "Later" on Work stays quiet here until its snooze ends.
      const partial = { yourMove: summary.yourMove, lanes } as unknown as OmniSummary;
      const asks = Math.floor(needsYouCount(partial, snoozed));
      if (asks === 0) parts.push({ kind: 'text', text: 'No agent needs you.' });
      else {
        const first = summary.yourMove.first?.sessionId;
        const id =
          (first && !snoozed.has(first) ? first : null) ||
          waitingIds(partial).find((w) => !snoozed.has(w)) ||
          summary.lanes.find((l) => (l.waiting || l.state === 'blocked') && !(l.id && snoozed.has(l.id)))?.id ||
          null;
        parts.push({ kind: 'needs', text: asks === 1 ? 'One thing needs you.' : `${asks} things need you.`, open: summary.linksAvailable === true && id ? id : null });
      }
    }
  }
  return parts;
}

/** The status line as one string (the parts' words, in order). */
export function statusLine(focus: FocusSeen, summary: StatusSummary | null, snoozed: ReadonlySet<string> = new Set()): string {
  return statusParts(focus, summary, snoozed)
    .map((p) => p.text)
    .join(' ');
}
