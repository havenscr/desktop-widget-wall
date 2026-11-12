import { STAGE_HEIGHT, STAGE_WIDTH } from '../stage/fitScale';
import { CAMERAS, type CameraPreset } from './cameras';
import { draw, type HorizonEcho, type HorizonGrid } from './renderer';

export { sun, when } from './renderer';
export type { HorizonDrawOptions, HorizonEcho, HorizonGrid } from './renderer';
export { CAMERAS, GLIDE_SECONDS, HOME_MORNING, SWING_SECONDS, MOON, blendCamera, homeCameraFor, type CameraPreset } from './cameras';

export interface HorizonOptions {
  /** Backing store width in canvas pixels. The renderer covers the whole stage, so this is informational. */
  width: number;
  /** Backing store height in canvas pixels. */
  height: number;
  /** Overrides the camera's horizon line (design pixels) when set. */
  horizonY?: number;
  /** Design pixels to canvas pixels: stage scale times devicePixelRatio. */
  scale: number;
  /** Camera framing (default: the Work camera). */
  camera?: CameraPreset;
  /** Wall clock in epoch milliseconds; sets the sun and the palette (default: now). */
  ms?: number;
  /** Seconds of animation time (default 0). */
  t?: number;
  /** Lake grid scroll phase, 0 to 1 (default 0). */
  phase?: number;
  /** Sideways cloud offset in design pixels (default 0); see `cloudShiftFor`. */
  cloudShift?: number;
  /** Music ripple (default off). */
  echo?: HorizonEcho | null;
  /** Grid pulse on the beat (default off). */
  grid?: HorizonGrid | null;
  /** Moon centre x, centre y and radius in design pixels (default none). */
  moon?: readonly [number, number, number] | null;
}

export const HORIZON_Y = CAMERAS.work.hy;

/** Draw the panorama for the given camera and time. The music ripple, the grid pulse and the moon are off unless passed. */
export function drawHorizon(ctx: CanvasRenderingContext2D, options: HorizonOptions): void {
  const cam = options.camera ?? CAMERAS.work;
  draw(ctx, {
    W: STAGE_WIDTH,
    H: STAGE_HEIGHT,
    scale: options.scale,
    hy: options.horizonY ?? cam.hy,
    az0: cam.az0,
    ppd: cam.ppd,
    vex: cam.vex,
    snowDeg: cam.snowDeg,
    cityScale: cam.cs,
    ter: cam.ter,
    vx: cam.vx,
    ms: options.ms ?? Date.now(),
    t: options.t ?? 0,
    phase: options.phase ?? 0,
    cloudShift: options.cloudShift ?? 0,
    echo: options.echo ?? null,
    grid: options.grid ?? null,
    moon: options.moon ? [options.moon[0], options.moon[1], options.moon[2]] : null,
  });
}
