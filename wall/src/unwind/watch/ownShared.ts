/**
 * Small pieces the Watch card, the Watch panel and the owner's own playlists all use. A leaf: it imports nothing from them,
 * so none of those files has to import another to reach them.
 */

/** How long a refusal line stays under a field. */
export const PASTE_ERROR_MS = 6000;

/** "1:05" or "1:02:03". */
export function clock(sec: number): string {
  const t = Math.max(0, Math.floor(sec));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const ss = String(t % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** "12 videos", "1 video", "No videos". */
export function countText(n: number): string {
  return n === 0 ? 'No videos' : n === 1 ? '1 video' : `${n} videos`;
}
