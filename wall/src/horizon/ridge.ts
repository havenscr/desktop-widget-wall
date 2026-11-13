import pano from './terrain/pano.json';
import type { CameraPreset } from './cameras';

interface Profiles {
  az0: number;
  step: number;
  far: number[];
  mid: number[];
  near: number[];
}
const T = pano as unknown as Profiles;

/** One ridge profile at an azimuth, in degrees of elevation: the renderer's `prof`, read only. */
function prof(arr: readonly number[], az: number): number {
  const f = (az - T.az0) / T.step;
  const i = Math.floor(f);
  if (i < 0 || i >= arr.length - 1) return 0;
  const t = f - i;
  return (arr[i] * (1 - t) + arr[i + 1] * t) / 100;
}

/**
 * The highest point of the drawn mountains (far, mid and near ridges) between stage x `x0`
 * and `x1` for a camera, as a stage y in design pixels (smaller is higher). The same
 * projection the renderer uses: a column at x looks at azimuth `az0 + x / ppd`, and a ridge
 * of `e` degrees stands `e * ppd * vex` above the horizon line `hy`.
 */
export function ridgeTopY(cam: Pick<CameraPreset, 'az0' | 'ppd' | 'hy' | 'vex'>, x0: number, x1: number): number {
  const k = cam.ppd * cam.vex;
  let top = 0;
  for (let x = Math.floor(x0); x <= Math.ceil(x1); x += 1) {
    const az = cam.az0 + x / cam.ppd;
    top = Math.max(top, prof(T.far, az), prof(T.mid, az), prof(T.near, az));
  }
  return cam.hy - top * k;
}
