export interface NowPlayingInfo {
  title?: string | null;
  artist?: string | null;
  album?: string | null;
  album_art_base64?: string | null;
  album_art_mime?: string | null;
  playback_status?: string | null;
  source_app?: string | null;
  position_seconds?: number | null;
  duration_seconds?: number | null;
  art_unchanged?: boolean;
}

export const ALLOWED_ART_MIMES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const;

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** A data: URL only for an allowed image mime and plain base64; otherwise null. */
export function artDataUrl(base64?: string | null, mime?: string | null): string | null {
  if (!base64 || !mime) return null;
  const m = mime.trim().toLowerCase();
  if (!(ALLOWED_ART_MIMES as readonly string[]).includes(m)) return null;
  if (!BASE64.test(base64)) return null;
  return `data:${m};base64,${base64}`;
}

/** Art for this poll: keep the previous art when the backend says it is unchanged. */
export function nextArt(info: NowPlayingInfo, previous: string | null): string | null {
  if (info.art_unchanged) return previous;
  return artDataUrl(info.album_art_base64, info.album_art_mime);
}

/** Quiet state: nothing to show or control. */
export function isQuiet(info: NowPlayingInfo | null): boolean {
  if (!info) return true;
  const s = info.playback_status;
  if (s === 'stopped' || s === 'unknown' || !s) return true;
  return !info.title && !info.artist;
}

export function isPlaying(info: NowPlayingInfo | null): boolean {
  return info?.playback_status === 'playing';
}
