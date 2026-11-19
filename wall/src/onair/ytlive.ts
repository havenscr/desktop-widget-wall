import { invoke } from '../bridge/tauri';

/**
 * Types and typed `invoke` wrappers for the YouTube live commands (`wall2_ytlive_*`). The native side keeps the token, the live
 * chat id and the page token behind it; nothing here is ever a URL, an id of a chat, an address or a token. Times are Unix
 * milliseconds. Chat text and names are held in memory only.
 */
export type LiveState = 'not-set-up' | 'signed-out' | 'none' | 'scheduled' | 'live';

export interface LiveChannel {
  set: boolean;
  title: string | null;
}

export interface LiveStatus {
  state: LiveState;
  startedAt: number | null;
  scheduledAt: number | null;
  viewers: number | null;
  /** True when the broadcast has a chat the wall may read. */
  chat: boolean;
  readAt: number | null;
  stale: boolean;
  word: string | null;
  statusLeft: number;
  chatLeft: number;
}

export type ChatState = 'off' | 'ok' | 'ended' | 'quota';

export interface LiveMessage {
  id: string;
  name: string;
  text: string;
  at: number;
  superChat: string | null;
}

export interface LiveChat {
  state: ChatState;
  /** At most 30, oldest first. */
  messages: LiveMessage[];
  readAt: number | null;
  stale: boolean;
  stoppedAt: number | null;
  word: string | null;
}

/** Fixed words the channel commands reject with. */
export type ChannelError = 'invalid' | 'not found';

export const ytlive = {
  channel: () => invoke<LiveChannel>('wall2_ytlive_channel'),
  setChannel: (text: string) => invoke<LiveChannel>('wall2_ytlive_set_channel', { text }),
  forgetChannel: () => invoke<null>('wall2_ytlive_forget_channel'),
  status: (fresh?: boolean) => invoke<LiveStatus>('wall2_ytlive_status', { fresh: fresh === true }),
  chat: () => invoke<LiveChat>('wall2_ytlive_chat'),
};

/** Status older than this is shown as "as of". */
export const STATUS_STALE_MS = 180_000;
/** Chat older than this is shown dimmed. */
export const CHAT_STALE_MS = 60_000;
/** How often the status is read, and the chat while a show is live. */
export const STATUS_POLL_MS = 60_000;
export const CHAT_POLL_MS = 10_000;

export const statusStale = (s: LiveStatus, now: number): boolean => s.stale || (s.readAt !== null && now - s.readAt > STATUS_STALE_MS);
export const chatStale = (c: LiveChat, now: number): boolean => c.stale || (c.readAt !== null && now - c.readAt > CHAT_STALE_MS);

/** What the channel field says for a rejection (the fixed words of the native side). */
export function channelErrorText(e: unknown): string {
  const w = typeof e === 'string' ? e : e instanceof Error ? e.message : '';
  if (w === 'invalid') return 'That is not a handle or a channel link';
  if (w === 'not found') return 'YouTube has no channel with that handle';
  return 'Could not check the channel';
}
