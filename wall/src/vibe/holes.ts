/**
 * A hole mask for the front layer: the rectangles (flat x, y, w, h in canvas pixels) filled and blurred once, so
 * a `destination-out` draw of it clears the effect over them with a soft falloff instead of an edge. Baked
 * when the layout changes, never per frame (the one place a blur filter is used).
 */
export function bakeHole(w: number, h: number, rects: number[], blurPx: number): HTMLCanvasElement {
  const out = document.createElement('canvas');
  out.width = Math.max(1, w);
  out.height = Math.max(1, h);
  const x = out.getContext('2d');
  if (!x || rects.length === 0) return out;
  const raw = document.createElement('canvas');
  raw.width = out.width;
  raw.height = out.height;
  const r = raw.getContext('2d');
  if (!r) return out;
  r.fillStyle = '#000';
  for (let i = 0; i + 3 < rects.length; i += 4) r.fillRect(rects[i], rects[i + 1], rects[i + 2], rects[i + 3]);
  x.filter = `blur(${blurPx}px)`;
  x.drawImage(raw, 0, 0);
  x.filter = 'none';
  return out;
}
