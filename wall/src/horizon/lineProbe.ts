import type { SkyBox } from './sky';
import { drawLineType, type LineTypeFrame, type LineTypesState } from './lineTypes';

/**
 * Dev builds only, for the fit check: `?lineprobe=1` draws the new type again on a scratch canvas
 * every frame (headless virtual time draws few) and, for the picture's box, publishes on the main
 * canvas as `data-line-probe` the numbers the two line rules read:
 *
 *   `drawn,most,boxes,onTop,under,cols,above,nopic`
 *
 * - `drawn`: sampled pixels of the type in the frame, `most` the most so far, `boxes` the claimed boxes.
 * - `onTop` and `under`: of the type's pixels inside the picture's box (sampled, counted
 *   over every frame), how many have the canvas the type was drawn on ABOVE the picture and how
 *   many BELOW it in the page's stacking (read from `elementsFromPoint` with every element made
 *   hit-testable for that one call). A picture in front of the land must have none on top; a
 *   picture behind the land must have none under.
 * - `cols`: of `COLUMNS` equal columns across the box's width, how many held a pixel of the type in
 *   some frame (the type plays the full width).
 * - `above`: pixels drawn higher than the Height setting allows (`RISE_MARGIN` more than it).
 * - `nopic`: sampled points where no picture element lies under the point (the box is the picture's
 *   bounding box: a tilted pane leaves corners). Such a point is neither above nor below the picture.
 *
 * `&lover=1` lifts the drawn canvas above the page (the break for a picture in front);
 * `&ltarget=main` draws the type on the main canvas even when a front canvas stands (the break for
 * a picture behind the land).
 */
export interface LineProbe {
  /** The canvas to draw the type on in place of the front one (the break), or the usual choice. */
  mainOnly: boolean;
  /** The drawn canvas is lifted above the page (the break). */
  lift: boolean;
  run: (s: LineTypesState, f: LineTypeFrame, boxes: readonly SkyBox[], main: HTMLCanvasElement, target: HTMLCanvasElement) => void;
}

/** Columns across the picture's width the coverage is counted in. */
export const COLUMNS = 32;
/** Design pixels above the Height setting a bar's cap, a glow, a spark or its halo may reach. */
export const RISE_MARGIN = 48;
/** The most pixels of the type, in the box, whose stacking is read in one frame. */
const SAMPLES = 60;
/** Frames with the type in the box whose stacking is read: the page's layers do not change, and each read is costly. */
const STACK_FRAMES = 3;

export function parseLineProbe(search: string): LineProbe | null {
  const q = new URLSearchParams(search);
  if (!q.has('lineprobe')) return null;
  let onTop = 0;
  let under = 0;
  let above = 0;
  let nopic = 0;
  let read = 0;
  let most = 0;
  let scratch: HTMLCanvasElement | null = null;
  let hit: HTMLStyleElement | null = null;
  const seen = new Uint8Array(COLUMNS);
  return {
    mainOnly: q.get('ltarget') === 'main',
    lift: q.get('lover') === '1',
    run: (s, f, boxes, main, target) => {
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
      // Nothing higher than the Height setting allows.
      const top = Math.max(0, Math.floor((f.hy - f.height - RISE_MARGIN) * f.scale));
      for (let i = 3; i < top * scratch.width * 4; i += 4) if (all[i] > 8) above++;
      const b = boxes[0];
      if (b) {
        const x0 = Math.max(0, Math.floor(b[0] * f.scale));
        const y0 = Math.max(0, Math.floor(b[1] * f.scale));
        const w = Math.min(scratch.width - x0, Math.ceil(b[2] * f.scale));
        const h = Math.min(scratch.height - y0, Math.ceil(b[3] * f.scale));
        if (w > 0 && h > 0) {
          const d = x.getImageData(x0, y0, w, h).data;
          for (let row = 0; row < h; row++) {
            for (let col = 0; col < w; col += 2) if (d[(row * w + col) * 4 + 3] > 8) seen[Math.min(COLUMNS - 1, Math.floor((col * COLUMNS) / w))] = 1;
          }
          // Stacking: every element hit-testable for this one call, so the order is the paint order.
          if (read >= STACK_FRAMES) {
            publish();
            return;
          }
          hit ??= document.createElement('style');
          hit.textContent = '*{pointer-events:auto !important}';
          document.head.appendChild(hit);
          const r = main.getBoundingClientRect();
          const k = r.width / (main.width / f.scale);
          // At most SAMPLES of the type's pixels in the box, evenly through them in scan order.
          let q = 0;
          for (let row = 0; row < h; row++) for (let col = 0; col < w; col += 2) if (d[(row * w + col) * 4 + 3] > 8) q++;
          if (q > 0) read++;
          const every = Math.max(1, Math.ceil(q / SAMPLES));
          let n = 0;
          for (let row = 0; row < h; row++) {
            for (let col = 0; col < w; col += 2) {
              if (d[(row * w + col) * 4 + 3] <= 8 || n++ % every !== 0) continue;
              const cx = r.left + ((x0 + col) / f.scale) * k;
              const cy = r.top + ((y0 + row) / f.scale) * k;
              if (cx < 0 || cy < 0 || cx >= window.innerWidth || cy >= window.innerHeight) continue;
              const list = document.elementsFromPoint(cx, cy);
              const own = list.indexOf(target);
              const pic = list.findIndex((e) => e.closest('.w-screen') !== null);
              if (own < 0) continue;
              if (pic < 0) nopic++;
              else if (own < pic) onTop++;
              else under++;
            }
          }
          hit.remove();
        }
      }
      publish();
      function publish() {
        let cols = 0;
        for (let i = 0; i < COLUMNS; i++) cols += seen[i];
        main.dataset.lineProbe = `${drawn},${most},${boxes.length},${onTop},${under},${cols},${above},${nopic}`;
      }
    },
  };
}
