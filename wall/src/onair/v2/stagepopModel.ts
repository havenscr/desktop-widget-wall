/** What `wall2_stagepop_status` answers (and the `stagepop-state` event carries). No code, no origin. */
export interface SpFeed {
  key: string;
  name: string;
}

export type SpRun = 'off' | 'port busy' | 'waiting' | 'connected';

export interface SpStatus {
  state: SpRun;
  feeds: SpFeed[];
  mode: string | null;
  window: { open: boolean; fullscreen: boolean };
  placement: { left: number | null; top: number | null; source: 'saved' | 'elgato' | 'none' };
  /** none: no code made yet; ready: made, not shown yet; hidden: shown once already. */
  token: 'none' | 'ready' | 'hidden';
}

export const SP_OFF: SpStatus = { state: 'off', feeds: [], mode: null, window: { open: false, fullscreen: false }, placement: { left: null, top: null, source: 'none' }, token: 'none' };

/** The words beside the heading. What the add-on reports, never what the wall asked for. */
export function spWord(s: SpStatus): string {
  if (s.state !== 'connected') return 'Not connected';
  if (!s.window.open) return 'Closed';
  return s.window.fullscreen ? 'Full screen' : 'Open';
}

/** The line that stands in for the view buttons when there is nothing to switch. Null when the buttons show. */
export function spBanner(s: SpStatus): string | null {
  if (s.state === 'off') return 'The pop-out link is off on this PC.';
  if (s.state === 'port busy') return 'Port 47231 is in use by another program.';
  if (s.state === 'waiting') return 'Firefox add-on not connected. Open the studio tab in Firefox.';
  if (s.feeds.length === 0) return 'Connected. Waiting for the studio tab to list its views.';
  return null;
}

/** The add-on names the screen share "Screenshare"; the wall labels it Share. */
export function isShare(f: SpFeed): boolean {
  return f.key !== 'stage' && /^(screen\s?share|share)$/i.test(f.name.trim());
}

export function spLabel(f: SpFeed): string {
  if (f.key === 'stage') return 'Stage';
  return isShare(f) ? 'Share' : f.name;
}

/** Stage first, then the screen share, then the cameras in the order the add-on listed them. */
export function spOrder(feeds: SpFeed[]): SpFeed[] {
  const rank = (f: SpFeed) => (f.key === 'stage' ? 0 : isShare(f) ? 1 : 2);
  return feeds.map((f, i) => ({ f, i })).sort((a, b) => rank(a.f) - rank(b.f) || a.i - b.i).map((x) => x.f);
}

/** The hover card of a view button. */
export function spViewTip(f: SpFeed): string {
  if (f.key === 'stage') return 'Show the whole stage in the pop-out';
  if (isShare(f)) return 'Show the screen share alone in the pop-out';
  return `Show ${f.name} alone in the pop-out`;
}

export const SP_OPEN_TIP = 'Open the pop-out window on the Elgato monitor';
export const SP_OPEN_TIP_FREE = 'Open the pop-out window. No Elgato monitor found, so it opens where Firefox puts it';
export const SP_NOT_CONNECTED_TIP = 'Needs the Firefox add-on. Open the studio tab in Firefox';
