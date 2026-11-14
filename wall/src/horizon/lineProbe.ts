import type { SkyBox } from './sky';
import { drawLineType, type LineTypeFrame, type LineTypesState } from './lineTypes';

/**
 * Dev builds only, for the fit check: `?lineprobe=1` draws the new type again on a scratch canvas
 * every 10th frame and counts its pixels inside each claimed picture box, published on the main
 * canvas as `data-line-probe` ("pixels inside the boxes, pixels drawn at most, boxes"). `&lclip=0`
 * leaves the boxes out of the clip (the fit check's deliberate break).
 */
export interface LineProbe {
  noClip: boolean;
  run: (s: LineTypesState, f: LineTypeFrame, boxes: readonly SkyBox[], main: HTMLCanvasElement) => void;
}

export function parseLineProbe(search: string): LineProbe | null {
  const q = new URLSearchParams(search);
  if (!q.has('lineprobe')) return null;
  let frame = 0;
  let inside = 0;
  let most = 0;
  let scratch: HTMLCanvasElement | null = null;
  return {
    noClip: q.get('lclip') === '0',
    run: (s, f, boxes, main) => {
      if (frame++ % 10 !== 0) return;
      scratch ??= document.createElement('canvas');
      scratch.width = main.width;
      scratch.height = main.height;
      const x = scratch.getContext('2d', { willReadFrequently: true });
      if (!x) return;
      drawLineType(x, s, f);
      let drawn = 0;
      const all = x.getImageData(0, 0, scratch.width, scratch.height).data;
      for (let i = 3; i < all.length; i += 16) if (all[i] > 8) drawn++;
      most = Math.max(most, drawn);
      for (const b of boxes) {
        const x0 = Math.max(0, Math.floor(b[0] * f.scale));
        const y0 = Math.max(0, Math.floor(b[1] * f.scale));
        const w = Math.min(scratch.width - x0, Math.ceil(b[2] * f.scale));
        const h = Math.min(scratch.height - y0, Math.ceil(b[3] * f.scale));
        if (w <= 0 || h <= 0) continue;
        const d = x.getImageData(x0, y0, w, h).data;
        for (let i = 3; i < d.length; i += 4) if (d[i] > 8) inside++;
      }
      main.dataset.lineProbe = `${inside},${most},${boxes.length}`;
    },
  };
}
