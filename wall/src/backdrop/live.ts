/**
 * The one module level record the animated sky reads each frame, written by the horizon's own loop. Plain numbers, no React state,
 * so the two loops (the ridge's and the sky's) read the same values and nothing is allocated.
 */
export const live = {
  /** The horizon line (stage pixels from the top) of the camera being drawn, gliding with it on a page switch. */
  hy: 505,
};

/** The sky canvas runs from the top of the stage down to the lowest horizon line in use. */
export const SKY_HEIGHT = 582;
