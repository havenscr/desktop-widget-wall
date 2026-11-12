/** Design surface size in CSS pixels. The whole UI is laid out on this surface. */
export const STAGE_WIDTH = 2560;
export const STAGE_HEIGHT = 720;

/** Uniform scale that fits the stage inside the window. 1 at 2560 x 720. */
export function fitScale(windowWidth: number, windowHeight: number): number {
  if (windowWidth <= 0 || windowHeight <= 0) return 1;
  return Math.min(windowWidth / STAGE_WIDTH, windowHeight / STAGE_HEIGHT);
}
