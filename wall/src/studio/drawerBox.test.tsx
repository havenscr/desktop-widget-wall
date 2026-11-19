import { cleanup, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { mocks } from '../bridge/tauri';
import { DRAWER_FALLBACK, DRAWER_MIN_WIDTH, drawerBox } from './drawerBox';
import { StudioDrawer } from './StudioDrawer';
import { useKeyLights } from './store';

const rect = (left: number, width: number): DOMRect => ({ left, right: left + width, top: 0, bottom: 300, width, height: 300, x: left, y: 0, toJSON: () => ({}) }) as DOMRect;

/** A stage of 2560 canvas pixels drawn at `scale`, holding a column of `width` canvas pixels at `left`. */
function page(left: number, width: number, scale = 1, inColumn = true) {
  document.body.innerHTML = `<div class="stage"><div class="oa2-b"></div><div class="rail"></div></div>`;
  const stage = document.querySelector('.stage') as HTMLElement;
  const col = document.querySelector('.oa2-b') as HTMLElement;
  const holder = inColumn ? col : (document.querySelector('.rail') as HTMLElement);
  const opener = document.createElement('button');
  opener.setAttribute('data-st-opener', '');
  holder.append(opener);
  stage.getBoundingClientRect = () => rect(0, 2560 * scale);
  col.getBoundingClientRect = () => rect(left * scale, width * scale);
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
  useKeyLights.getState().setDrawer(false);
  mocks.clear();
  vi.useRealTimers();
});

it('the sheet takes the opener column box in canvas pixels, also when the canvas is scaled', () => {
  page(1919, 621);
  expect(drawerBox()).toEqual({ left: 1919, width: 621 });
  page(1919, 621, 0.5);
  expect(drawerBox()).toEqual({ left: 1919, width: 621 });
});

it('never narrower than 560: a narrower column grows the sheet to the left only', () => {
  page(2100, 440);
  expect(drawerBox()).toEqual({ left: 2540 - DRAWER_MIN_WIDTH, width: DRAWER_MIN_WIDTH });
});

it('an opener in no column keeps the old place, and so does a column with no box', () => {
  page(1919, 621, 1, false);
  expect(drawerBox()).toEqual(DRAWER_FALLBACK);
  document.body.innerHTML = '';
  expect(drawerBox()).toEqual(DRAWER_FALLBACK);
});

it('the open sheet is placed by the column box', () => {
  page(1919, 621);
  mocks.set('wall2_keylights_get', () => ({}));
  const view = render(<StudioDrawer />, { container: document.body.appendChild(document.createElement('div')) });
  const sheet = document.querySelector('.st-drawer') as HTMLElement;
  expect(sheet.style.left).toBe('1919px');
  expect(sheet.style.width).toBe('621px');
  view.unmount();
});
