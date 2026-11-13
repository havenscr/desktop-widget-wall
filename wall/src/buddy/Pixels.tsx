import { useMemo } from 'react';
import { propColor, propOrigin, PROP_SPRITES, SPRITES, SPRITE_PX, pixelColor, type Pose, type Prop } from './sprites';

type ColorOf = (map: readonly string[], x: number, y: number) => string | null;

function rectsOf(map: readonly string[], color: ColorOf) {
  const out: { x: number; y: number; c: string }[] = [];
  map.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const c = color(map, x, y);
      if (c) out.push({ x, y, c });
    }
  });
  return out;
}

/** Any pixel map as crisp rects, `px` design pixels a pixel. */
export function PixelSvg({ map, px, color = propColor, className }: { map: readonly string[]; px: number; color?: ColorOf; className?: string }) {
  const rects = useMemo(() => rectsOf(map, color), [map, color]);
  return (
    <svg className={className} width={map[0].length * px} height={map.length * px} shapeRendering="crispEdges">
      {rects.map((r) => (
        <rect key={`${r.x}-${r.y}`} x={r.x * px} y={r.y * px} width={px} height={px} fill={r.c} />
      ))}
    </svg>
  );
}

export function SheepSvg({ pose, px = SPRITE_PX }: { pose: Pose; px?: number }) {
  return <PixelSvg map={SPRITES[pose]} px={px} color={pixelColor} />;
}

/** A prop over the sheep, placed from the pose's ear (or the sprite's corner) in sprite pixels. */
export function PropSvg({ prop, pose, px }: { prop: Prop; pose: Pose; px: number }) {
  const [ox, oy] = propOrigin(prop, pose);
  return (
    <span className={`watt-prop watt-prop-${prop}`} style={{ left: ox * px, top: oy * px }}>
      <PixelSvg map={PROP_SPRITES[prop].map} px={px} />
    </span>
  );
}
