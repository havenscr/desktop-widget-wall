import { IconBrandTwitch, IconBroadcast, IconPlayerPlayFilled, IconPlaylist } from '@tabler/icons-react';
import type { WatchKind } from './links';

/** The kind's glyph for a pin and the pin menu: play for a video, broadcast for a live stream, playlist for a playlist, the Twitch mark for Twitch. */
export function PinGlyph({ kind, size = 18 }: { kind: WatchKind; size?: number }) {
  switch (kind) {
    case 'twitch':
      return <IconBrandTwitch size={size} aria-hidden="true" />;
    case 'live':
      return <IconBroadcast size={size} aria-hidden="true" />;
    case 'playlist':
      return <IconPlaylist size={size} aria-hidden="true" />;
    default:
      return <IconPlayerPlayFilled size={size} aria-hidden="true" />;
  }
}
