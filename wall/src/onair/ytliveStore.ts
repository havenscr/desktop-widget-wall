import { useEffect } from 'react';
import { create } from 'zustand';
import { channelErrorText, CHAT_POLL_MS, STATUS_POLL_MS, ytlive, type LiveChannel, type LiveChat, type LiveStatus } from './ytlive';
import { useAwake } from './useNow';

/**
 * The YouTube live state of the new On Air frame. Everything here lives in memory only: no chat text, name or channel is written
 * to a log, to storage or to disk by this file.
 */
export interface YtLiveState {
  channel: LiveChannel | null;
  status: LiveStatus | null;
  chat: LiveChat | null;
  /** True while a channel text is being checked. */
  checking: boolean;
  /** One line after a refused channel text; null when there is none. */
  channelError: string | null;
  loadChannel: () => Promise<void>;
  setChannel: (text: string) => Promise<boolean>;
  forgetChannel: () => Promise<void>;
  readStatus: (fresh?: boolean) => Promise<void>;
  readChat: () => Promise<void>;
  clearChannelError: () => void;
  reset: () => void;
}

const EMPTY = { channel: null, status: null, chat: null, checking: false, channelError: null };

export const useYtLive = create<YtLiveState>((set, get) => ({
  ...EMPTY,
  loadChannel: async () => {
    try {
      set({ channel: await ytlive.channel() });
    } catch {
      // The channel line says nothing until a read works.
    }
  },
  setChannel: async (text) => {
    if (get().checking) return false;
    set({ checking: true, channelError: null });
    try {
      const channel = await ytlive.setChannel(text);
      set({ channel, checking: false, chat: null });
      void get().readStatus(true);
      return true;
    } catch (e) {
      set({ checking: false, channelError: channelErrorText(e) });
      return false;
    }
  },
  forgetChannel: async () => {
    try {
      await ytlive.forgetChannel();
      set({ channel: { set: false, title: null }, status: null, chat: null, channelError: null });
    } catch {
      set({ channelError: 'Could not forget the channel' });
    }
  },
  readStatus: async (fresh) => {
    try {
      const status = await ytlive.status(fresh);
      set((s) => ({ status, chat: status.state === 'live' && status.chat ? s.chat : null }));
    } catch {
      // The last good status stays and goes stale by its own read time.
    }
  },
  readChat: async () => {
    const st = get().status;
    if (!st || st.state !== 'live' || !st.chat) return;
    try {
      set({ chat: await ytlive.chat() });
    } catch {
      // The last good chat stays and goes stale by its own read time.
    }
  },
  clearChannelError: () => set({ channelError: null }),
  reset: () => set({ ...EMPTY }),
}));

/**
 * Reads the channel once and the status every 60 seconds, only while On Air shows and the page is awake.
 * Nothing is read while the page is hidden or the display is off.
 */
export function useLivePolling(): void {
  const awake = useAwake();
  useEffect(() => {
    if (!awake) return;
    const s = useYtLive.getState();
    void s.loadChannel();
    void s.readStatus();
    const id = setInterval(() => void useYtLive.getState().readStatus(), STATUS_POLL_MS);
    return () => clearInterval(id);
  }, [awake]);
}

/** Reads the chat every 10 seconds, only while the status says live with a readable chat, the Live page shows and the page is awake. */
export function useChatPolling(): void {
  const awake = useAwake();
  const live = useYtLive((s) => s.status?.state === 'live' && s.status.chat);
  useEffect(() => {
    if (!awake || !live) return;
    void useYtLive.getState().readChat();
    const id = setInterval(() => void useYtLive.getState().readChat(), CHAT_POLL_MS);
    return () => clearInterval(id);
  }, [awake, live]);
}
