import { useEffect } from 'react';
import { create } from 'zustand';
import { spotify, type SpotifyStatus } from '../../music/spotify';
import { useVisible } from '../../ui/useVisible';

/** How often the card and Up next ask whether Spotify is set up and signed in. */
export const STATUS_POLL_MS = 60_000;

interface StatusState {
  /** Null until the first answer. */
  status: SpotifyStatus | null;
  /** The status call itself failed (the helper or the bridge did not answer). */
  failed: boolean;
}

export const useSpotifyStatus = create<StatusState>(() => ({ status: null, failed: false }));

/** Ask once now (after a sign-in in Tools, or a Retry). */
export async function readSpotifyStatus(): Promise<void> {
  try {
    const status = await spotify.status();
    useSpotifyStatus.setState({ status: status && typeof status === 'object' ? status : null, failed: !status });
  } catch {
    useSpotifyStatus.setState({ failed: true });
  }
}

/** Polls the status while the page is visible; Unwind's Listen view holds it. */
export function useSpotifyStatusPoll(): void {
  const visible = useVisible();
  useEffect(() => {
    if (!visible) return;
    void readSpotifyStatus();
    const id = setInterval(() => void readSpotifyStatus(), STATUS_POLL_MS);
    return () => clearInterval(id);
  }, [visible]);
}

/** Tests only. */
export function resetSpotifyStatus(): void {
  useSpotifyStatus.setState({ status: null, failed: false });
}

/** Ready to browse and play: set up and signed in. */
export function spotifyReady(s: StatusState): boolean {
  return !!s.status && s.status.setup && s.status.signedIn;
}
