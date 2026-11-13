import { useEffect, useMemo, useState } from 'react';
import { invoke } from '../bridge/tauri';
import { scrollToCard } from '../agents/cardScroll';
import { cards, mergeReady, questionFor, sessionTitle, waitingIds, type OmniSummary } from '../agents/model';
import { useSnoozed } from '../agents/snooze';
import { agentsStale, useAgents } from '../agents/useAgents';
import { ageText, alertRows, type SecuritySummary } from '../home/model';
import { useSecurity } from '../home/useSecurity';
import type { Meeting } from '../meet/model';
import { useNextMeeting } from './useNextMeeting';
import { viaCommand } from './wallActions';

/** A meeting counts as "for you" from this long before it starts until it ends. */
export const MEETING_LEAD_MS = 10 * 60_000;
/** "Show" flashes the card's ring this long. */
export const FLASH_MS = 1_400;

export type ForYouKind = 'meeting' | 'waiting' | 'merge' | 'alarm';

/** One line of the "For you" page: an icon kind, a title, a short reason and one action. */
export interface ForYouItem {
  /** Stable while the same thing waits, so Auto can tell a new item from one still there. */
  key: string;
  kind: ForYouKind;
  title: string;
  reason: string;
  /** The button's words. */
  action: string;
  /** What the button does, in plain words, for the tooltip. */
  actionTip: string;
  /** The session or meeting key the action uses. */
  ref: string | null;
}

const min = (ms: number) => Math.max(1, Math.round(ms / 60_000));

/** The meeting that starts within 10 minutes or is live, as an item; null otherwise. */
export function meetingItem(m: Meeting | undefined, now: number, trusted: boolean): ForYouItem | null {
  if (!m || !trusted || !m.canJoin) return null;
  const start = Date.parse(m.start);
  const end = Date.parse(m.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= now || start - now > MEETING_LEAD_MS) return null;
  const live = start <= now;
  return {
    key: `meeting:${m.key}`,
    kind: 'meeting',
    title: m.title || 'Meeting',
    reason: live ? `live, ${min(end - now)} min left` : `starts in ${min(start - now)} min`,
    action: 'Join',
    actionTip: 'Open the meeting in its app',
    ref: m.key,
  };
}

/** Sessions waiting on the owner (not snoozed with "Later"), from a trusted summary. */
export function waitingItems(s: OmniSummary, snoozed: ReadonlySet<string>): ForYouItem[] {
  const helperNow = Date.parse(s.now);
  return waitingIds(s)
    .filter((id) => !snoozed.has(id))
    .map((id) => {
      const lane = cards(s).find((l) => l.id === id) ?? s.lanes.find((l) => l.id === id);
      const q = questionFor(s, id);
      const since = lane?.waitingSinceS;
      const waited = typeof since === 'number' && Number.isFinite(helperNow) ? `waiting ${min(since * 1000)} min` : 'waiting on you';
      return {
        key: `waiting:${id}`,
        kind: 'waiting' as const,
        title: sessionTitle(s, id) ?? 'A session',
        reason: q ? `asks: ${q}` : waited,
        action: 'Open chat',
        actionTip: 'Open this session in the OmniGent app and bring it forward',
        ref: id,
      };
    });
}

/** Sessions whose pull request is ready to merge. The merge itself stays on the card. */
export function mergeItems(s: OmniSummary): ForYouItem[] {
  return cards(s)
    .filter(mergeReady)
    .map((l) => ({
      key: `merge:${l.id}`,
      kind: 'merge' as const,
      title: l.title,
      reason: l.pr ? `PR ${l.pr.number} ready to merge` : 'ready to merge',
      action: 'Show',
      actionTip: 'Scroll the agent cards to it. Hold to merge stays on the card.',
      ref: l.id,
    }));
}

