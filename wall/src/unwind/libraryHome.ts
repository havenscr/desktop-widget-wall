import { create } from 'zustand';

interface SpotifyHome {
  /** The Spotify panel is on an inner page (a playlist or album): its heading then goes home. */
  inside: boolean;
  /** Counts the heading clicks; the panel closes its inner page when the count changes. */
  rev: number;
}

/** What the card's top heading and the Spotify panel tell each other (YouTube Music's page is in its own store). */
export const useSpotifyHome = create<SpotifyHome>(() => ({ inside: false, rev: 0 }));

/** The panel tells the heading whether it is on an inner page. */
export function setSpotifyInside(inside: boolean): void {
  if (useSpotifyHome.getState().inside !== inside) useSpotifyHome.setState({ inside });
}

/** The heading click: asks the panel to close its inner page, as its Back control does. */
export function goSpotifyHome(): void {
  useSpotifyHome.setState((s) => ({ rev: s.rev + 1 }));
}
