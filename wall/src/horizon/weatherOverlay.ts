/** The one overlay canvas for the weather's mid layer, registered by `WeatherOverlay` (HorizonCanvas.tsx), read by the frame. */
let overlay: HTMLCanvasElement | null = null;

export function setWeatherOverlay(c: HTMLCanvasElement | null): void {
  overlay = c;
}

export function weatherOverlay(): HTMLCanvasElement | null {
  return overlay;
}