/** The first open network alarm, only from a fresh, reachable read. */
export function alarmItem(sec: SecuritySummary | null, status: string, linkOk: boolean, now: number): ForYouItem | null {
  if (!sec || status !== 'ready' || !linkOk || !sec.reachable || sec.stale || sec.alerts <= 0) return null;
  const row = alertRows(sec)[0];
  if (!row) return null;
  const age = ageText(row.atMs, now);
  return {
    key: `alarm:${row.text}`,
    kind: 'alarm',
    title: row.text,
    reason: age ? `${age === 'now' ? 'just now' : `${age} ago`}${sec.alerts > 1 ? `, ${sec.alerts} open` : ''}` : sec.alerts > 1 ? `${sec.alerts} open alarms` : 'open alarm',
    action: 'Open',
    actionTip: 'Open the network alarms where Home opens them',
    ref: null,
  };
}

const flashTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** Scroll the agent cards to a session and flash its ring once (calm: one slow pulse). A second Show restarts the flash. */
export function showCard(id: string): void {
  scrollToCard(id);
  setTimeout(() => {
    const el = [...document.querySelectorAll<HTMLElement>('.lane[data-id]')].find((e) => e.dataset.id === id);
    if (!el) return;
    clearTimeout(flashTimers.get(id));
    el.classList.remove('deck-flash');
    void el.offsetWidth;
    el.classList.add('deck-flash');
    flashTimers.set(
      id,
      setTimeout(() => {
        el.classList.remove('deck-flash');
        flashTimers.delete(id);
      }, FLASH_MS),
    );
  }, 0);
}

/**
 * Run one item's action through the command that already exists for it, and answer with one
 * short line. A failure throws `ActionError` with a fixed line.
 */
export async function runForYou(item: ForYouItem): Promise<string> {
  switch (item.kind) {
    case 'meeting':
      return viaCommand('wall2_meet_join', { key: item.ref }, 'Joining the meeting', 'Could not open the meeting');
    case 'waiting':
      return viaCommand('wall2_focus_omnigent', { id: item.ref }, 'Opened the chat', 'Could not open the chat');
    case 'merge':
      if (item.ref) showCard(item.ref);
      return 'Showing the card';
    case 'alarm':
      return viaCommand('wall2_open_link', { kind: 'security' }, 'Opened the alarms', 'Could not open the alarms');
  }
}

/**
 * Everything that waits on the owner, in order: a meeting, agents waiting, pull requests
 * ready, a network alarm. A source that is stale, down or not set up adds nothing, and the
 * agents helper being down says nothing about agents. Never shown from old data.
 */
export function useForYou(): ForYouItem[] {
  const meet = useNextMeeting();
  const agents = useAgents();
  const snoozed = useSnoozed(agents.summary);
  const sec = useSecurity();
  const [linkOk, setLinkOk] = useState(false);
  // Read again with every security poll, so a link set up later shows without a restart.
  useEffect(() => {
    let live = true;
    invoke<{ security?: boolean }>('wall2_links')
      .then((a) => live && setLinkOk(a?.security === true))
      .catch(() => live && setLinkOk(false));
    return () => {
      live = false;
    };
  }, [sec.attempts]);
  const agentsOk = agents.summary !== null && !agentsStale(agents);
  const quietKey = [...snoozed.ids].sort().join(',');
  return useMemo(() => {
    const out: ForYouItem[] = [];
    const m = meetingItem(meet.meeting, meet.now, !meet.stale && !meet.unavailable);
    if (m) out.push(m);
    if (agents.summary && agentsOk) {
      out.push(...waitingItems(agents.summary, new Set(quietKey ? quietKey.split(',') : [])));
      out.push(...mergeItems(agents.summary));
    }
    const a = alarmItem(sec.summary, sec.status, linkOk, sec.now);
    if (a) out.push(a);
    return out;
  }, [meet.meeting, meet.now, meet.stale, meet.unavailable, agents.summary, agentsOk, quietKey, sec.summary, sec.status, sec.now, linkOk]);
}
