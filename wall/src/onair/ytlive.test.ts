import { afterEach, expect, it } from 'vitest';
import { mocks } from '../bridge/tauri';
import { chatStale, statusStale, ytlive, type LiveChat, type LiveStatus } from './ytlive';

const NOW_MS = 1_800_000_000_000;
const NOW_S = NOW_MS / 1000;

const nativeStatus = (readAt: number | null): LiveStatus => ({ state: 'live', startedAt: NOW_MS - 600_000, scheduledAt: null, viewers: 3, chat: true, readAt, stale: false, word: null, statusLeft: 1, chatLeft: 1 });
const nativeChat = (readAt: number | null, stoppedAt: number | null = null): LiveChat => ({ state: 'ok', messages: [{ id: 'a', name: 'N', text: 't', at: NOW_MS - 5000, superChat: null }], readAt, stale: false, stoppedAt, word: null });

afterEach(() => {
  mocks.delete('wall2_ytlive_status');
  mocks.delete('wall2_ytlive_chat');
});

it('a chat read stamped in native seconds is fresh, not millions of minutes old', async () => {
  mocks.set('wall2_ytlive_chat', () => nativeChat(NOW_S - 4));
  const c = await ytlive.chat();
  expect(c.readAt).toBe(NOW_MS - 4000);
  expect(chatStale(c, NOW_MS)).toBe(false);
});

it('a 14 minute old read is stale and counts 14 minutes', async () => {
  mocks.set('wall2_ytlive_chat', () => nativeChat(NOW_S - 14 * 60));
  mocks.set('wall2_ytlive_status', () => nativeStatus(NOW_S - 14 * 60));
  const c = await ytlive.chat();
  const s = await ytlive.status();
  expect(chatStale(c, NOW_MS)).toBe(true);
  expect(statusStale(s, NOW_MS)).toBe(true);
  expect(Math.round((NOW_MS - (c.readAt ?? 0)) / 60_000)).toBe(14);
});

it('stoppedAt converts, null stays null, and the millisecond fields pass through', async () => {
  mocks.set('wall2_ytlive_chat', () => nativeChat(null, NOW_S - 60));
  mocks.set('wall2_ytlive_status', () => nativeStatus(null));
  const c = await ytlive.chat();
  const s = await ytlive.status();
  expect(c.readAt).toBeNull();
  expect(c.stoppedAt).toBe(NOW_MS - 60_000);
  expect(c.messages[0].at).toBe(NOW_MS - 5000);
  expect(s.readAt).toBeNull();
  expect(s.startedAt).toBe(NOW_MS - 600_000);
});
