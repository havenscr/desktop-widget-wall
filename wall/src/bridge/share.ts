import { invoke } from './tauri';

/** The words Rust answers with when a share fails (`wall2_share.rs`). Anything else is `failed`. */
export type ShareWord = 'no-key' | 'bad-key' | 'too-big' | 'missing' | 'failed';
const WORDS: readonly ShareWord[] = ['no-key', 'bad-key', 'too-big', 'missing', 'failed'];

/** The plain line for each failure. */
export const SHARE_LINES: Record<ShareWord, string> = {
  'no-key': 'Add the share key in Tools first.',
  'bad-key': 'go-ae.org refused the share key. Check it in Tools.',
  'too-big': 'This file is over 100 MB.',
  missing: 'This capture is gone.',
  failed: 'Could not share. Try again.',
};

/** What the page may learn about the saved key: that one is set, or that the saved one cannot be read. Never the key. */
export interface ShareKeyStatus {
  set: boolean;
  unreadable: boolean;
}

/** A finished share: the short link, and whether Rust managed to put it on the clipboard. */
export interface ShareResult {
  url: string;
  copied: boolean;
}

/** Uploads one capture by id and resolves with its short link and whether it was copied. Rejects with one of the words. */
export async function shareCapture(id: string): Promise<ShareResult> {
  const o = await invoke<unknown>('wall2_captures_share', { id });
  const r = o && typeof o === 'object' ? (o as Record<string, unknown>) : {};
  if (typeof r.url !== 'string' || r.url === '') throw 'failed';
  return { url: r.url, copied: r.copied === true };
}

/** The word in a rejection; anything not recognised is `failed`. */
export function shareWordOf(e: unknown): ShareWord {
  const text = typeof e === 'string' ? e : e instanceof Error ? e.message : '';
  return WORDS.find((w) => w === text) ?? 'failed';
}

export async function readShareKeyStatus(): Promise<ShareKeyStatus> {
  const o = await invoke<unknown>('wall2_share_key_status');
  const r = o && typeof o === 'object' ? (o as Record<string, unknown>) : {};
  return { set: r.set === true, unreadable: r.unreadable === true };
}
export const saveShareKey = (key: string): Promise<void> => invoke<void>('wall2_share_key_set', { key });
export const forgetShareKey = (): Promise<void> => invoke<void>('wall2_share_key_forget');
