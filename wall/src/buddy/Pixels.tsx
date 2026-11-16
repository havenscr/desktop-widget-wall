import { useMemo } from 'react';
import { BLINKS, ROW_DX, earShift, propColor, propOrigin, PROP_SPRITES, SPRITES, SPRITE_PX, pixelColor, pixelColorWet, type Pose, type Prop, type RowShift, type Wool } from './sprites';

type ColorOf = (map: readonly string[], x: number, y: number) => string | null;

interface Rect {
  x: number;
  y: number;
  c: string;
}

function rectsOf(map: readonly string[], color: ColorOf, dx: readonly number[] = []): Rect[] {
  const out: Rect[] = [];
  map.forEach((row, y) => {
    const d = dx[y] ?? 0;
    for (let x = 0; x < row.length; x++) {
      const c = color(map, x, y);
      if (c) out.push({ x: x + d, y, c });
    }
  });
  return out;
}

/** The sheep's pixels for a map, a wool and a row shift, built once for each (never in a frame). */
const sheepCache = new WeakMap<readonly string[], Map<number, Rect[]>>();
export function sheepRects(map: readonly string[], wool: Wool, rows: RowShift): Rect[] {
  let byLook = sheepCache.get(map);
  if (!byLook) sheepCache.set(map, (byLook = new Map()));
  const key = (wool === 'wet' ? 1 : 0) * 8 + rows;
  let rects = byLook.get(key);
  if (!rects) byLook.set(key, (rects = rectsOf(map, wool === 'wet' ? pixelColorWet : pixelColor, ROW_DX[rows])));
  return rects;
}

function Rects({ rects, px, className, width, height }: { rects: readonly Rect[]; px: number; className?: string; width: number; height: number }) {
  return (
    <svg className={className} width={width} height={height} shapeRendering="crispEdges" overflow="visible">
      {rects.map((r) => (
        <rect key={`${r.x}-${r.y}`} x={r.x * px} y={r.y * px} width={px} height={px} fill={r.c} />
      ))}
    </svg>
  );
}

/** Any pixel map as crisp rects, `px` design pixels a pixel. */
export function PixelSvg({ map, px, color = propColor, className }: { map: readonly string[]; px: number; color?: ColorOf; className?: string }) {
  const rects = useMemo(() => rectsOf(map, color), [map, color]);
  return <Rects rects={rects} px={px} className={className} width={map[0].length * px} height={map.length * px} />;
}

/**
 * The sheep in a pose; `blink` shuts his eyes for the frame. `wool` is dry, damp (rain) or fluffy;
 * `rows` moves rows sideways (a shake frame, the wind's lean).
 */
export function SheepSvg({ pose, px = SPRITE_PX, blink = false, wool = 'dry', rows = 0 }: { pose: Pose; px?: number; blink?: boolean; wool?: Wool; rows?: RowShift }) {
  const map = blink ? BLINKS[pose] : SPRITES[pose];
  return <Rects rects={sheepRects(map, wool, rows)} px={px} width={map[0].length * px} height={map.length * px} />;
}

/** A prop over the sheep, placed from the pose's ear (or the sprite's corner) in sprite pixels. `worn` is the day prop on him; `rows` moves a prop on the head with the ear's row. */
export function PropSvg({ prop, pose, px, worn = null, rows = 0 }: { prop: Prop; pose: Pose; px: number; worn?: Prop | null; rows?: RowShift }) {
  const [ox, oy] = propOrigin(prop, pose, worn);
  return (
    <span className={`watt-prop watt-prop-${prop}`} style={{ left: (ox + earShift(prop, pose, rows)) * px, top: oy * px }}>
      <PixelSvg map={PROP_SPRITES[prop].map} px={px} />
    </span>
  );
}
