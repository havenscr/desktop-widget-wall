import { isKnownPlayerName, procName } from '../music/players';

/** The process the wall's own hidden video player runs in. It is never a name to show. */
const WALL_PLAYER = 'msedgewebview2';

/** True when `name` is the wall's own web view, in any case and with or without `.exe`. */
export function isWallPlayer(name: string | null | undefined): boolean {
  return typeof name === 'string' && procName(name) === WALL_PLAYER;
}

/** The neutral words for a source the wall cannot name: the web view, or an app whose name is only an id. */
export const UNNAMED_SOURCE = 'an app on this PC';

/**
 * A source name as the screen may show it. Only a known player's friendly name (Spotify, Edge, and so on) is
 * shown as it is; the web view's name, a raw app id (such as one a browser gives an installed web app) and
 * any other name are replaced by the neutral words. The one place a raw source name is made safe to show.
 */
export function shownSource<T extends string | null | undefined>(name: T): T | string {
  if (name === null || name === undefined || name === '') return name;
  return isKnownPlayerName(name) ? name : UNNAMED_SOURCE;
}

/** The eyebrow words for something the wall's own player played last. */
export const ON_THE_WALL = 'Last played on the wall';
/** The line when the wall no longer knows which video it was. */
export const PICK_IN_WATCH = 'Pick it in Watch to play again';
