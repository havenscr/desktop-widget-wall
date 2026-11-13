/**
 * Band level (0 to 1) that reads as nothing on the echo: about -52 dB. Below it a band adds
 * no height, so a quiet passage leaves the lines close to the range rather than lifting the
 * whole ridge. Tune on the strip with real music.
 */
export const BAND_FLOOR = 0.3;
/** The top of the made-up `spec()` the echo was drawn to, so real bands lift the lines as high. */
export const SPECTRUM_SCALE = 1.3;
