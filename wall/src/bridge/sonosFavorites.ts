import { invoke } from './tauri';

/**
 * Typed wrappers for the Sonos favorites commands (`wall2_sonos.rs`; no screen uses them yet). The service has no
 * favorite ids, so Rust makes one for each title and keeps the pairs of the last read; the page only ever sends an id back.
 */

/** `spotify`, `radio` or `other` when the service said one of them. */
export type FavoriteKind = 'spotify' | 'radio' | 'other';

/** One favorite: a 16 digit lowercase hex id, a name cleaned and cut at 120 characters, and a kind or null. */
export interface SonosFavorite {
  id: string;
  name: string;
  kind: FavoriteKind | null;
}

/**
 * Fixed words the favorites commands reject with: `timed-out`, `no-answer`, `bad-answer` (reading the list); `Sonos status is
 * out of date` (read the summary or the list again), `Unknown favorite`, `No room to play on`, `needs-confirm` (call again with
 * `confirm: true` after asking), `Could not reach Sonos`, `Sonos could not do that`, `The request did not finish`.
 */
export type FavoritesError =
  | 'timed-out'
  | 'no-answer'
  | 'bad-answer'
  | 'Sonos status is out of date'
  | 'Unknown favorite'
  | 'No room to play on'
  | 'needs-confirm'
  | 'Could not reach Sonos'
  | 'Sonos could not do that'
  | 'The request did not finish';

/** The service's favorites, at most 100. */
export const readSonosFavorites = (): Promise<SonosFavorite[]> => invoke<SonosFavorite[]>('wall2_sonos_favorites');

/**
 * Play one favorite from the last list on the current group. Needs a recent Sonos summary read as well. A group above volume 40
 * or at an unknown level is refused with `needs-confirm` unless `confirm` is true.
 */
export const playSonosFavorite = (id: string, confirm = false): Promise<void> =>
  invoke<void>('wall2_sonos_favorite_play', confirm ? { favoriteId: id, confirm: true } : { favoriteId: id });
