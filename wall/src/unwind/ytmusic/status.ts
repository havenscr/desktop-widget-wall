import { useEffect, useRef } from 'react';
import { create } from 'zustand';
import { youtube, type YoutubeStatus } from '../../music/youtube';
import { useToolsStore } from '../../tools/store';
import { useVisible } from '../../ui/useVisible';

/** How often the YouTube side asks whether YouTube is set up and signed in. */
export const YT_STATUS_POLL_MS = 60_000;

interface StatusState {
  /** Null until the first answer. */
  status: YoutubeStatus | null;
  /** The status call itself failed (the bridge did not answer). */
  failed: boolean;
}

export const useYoutubeStatus = create<StatusState>(() => ({ status: null, failed: false }));

/** Ask once now (after the Tools drawer closes, a Retry, or a read that says to sign in again). */
export async function readYoutubeStatus(): Promise<void> {
  try {
    const status = await youtube.status();
    useYoutubeStatus.setState({ status: status && typeof status === 'object' ? status : null, failed: !status });
  } catch {
    useYoutubeStatus.setState({ failed: true });
  }
}

/**
 * Polls while the page is visible, and reads once more whenever the Tools drawer closes, so a
 * sign-in done there shows in the card at once. The YouTube side holds it, so it runs only
 * while that side shows.
 */
export function useYoutubeStatusPoll(): void {
  const visible = useVisible();
  useEffect(() => {
    if (!visible) return;
    void readYoutubeStatus();
    const id = setInterval(() => void readYoutubeStatus(), YT_STATUS_POLL_MS);
    return () => clearInterval(id);
  }, [visible]);
  const drawerOpen = useToolsStore((s) => s.open);
  const was = useRef(drawerOpen);
  useEffect(() => {
    if (was.current && !drawerOpen) void readYoutubeStatus();
    was.current = drawerOpen;
  }, [drawerOpen]);
}

/** Tests only. */
export function resetYoutubeStatus(): void {
  useYoutubeStatus.setState({ status: null, failed: false });
}

/** Ready to browse: set up and signed in. */
export function youtubeReady(s: StatusState): boolean {
  return !!s.status && s.status.setup && s.status.signedIn;
}
