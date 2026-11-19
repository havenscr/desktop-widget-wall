import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mocks } from '../bridge/tauri';
import { HoverTipLayer, resetTip, TIP_DELAY_MS } from '../ui/HoverTip';
import { previewTip, ZonesPreviewCard, type ZonesPreviewData } from './ZonesPreview';

const flush = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

const DATA: ZonesPreviewData = {
  zones: [
    { n: 1, x: 0, y: 0, w: 0.31, h: 1 },
    { n: 2, x: 0.31, y: 0, w: 0.49, h: 1 },
    { n: 3, x: 0.8, y: 0, w: 0.2, h: 0.5 },
    { n: 4, x: 0.8, y: 0.5, w: 0.2, h: 0.5 },
  ],
  moves: [
    { zone: 1, app: 'Code', why: 'rule' },
    { zone: 2, app: 'Edge', why: 'recent' },
    { zone: 3, app: 'Teams', why: 'recent' },
    { zone: 4, app: 'Outlook', why: 'recent' },
  ],
  stay: 3,
};

let calls: string[];
beforeEach(() => {
  vi.useFakeTimers();
  resetTip();
  calls = [];
  mocks.set('wall2_arrange_preview', () => (calls.push('preview'), DATA));
});
afterEach(() => {
  resetTip();
  vi.useRealTimers();
  mocks.clear();
});

it('draws every zone with its program and why, and how many windows stay', async () => {
  render(<ZonesPreviewCard />);
  expect(screen.getByText('Looking at your windows')).toBeTruthy();
  await flush();
  expect(screen.getByText('4 windows').textContent).toBe('4 windows');
  const zones = [...document.querySelectorAll<HTMLElement>('.zp-zone')];
  expect(zones.map((z) => z.dataset.zone)).toEqual(['1', '2', '3', '4']);
  expect(zones[0].textContent).toContain('Code');
  expect(zones[0].textContent).toContain('your rule');
  expect(zones[0].className).toContain('rule');
  expect(zones[1].textContent).toContain('used last');
  // The map's boxes are the fractions of its own size.
  expect(zones[2].style.left).toBe('416px');
  expect(zones[2].style.height).toBe('73px');
  expect(document.querySelector('.zp-f')!.textContent).toBe('3 other windows stay where they are. Click to move them.');
});

it('says one window stays in the singular, and names nothing when none stay', async () => {
  mocks.set('wall2_arrange_preview', () => ({ ...DATA, stay: 1 }));
  const r = render(<ZonesPreviewCard />);
  await flush();
  expect(document.querySelector('.zp-f')!.textContent).toBe('1 other window stays where it is. Click to move them.');
  r.unmount();
  mocks.set('wall2_arrange_preview', () => ({ ...DATA, stay: 0 }));
  render(<ZonesPreviewCard />);
  await flush();
  expect(document.querySelector('.zp-f')!.textContent).toBe('Click to move them.');
});

it('shows an empty zone as dashed with no program', async () => {
  mocks.set('wall2_arrange_preview', () => ({ ...DATA, moves: DATA.moves.slice(0, 2), stay: 0 }));
  render(<ZonesPreviewCard />);
  await flush();
  const last = document.querySelector<HTMLElement>('[data-zone="4"]')!;
  expect(last.className).toContain('empty');
  expect(last.querySelector('.zp-app')).toBeNull();
  expect(screen.getByText('2 windows')).toBeTruthy();
});

it('says why there is nothing to preview, in the words the layout key uses', async () => {
  mocks.set('wall2_arrange_preview', () => {
    throw 'no windows';
  });
  const r = render(<ZonesPreviewCard />);
  await flush();
  expect(screen.getByText('No windows to arrange on the big screen')).toBeTruthy();
  r.unmount();
  mocks.set('wall2_arrange_preview', () => {
    throw 'no big screen';
  });
  render(<ZonesPreviewCard />);
  await flush();
  expect(screen.getByText('No big screen found')).toBeTruthy();
});

it('reads the preview once when the card opens, and never runs the layout', async () => {
  const ran: unknown[] = [];
  mocks.set('wall2_arrange', (a) => (ran.push(a), { moved: 4, asked: 4 }));
  render(
    <>
      <button type="button" className="zk" {...previewTip('layout:zones', false, 'My zones. Right-click for more.')}>
        My zones
      </button>
      <button type="button" className="fk" {...previewTip('layout:focus', false, 'Focus. Right-click for more.')}>
        Focus
      </button>
      <button type="button" className="off" {...previewTip('layout:zones', true, 'There is no big screen')}>
        Off zones
      </button>
      <HoverTipLayer />
    </>,
  );
  expect(calls).toEqual([]);
  fireEvent.mouseEnter(document.querySelector('.zk')!);
  await flush(TIP_DELAY_MS);
  expect(document.querySelector('.hover-tip .zp-map')).not.toBeNull();
  expect(calls).toEqual(['preview']);
  fireEvent.mouseLeave(document.querySelector('.zk')!);
  fireEvent.mouseEnter(document.querySelector('.fk')!);
  await flush(TIP_DELAY_MS);
  expect(document.querySelector('.hover-tip')!.textContent).toBe('Focus. Right-click for more.');
  fireEvent.mouseLeave(document.querySelector('.fk')!);
  fireEvent.mouseEnter(document.querySelector('.off')!);
  await flush(TIP_DELAY_MS);
  expect(document.querySelector('.hover-tip')!.textContent).toBe('There is no big screen');
  expect(calls).toEqual(['preview']);
  expect(ran).toEqual([]);
});
