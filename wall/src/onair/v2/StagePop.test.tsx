import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { mocks } from '../../bridge/tauri';
import { HoverTipLayer, resetTip } from '../../ui/HoverTip';
import { useToolsStore } from '../../tools/store';
import { isShare, spBanner, spLabel, spOrder, spWord, SP_OFF, type SpStatus } from './stagepopModel';
import { StagePop } from './StagePop';
import { useStagePop } from './stagepopStore';

const FEEDS = [
  { key: 'stage', name: 'Stage' },
  { key: 'share-1', name: 'Screenshare' },
  { key: 'cam-1', name: 'Maya' },
  { key: 'cam-2', name: 'Theo' },
  { key: 'cam-3', name: 'Priya' },
];
const base: SpStatus = { state: 'connected', feeds: FEEDS, mode: 'cam-3', window: { open: true, fullscreen: false }, placement: { left: 2560, top: 80, source: 'elgato' }, token: 'hidden' };
const put = (over: Partial<SpStatus>) => act(() => useStagePop.setState({ status: { ...base, ...over }, failed: false }));
const radios = () => [...document.querySelectorAll<HTMLElement>('[role="radio"]')];
const labels = () => radios().map((r) => r.textContent);
const checked = () => radios().filter((r) => r.getAttribute('aria-checked') === 'true').map((r) => r.textContent);
const btn = (name: string) => screen.getByRole('button', { name: new RegExp(`^${name}$`) });
const disabled = (el: HTMLElement) => el.getAttribute('aria-disabled') === 'true';

let sent: unknown[];
beforeEach(() => {
  sent = [];
  mocks.set('wall2_stagepop_send', (args) => void sent.push(args?.cmd));
  mocks.set('wall2_stagepop_status', () => useStagePop.getState().status);
  useStagePop.setState({ status: SP_OFF, failed: false });
});
afterEach(() => {
  cleanup();
  resetTip();
  mocks.delete('wall2_stagepop_send');
  mocks.delete('wall2_stagepop_status');
});

it('open with a guest showing: five views, the guest lit, Close and Full screen live', () => {
  put({});
  render(<StagePop />);
  expect(labels()).toEqual(['Stage', 'Share', 'Maya', 'Theo', 'Priya']);
  expect(checked()).toEqual(['Priya']);
  expect(screen.getByRole('status', { name: '' }).textContent).toBe('Open');
  expect(btn('Close')).toBeTruthy();
  expect(disabled(btn('Full screen'))).toBe(false);
  expect(btn('Full screen').getAttribute('aria-pressed')).toBe('false');
  expect(screen.getByText('Name tags and banners are not drawn.')).toBeTruthy();
});

it('open with 3 people and a screenshare: Share sits second, with the screen icon, and can be lit', () => {
  put({ mode: 'share-1' });
  render(<StagePop />);
  expect(labels()).toEqual(['Stage', 'Share', 'Maya', 'Theo', 'Priya']);
  expect(checked()).toEqual(['Share']);
});

it('pop-out closed: Stage lit, Open ready, Full screen not', () => {
  put({ mode: 'stage', window: { open: false, fullscreen: false } });
  render(<StagePop />);
  expect(checked()).toEqual(['Stage']);
  expect(document.querySelector('.oa2-hd-r')?.textContent).toBe('Closed');
  expect(disabled(btn('Open'))).toBe(false);
  expect(screen.queryByRole('button', { name: /^Close$/ })).toBeNull();
  expect(disabled(btn('Full screen'))).toBe(true);
});

it('add-on not connected: the banner stands in for the views, Open and Full screen are off', () => {
  put({ state: 'waiting', feeds: [], mode: null, window: { open: false, fullscreen: false } });
  render(<StagePop />);
  expect(document.querySelector('.oa2-hd-r')?.textContent).toBe('Not connected');
  expect(screen.getByText('Firefox add-on not connected. Open the studio tab in Firefox.')).toBeTruthy();
  expect(radios().length).toBe(0);
  expect(disabled(btn('Open'))).toBe(true);
  expect(disabled(btn('Full screen'))).toBe(true);
  fireEvent.click(btn('Open'));
  expect(sent).toEqual([]);
});

it('full screen: the word, Close, and Full screen lit and pressed', () => {
  put({ window: { open: true, fullscreen: true } });
  render(<StagePop />);
  expect(document.querySelector('.oa2-hd-r')?.textContent).toBe('Full screen');
  expect(btn('Full screen').getAttribute('aria-pressed')).toBe('true');
  expect(btn('Full screen').className).toContain('cy');
  expect(btn('Close')).toBeTruthy();
});

