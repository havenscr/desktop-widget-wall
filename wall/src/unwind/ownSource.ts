import { procName } from '../music/players';

/** The process the wall's own hidden video player runs in. It is never a name to show. */
const WALL_PLAYER = 'msedgewebview2';

/** True when `name` is the wall's own web view, in any case and with or without `.exe`. */
export function isWallPlayer(name: string | null | undefined): boolean {
  return typeof name === 'string' && procName(name) === WALL_PLAYER;
}

/**
 * A source name as the screen may show it: the web view's name is replaced by plain words
 * (a live session under it is "an app on this PC", since it may be any web view app); every
 * other name is returned as it is. The one place a raw source name is made safe to show.
 */
export function shownSource<T extends string | null | undefined>(name: T): T | string {
  return isWallPlayer(name) ? 'an app on this PC' : name;
}

/** The eyebrow words for something the wall's own player played last. */
export const ON_THE_WALL = 'Last played on the wall';
/** The line when the wall no longer knows which video it was. */
export const PICK_IN_WATCH = 'Pick it in Watch to play again';
