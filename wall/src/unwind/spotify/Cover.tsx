import { useState } from 'react';
import { IconMusic } from '@tabler/icons-react';

/**
 * A real cover (Spotify's image URL) or, when there is none or it fails to load, a neutral
 * tile with a music note. Never a colour gradient standing in for art.
 */
export function Cover({ src, size, className = '' }: { src: string | null; size: number; className?: string }) {
  const [failed, setFailed] = useState<string | null>(null);
  const show = src && failed !== src;
  return (
    <span className={`sp-cover ${className}`} style={{ width: size, height: size }}>
      {show ? <img src={src} alt="" loading="lazy" onError={() => setFailed(src)} /> : <IconMusic size={Math.round(size * 0.45)} stroke={1.5} aria-hidden="true" />}
    </span>
  );
}