it('port busy and link off say so in the banner', () => {
  put({ state: 'port busy', feeds: [] });
  const { unmount } = render(<StagePop />);
  expect(screen.getByText('Port 47231 is in use by another program.')).toBeTruthy();
  unmount();
  put({ state: 'off', feeds: [] });
  render(<StagePop />);
  expect(screen.getByText('The pop-out link is off on this PC.')).toBeTruthy();
});

it('connected before the studio tab lists its views: a waiting line, no buttons', () => {
  put({ feeds: [], mode: null });
  render(<StagePop />);
  expect(screen.getByText('Connected. Waiting for the studio tab to list its views.')).toBeTruthy();
  expect(radios().length).toBe(0);
});

it('the buttons send their commands', async () => {
  put({});
  render(<StagePop />);
  fireEvent.click(radios()[2]);
  fireEvent.click(btn('Full screen'));
  fireEvent.click(btn('Close'));
  await waitFor(() => expect(sent.length).toBe(3));
  expect(sent).toEqual([{ type: 'mode', key: 'cam-1' }, { type: 'fullscreen', on: true }, { type: 'close' }]);
  // The lit view does nothing when pressed again.
  fireEvent.click(radios()[4]);
  expect(sent.length).toBe(3);
});

it('Open sends open; leaving full screen sends fullscreen off', async () => {
  put({ window: { open: false, fullscreen: false } });
  const { unmount } = render(<StagePop />);
  fireEvent.click(btn('Open'));
  await waitFor(() => expect(sent).toEqual([{ type: 'open' }]));
  unmount();
  put({ window: { open: true, fullscreen: true } });
  render(<StagePop />);
  fireEvent.click(btn('Full screen'));
  await waitFor(() => expect(sent[1]).toEqual({ type: 'fullscreen', on: false }));
});

it('a refused command says so under the buttons', async () => {
  mocks.set('wall2_stagepop_send', () => {
    throw 'not connected';
  });
  put({});
  render(<StagePop />);
  fireEvent.click(radios()[0]);
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.getByRole('alert').textContent).toBe('The add-on did not take that. Try again.');
});

it('the Tools button opens the drawer at Stage pop-out', () => {
  put({});
  render(<StagePop />);
  fireEvent.click(screen.getByRole('button', { name: 'Pop-out placement and pairing code in Tools' }));
  expect(useToolsStore.getState().open).toBe(true);
  expect(useToolsStore.getState().focus).toBe('stagepop');
});

it('every control carries a hover card, in every state', async () => {
  const states: Partial<SpStatus>[] = [{}, { window: { open: true, fullscreen: true } }, { mode: 'stage', window: { open: false, fullscreen: false } }, { state: 'waiting', feeds: [], mode: null, window: { open: false, fullscreen: false } }];
  for (const over of states) {
    put(over);
    const { unmount } = render(
      <>
        <StagePop />
        <HoverTipLayer />
      </>,
    );
    const buttons = [...document.querySelectorAll<HTMLElement>('.oa2-stagepop button')];
    expect(buttons.length).toBeGreaterThanOrEqual(3);
    for (const el of buttons) {
      act(() => void fireEvent.focus(el));
      await act(async () => void (await new Promise((r) => setTimeout(r, 30))));
      const card = document.querySelector('.hover-tip');
      expect(card?.textContent?.length ?? 0, el.textContent || el.getAttribute('aria-label') || '').toBeGreaterThan(5);
      act(() => void fireEvent.blur(el));
    }
    unmount();
    resetTip();
  }
});

it('the model: words, banners, order and labels', () => {
  expect(spWord(SP_OFF)).toBe('Not connected');
  expect(spWord({ ...base, window: { open: false, fullscreen: false } })).toBe('Closed');
  expect(spWord(base)).toBe('Open');
  expect(spBanner(base)).toBeNull();
  expect(isShare({ key: 'k', name: ' Screen share ' })).toBe(true);
  expect(isShare({ key: 'stage', name: 'Share' })).toBe(false);
  expect(spLabel({ key: 'k', name: 'Screenshare' })).toBe('Share');
  const shuffled = [FEEDS[3], FEEDS[1], FEEDS[0], FEEDS[2]];
  expect(spOrder(shuffled).map((f) => f.name)).toEqual(['Stage', 'Screenshare', 'Theo', 'Maya']);
});
