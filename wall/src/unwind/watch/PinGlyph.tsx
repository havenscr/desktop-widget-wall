import { IconBrandSpotify, IconBrandTwitch, IconBrandYoutube, IconBroadcast, IconPlayerPlayFilled, IconPlaylist } from '@tabler/icons-react';
import type { WatchKind } from './links';
import type { PinKind } from './pins';

/** The kind's glyph for a pin and the pin menu: play for a video, broadcast for a live stream, playlist for a playlist, the Twitch mark for Twitch, the Spotify mark for a Spotify kind. */
export function PinGlyph({ kind, size = 18 }: { kind: WatchKind | PinKind; size?: number }) {
  switch (kind) {
    case 'spotify-playlist':
    case 'spotify-album':
      return <IconBrandSpotify size={size} aria-hidden="true" />;
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

/** The small round service mark on a pin's cover: Spotify for a Spotify kind, YouTube for any other kind that shows a cover. */
export function ServiceBadge({ kind }: { kind: WatchKind | PinKind }) {
  const spotify = kind === 'spotify-playlist' || kind === 'spotify-album';
  return (
    <b className="u-pin-badge" data-service={spotify ? 'spotify' : 'youtube'} aria-hidden="true">
      {spotify ? <IconBrandSpotify size={14} stroke={2} aria-hidden="true" /> : <IconBrandYoutube size={14} stroke={2} aria-hidden="true" />}
    </b>
  );
}
