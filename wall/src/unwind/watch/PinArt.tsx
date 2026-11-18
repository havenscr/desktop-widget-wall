import { useState } from 'react';
import { PinGlyph, ServiceBadge } from './PinGlyph';
import { artFailed, markArtFailed, pinArt } from './pinArt';
import { artBackground, type PinShown } from './pins';

/**
 * A pin's art square: the real cover over today's gradient (a slow load shows the gradient) with a small service badge while the cover
 * shows. With no cover (Twitch, a Watch list playlist, no address, a load that failed this session) it is the gradient and the kind's glyph, no badge.
 */
export function PinArtSquare({ shown, badge = true, size = 18 }: { shown: Pick<PinShown, 'key' | 'kind' | 'art'>; badge?: boolean; size?: number }) {
  const [, rerender] = useState(0);
  const address = shown.kind === 'twitch' ? null : shown.art;
  const cover = address && !artFailed(address) ? address : null;
  return (
    <i className="u-pin-art" style={{ background: artBackground(shown.key) }}>
      {cover ? (
        <img
          src={pinArt.src(cover)}
          alt=""
          decoding="async"
          loading="eager"
          referrerPolicy="no-referrer"
          draggable={false}
          onError={() => {
            markArtFailed(cover);
            rerender((n) => n + 1);
          }}
        />
      ) : (
        <PinGlyph kind={shown.kind} size={size} />
      )}
      {cover && badge ? <ServiceBadge kind={shown.kind} /> : null}
    </i>
  );
}
