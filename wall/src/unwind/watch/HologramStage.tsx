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
 * `HologramPlate` and `HologramEmitter` both go BEFORE the stage (the plate in the pane's box and
 * tilt, the emitter on the floor in front of the land), so the picture is painted above both. The
 * beam is also cut off just under the pane's lower edge (`beamClip`), so nothing of it or of its
 * blur can lie on the picture even through the blend. Both take no pointer.
 */

/** The emitter's lens on the floor, in wall pixels. */
export const EMITTER = Object.freeze({ x: 1578, y: 572 });

/** The pane's tilt, the numbers of `.w-holo` and `.w-holo-plate` in `unwind.css` (the origin is 50% 60% of the box). */
export const HOLO_TILT = Object.freeze({ perspective: 2400, rotateY: -7, rotateX: 1.2 });

/** Where a point of the flat pane (wall pixels, at the pane's depth) lands after the tilt. */
function tilted(x: number, y: number): [number, number] {
  const p = HOLO_PANE;
  const ox = p.x + p.w * 0.5;
  const oy = p.y + p.h * 0.6;
  const a = (HOLO_TILT.rotateY * Math.PI) / 180;
  const b = (HOLO_TILT.rotateX * Math.PI) / 180;
  const dy = y - oy;
  const dx = x - ox;
  // rotateX then rotateY then the perspective, as CSS composes `perspective() rotateY() rotateX()`.
  const z1 = dy * Math.sin(b);
  const x2 = dx * Math.cos(a) + z1 * Math.sin(a);
  const y2 = dy * Math.cos(b);
  const z2 = -dx * Math.sin(a) + z1 * Math.cos(a);
  const w = 1 - z2 / HOLO_TILT.perspective;
  return [ox + x2 / w, oy + y2 / w];
}

/** The tilted pane's four corners in wall pixels: top left, top right, bottom right, bottom left. */
export function paneQuad(): [number, number][] {
  const p = HOLO_PANE;
  return [tilted(p.x, p.y), tilted(p.x + p.w, p.y), tilted(p.x + p.w, p.y + p.h), tilted(p.x, p.y + p.h)];
}

/** How far under the pane's lower edge the beam is cut off (the beam, its blur and its rays never reach the picture). */
export const BEAM_CLEAR = 2;

/**
 * The area the beam may paint: everything under the pane's lower edge (a straight line after the
 * tilt, as every line stays one) and `BEAM_CLEAR` px below it. The beam's blur and rays are cut to
 * it, so none of them reaches the picture however the filter spreads.
 */
export function beamClip(): [number, number][] {
  const q = paneQuad();
  const [bl, br] = [q[3]!, q[2]!];
  const slope = (br[1] - bl[1]) / (br[0] - bl[0]);
  const at = (x: number) => bl[1] + slope * (x - bl[0]) + BEAM_CLEAR;
  return [
    [0, at(0)],
    [2560, at(2560)],
    [2560, 900],
    [0, 900],
  ];
}

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
  // The fan runs from the lens to the pane's lower corners; the clip below cuts it off just under the pane.
  const q = paneQuad();
  const [bl, br] = [q[3]!, q[2]!];
  const clip = beamClip().map((pt) => pt.map((n) => n.toFixed(2)).join(',')).join(' ');
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
        <clipPath id="whc" clipPathUnits="userSpaceOnUse">
          <polygon points={clip} />
        </clipPath>
      </defs>
      <ellipse cx={E.x} cy={E.y + 4} rx="430" ry="46" fill="url(#whg)" opacity=".5" />
      <path d={`M${E.x - 16} ${E.y - 4}L${bl[0]} ${bl[1]}L${br[0]} ${br[1]}L${E.x + 16} ${E.y - 4}z`} fill="url(#whb)" filter="url(#whbl)" clipPath="url(#whc)" className="w-holo-beam" />
      <path d={rays} stroke="#9af9fc" strokeOpacity=".1" strokeWidth="1.2" fill="none" clipPath="url(#whc)" />
      <ellipse cx={E.x} cy={E.y + 10} rx="58" ry="9" fill="#03020b" opacity=".6" />
      <path d={`M${E.x - 44} ${E.y}a44 10 0 0 0 88 0v7a44 10 0 0 1 -88 0z`} fill="url(#whp)" />
      <ellipse cx={E.x} cy={E.y} rx="44" ry="10" fill="#241a46" stroke="rgba(190,172,255,.55)" strokeWidth="1" />
      <ellipse cx={E.x} cy={E.y - 1} rx="26" ry="5.5" fill="#35e6ea" opacity=".55" filter="url(#whbl)" />
      <ellipse cx={E.x} cy={E.y - 1} rx="20" ry="4" fill="#d6feff" />
    </svg>
  );
}
