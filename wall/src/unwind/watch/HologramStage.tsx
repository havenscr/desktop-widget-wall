import { HOLO_PANE } from './looks';

/**
 * The Hologram look (the owner's pick from the pictures): the whole 16:9 picture on a pane tilted
 * in 3D, blended over a dark glass plate with `mix-blend-mode: screen`, two cyan hairlines and four
 * corner ticks outside the picture, and a small emitter on the floor with its beam fan and floor
 * glow. Nothing lies on the picture and nothing is cropped. The look claims no front layer (it
 * stands in front of the land) and asks the moon to keep clear of its box. The blend needs the
 * stage and the sky in one layer group; where the app's layering cannot blend, the rules in
 * `unwind.css` drop the blend and keep the plate and the tilt.
 *
 * `HologramPlate` goes BEFORE the stage (same box and tilt, under the picture); `HologramEmitter`
 * goes after it (on the floor, in front of the land). Both take no pointer.
 */

/** The emitter's lens on the floor, in wall pixels. */
export const EMITTER = Object.freeze({ x: 1578, y: 572 });

/**
 * Where the beam's fan ends: the two ends of the pane's lower edge after the tilt (its left and
 * right corners, 6 px above the lower hairline), in wall pixels.
 */
const BEAM = Object.freeze({ left: [1219.4, 454.4] as const, right: [1951.1, 454.4] as const });

export function HologramPlate() {
  const p = HOLO_PANE;
  return (
    <div className="w-holo-plate" aria-hidden="true" style={{ left: p.x - 124, top: p.y - 20, width: p.w, height: p.h }}>
      <i className="w-holo-glass" />
      <i className="w-holo-hr t" />
      <i className="w-holo-hr b" />
      <i className="w-holo-tk tl" />
      <i className="w-holo-tk tr" />
      <i className="w-holo-tk bl" />
      <i className="w-holo-tk br" />
    </div>
  );
}

export function HologramEmitter() {
  const E = EMITTER;
  const [bl, br] = [BEAM.left, BEAM.right];
  let rays = '';
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    rays += `M${E.x} ${E.y - 6}L${(bl[0] + (br[0] - bl[0]) * t).toFixed(1)} ${(bl[1] + (br[1] - bl[1]) * t).toFixed(1)}`;
  }
  return (
    <svg className="w-holo-emit" viewBox="0 0 2560 720" width={2560} height={720} aria-hidden="true" focusable="false" style={{ pointerEvents: 'none' }}>
      <defs>
        <linearGradient id="whb" gradientUnits="userSpaceOnUse" x1="0" y1={E.y} x2="0" y2={bl[1]}>
          <stop offset="0" stopColor="#7ff6fa" stopOpacity=".5" />
          <stop offset=".5" stopColor="#35e6ea" stopOpacity=".13" />
          <stop offset="1" stopColor="#35e6ea" stopOpacity=".04" />
        </linearGradient>
        <radialGradient id="whg">
          <stop offset="0" stopColor="#35e6ea" stopOpacity=".34" />
          <stop offset="1" stopColor="#35e6ea" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="whp" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3a2f66" />
          <stop offset="1" stopColor="#140e2a" />
        </linearGradient>
        <filter id="whbl" x="-10%" y="-10%" width="120%" height="120%">
          <feGaussianBlur stdDeviation="5" />
        </filter>
      </defs>
      <ellipse cx={E.x} cy={E.y + 4} rx="430" ry="46" fill="url(#whg)" opacity=".5" />
      <path d={`M${E.x - 16} ${E.y - 4}L${bl[0]} ${bl[1]}L${br[0]} ${br[1]}L${E.x + 16} ${E.y - 4}z`} fill="url(#whb)" filter="url(#whbl)" className="w-holo-beam" />
      <path d={rays} stroke="#9af9fc" strokeOpacity=".1" strokeWidth="1.2" fill="none" />
      <ellipse cx={E.x} cy={E.y + 10} rx="58" ry="9" fill="#03020b" opacity=".6" />
      <path d={`M${E.x - 44} ${E.y}a44 10 0 0 0 88 0v7a44 10 0 0 1 -88 0z`} fill="url(#whp)" />
      <ellipse cx={E.x} cy={E.y} rx="44" ry="10" fill="#241a46" stroke="rgba(190,172,255,.55)" strokeWidth="1" />
      <ellipse cx={E.x} cy={E.y - 1} rx="26" ry="5.5" fill="#35e6ea" opacity=".55" filter="url(#whbl)" />
      <ellipse cx={E.x} cy={E.y - 1} rx="20" ry="4" fill="#d6feff" />
    </svg>
  );
}
