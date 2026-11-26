import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LIBRARY_DATA } from '../../bridge/devMocks/libraryData';
import { mocks } from '../../bridge/tauri';
import { resetTip } from '../../ui/HoverTip';
import { resetLibIndex } from '../../work/keyLibrary';
import { useYtLive } from '../ytliveStore';
import { StudioKeys } from './StudioKeys';
import { StudioStatus } from './StudioStatus';
import { STUDIO_CONFIRM_MS, studioAnswerText } from './studioModel';
import onair2Raw from '../../styles/onair2.css?raw';
import workRaw from '../../styles/work.css?raw';
import { DEFAULT_SLOTS, LABEL_MAX_PX, PICKER_ORDER, SLOTS_KEY, fitLabel, loadSlots, measureLabel, parseSlots, saveSlots } from './studioSlots';
import { useStudio } from './studioStore';

/** The stylesheets as text, with line endings the same on every checkout. */
const onair2Css = onair2Raw.replace(/\r\n/g, '\n');
const workCss = workRaw.replace(/\r\n/g, '\n');
const NOW = 1_700_000_000_000;
let sends: { key: string; confirm: boolean }[];
let state: string;
let studio = true;
let refuse: string | null;

const both = () => (
  <>
    <StudioKeys now={NOW} />
    <StudioStatus now={NOW} />
  </>
);
const open = async () => {
  render(both());
  await act(async () => {
    await useStudio.getState().read();
  });
};

/** The default slots with these actions put into the first slots. */
const withSlots = (first: string[]) => DEFAULT_SLOTS.map((d, i) => (first[i] ? { a: first[i] } : d));
const tiles = () => [...document.querySelectorAll<HTMLElement>('.oa2-skgrid .key-tile')];
const rightClick = (el: Element) => fireEvent.contextMenu(el);

beforeEach(() => {
  localStorage.clear();
  sends = [];
  state = 'picked';
  studio = true;
  refuse = null;
  useStudio.getState().reset();
  useYtLive.getState().reset();
  resetLibIndex();
  mocks.set('wall2_keys_library', () => LIBRARY_DATA);
  mocks.set('wall2_studio_pick_start', () => ({ state: 'waiting' }));
  mocks.set('wall2_studio_pick_status', () => ({ state, browser: state === 'none' || state === 'several' ? null : 'firefox', studio: studio }));
  mocks.set('wall2_studio_key', (args) => {
    sends.push({ key: String(args?.key), confirm: args?.confirm === true });
    if (refuse) throw refuse;
    return { sent: args?.key, at: NOW - 120_000 };
  });
});
afterEach(() => {
  vi.useRealTimers();
  cleanup();
  resetTip();
  mocks.clear();
});

it('never shows a keys file button: Find window with no window, a quiet Find window once picked, no tile dim', async () => {
  state = 'none';
  await open();
  const tiles = [...document.querySelectorAll('.oa2-skgrid .key-tile')];
  expect(tiles.map((t) => t.getAttribute('aria-label'))).toEqual(['Full Screen Speaker', 'Presenter View', '2 Person Presenter View', 'Screenshare', 'Mute mic', 'Camera off', 'Mark a moment', 'Go live']);
  expect(tiles.some((t) => t.classList.contains('off') || t.hasAttribute('aria-disabled'))).toBe(false);
  const head = document.querySelector('.oa2-studiokeys .oa2-hd') as HTMLElement;
  const needle = ['Open', 'keys', 'file'].join(' ');
  expect(head.querySelectorAll('button').length).toBe(1);
  expect(head.textContent).toContain('Find window');
  expect(head.textContent).not.toContain(needle);
  state = 'picked';
  await act(async () => {
    await useStudio.getState().read();
  });
  expect(head.textContent).not.toContain(needle);
  expect(head.querySelectorAll('button').length).toBe(1);
  expect(head.querySelector('button')?.classList.contains('cy')).toBe(false);
  expect(sends.length).toBe(0);
});

it('Go live needs a second click within 3 seconds and sends confirm only then', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  await open();
  const go = () => screen.getByRole('button', { name: /^Go live/ });
  fireEvent.click(go(), { detail: 1 });
  expect(sends.length).toBe(0);
  expect(screen.getByRole('button', { name: 'Go live? Click again' })).toBeTruthy();
  // Too late: the arm runs out and the next click only arms again.
  act(() => void vi.advanceTimersByTime(STUDIO_CONFIRM_MS + 50));
  expect(screen.queryByRole('button', { name: 'Go live? Click again' })).toBeNull();
  fireEvent.click(go(), { detail: 1 });
  expect(sends.length).toBe(0);
  fireEvent.click(go(), { detail: 1 });
  await waitFor(() => expect(sends).toEqual([{ key: 'golive', confirm: true }]));
});

it('the half of a double click never confirms', async () => {
  await open();
  const go = screen.getByRole('button', { name: /^Go live/ });
  fireEvent.click(go, { detail: 1 });
  fireEvent.click(go, { detail: 2 });
  expect(sends.length).toBe(0);
});

it('Two up sends at once, without confirm, and the Sent line says what the wall sent', async () => {
  localStorage.setItem(SLOTS_KEY, JSON.stringify(withSlots(['two'])));
  await open();
  fireEvent.click(screen.getByRole('button', { name: 'Two up' }), { detail: 1 });
  await waitFor(() => expect(sends).toEqual([{ key: 'two', confirm: false }]));
  await waitFor(() => expect(screen.getAllByText(/Sent: Two up, 2 min ago/).length).toBe(1));
  expect(screen.getByText('Last key sent: Two up, 2 min ago')).toBeTruthy();
  expect(screen.getByText('The wall cannot see which layout is live. It shows what it sent.')).toBeTruthy();
  expect(document.querySelector('.oa2-skgrid [aria-pressed="true"]')).toBeNull();
});

it('says each refusal in words and leaves the Sent line alone', async () => {
  localStorage.setItem(SLOTS_KEY, JSON.stringify(withSlots(['share'])));
  await open();
  const cases: [string, RegExp][] = [
    ['no studio window', /Open StreamYard in a browser, or press Find window/],
    ['not streamyard', /Switch that window to the StreamYard tab/],
    ['gone', /The studio window is gone/],
    ['not forward', /would not come forward/],
    ['busy', /still sending/],
    ['not set up', /Set one in StreamYard Settings, Hotkeys/],
  ];
  for (const [word, text] of cases) {
    refuse = word;
    fireEvent.click(screen.getByRole('button', { name: 'Share' }), { detail: 1 });
    await waitFor(() => expect(screen.getAllByText(text).length).toBeGreaterThan(0));
    await act(async () => void (await new Promise((r) => setTimeout(r, 600))));
  }
  expect(useStudio.getState().sent).toBeNull();
  expect(screen.getByText('No key sent yet', { selector: '.oa2-hd-r' })).toBeTruthy();
});

it('the status block warns in amber when the window is minimized', async () => {
  state = 'minimized';
  await open();
  const line = screen.getByText('Studio window: minimized (StreamYard in Firefox)');
  expect(line.getAttribute('data-warn')).toBe('true');
});

it('shows eight equal keys in two rows of four, defaults in order, short scene labels with full names in the key hover', async () => {
  await open();
  const t = tiles();
  expect(t.length).toBe(8);
  expect(t.map((k) => k.getAttribute('data-key'))).toEqual(['scene1', 'scene2', 'scene3', 'scene4', 'mute', 'camera', 'mark', 'golive']);
  expect(t.map((k) => k.querySelector('.deck-lbl')?.textContent)).toEqual(['Speaker', 'Presenter', '2 Person', 'Screenshare', 'Mute mic', 'Camera off', 'Mark a moment', 'Go live']);
  const grid = document.querySelector('.oa2-skgrid') as HTMLElement;
  expect(grid.querySelectorAll('.key-tile').length).toBe(8);
});

it('right-click opens the picker with the StreamYard group then the Wall group, and a pick survives a reload', async () => {
  await open();
  rightClick(tiles()[7]);
  const dlg = screen.getByRole('dialog');
  const heads = [...dlg.querySelectorAll('.pk-gh')].map((h) => h.textContent);
  expect(heads).toEqual(['StreamYard', 'Wall']);
  const rows = [...dlg.querySelectorAll('.pk-row')].map((r) => r.getAttribute('aria-label'));
  expect(rows).toEqual(['Full Screen Speaker', 'Presenter View', '2 Person Presenter View', 'Screenshare', 'Mute mic', 'Camera off', 'Share', 'Go live', 'Solo', 'Two up', 'Mark a moment', 'Snip', 'Hide screen']);
  expect(dlg.querySelector('input[aria-label="Label"]')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Snip' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(tiles()[7].getAttribute('data-key')).toBe('snip');
  expect(JSON.parse(localStorage.getItem(SLOTS_KEY) ?? '')[7]).toEqual({ a: 'snip' });
  cleanup();
  await open();
  expect(tiles()[7].getAttribute('data-key')).toBe('snip');
});

it('a scene key has a Label field that renames the key and keeps the full name in its aria name', async () => {
  await open();
  rightClick(tiles()[0]);
  const field = screen.getByLabelText('Label') as HTMLInputElement;
  fireEvent.change(field, { target: { value: 'Host' } });
  expect(tiles()[0].querySelector('.deck-lbl')?.textContent).toBe('Host');
  expect(tiles()[0].getAttribute('aria-label')).toBe('Host, Full Screen Speaker');
  expect(JSON.parse(localStorage.getItem(SLOTS_KEY) ?? '')[0]).toEqual({ a: 'scene1', l: 'Host' });
});

it('a bad stored value falls back to the defaults', async () => {
  for (const bad of ['not json', '[]', JSON.stringify(Array(8).fill({ a: 'nope' })), JSON.stringify([...DEFAULT_SLOTS.slice(0, 7), 5])]) {
    localStorage.setItem(SLOTS_KEY, bad);
    render(both());
    expect(tiles().map((k) => k.getAttribute('data-key'))).toEqual(['scene1', 'scene2', 'scene3', 'scene4', 'mute', 'camera', 'mark', 'golive']);
    cleanup();
  }
});

it('scene, mute and camera keys send the right action, the scene by its full name, and never the hotkey path', async () => {
  const calls: { action: string; name: unknown }[] = [];
  mocks.set('wall2_stagepop_studio', (args) => {
    calls.push({ action: String(args?.action), name: args?.name });
    return { ok: true, reason: 'ok' };
  });
  localStorage.setItem(SLOTS_KEY, JSON.stringify(DEFAULT_SLOTS.map((d) => (d.a === 'scene2' ? { a: 'scene2', l: 'Panel' } : d))));
  await open();
  const order = [0, 1, 4, 5];
  for (const i of order) {
    fireEvent.click(tiles()[i], { detail: 1 });
    await waitFor(() => expect(calls.length).toBe(order.indexOf(i) + 1));
    await act(async () => void (await new Promise((r) => setTimeout(r, 100))));
  }
  expect(calls).toEqual([
    { action: 'scene', name: 'Full Screen Speaker' },
    { action: 'scene', name: 'Presenter View' },
    { action: 'mute', name: null },
    { action: 'camera', name: null },
  ]);
  expect(sends.length).toBe(0);
});

it('the answer shows on the key as a short reason that clears, and a miss does not glow', async () => {
  mocks.set('wall2_stagepop_studio', () => ({ ok: false, reason: 'not found' }));
  await open();
  fireEvent.click(tiles()[0], { detail: 1 });
  await waitFor(() => expect(tiles()[0].getAttribute('data-note')).toBe('miss'));
  expect(tiles()[0].querySelector('.oa2-sklbl')!.textContent).toBe('Not found');
  expect(tiles()[0].getAttribute('data-last')).toBeNull();
  expect(screen.getAllByText(/no scene or button by that name/).length).toBeGreaterThan(0);
  await waitFor(() => expect(tiles()[0].getAttribute('data-note')).toBeNull(), { timeout: 4000 });
  expect(tiles()[0].querySelector('.oa2-sklbl')!.textContent).toBe('Speaker');
});

it('a good answer glows the key, and every reason has a short text that fits a key', async () => {
  mocks.set('wall2_stagepop_studio', () => ({ ok: true, reason: 'ok' }));
  await open();
  fireEvent.click(tiles()[4], { detail: 1 });
  await waitFor(() => expect(tiles()[4].getAttribute('data-last')).toBe('true'));
  for (const r of ['ok', 'not found', 'studio not open', 'not connected', 'no answer', 'refused', 'failed'] as const) {
    const t = studioAnswerText({ ok: r === 'ok', reason: r });
    expect(measureLabel(t.short)).toBeLessThanOrEqual(LABEL_MAX_PX);
    expect(t.full.length).toBeGreaterThan(0);
  }
});

it('already muted and busy show short texts that fit a key', async () => {
  mocks.set('wall2_stagepop_studio', () => ({ ok: true, reason: 'already' }));
  await open();
  fireEvent.click(tiles()[4], { detail: 1 });
  await waitFor(() => expect(tiles()[4].querySelector('.oa2-sklbl')!.textContent).toBe('Already muted'));
  expect(tiles()[4].getAttribute('data-note')).toBe('ok');
  expect(studioAnswerText({ ok: true, reason: 'already' }, 'camera').short).toBe('Already off');
  for (const t of [studioAnswerText({ ok: true, reason: 'already' }, 'mute'), studioAnswerText({ ok: true, reason: 'already' }, 'camera'), studioAnswerText({ ok: false, reason: 'busy' })]) {
    expect(measureLabel(t.short)).toBeLessThanOrEqual(LABEL_MAX_PX);
  }
});

it('Go live keeps its two clicks and does not use the add-on', async () => {
  const calls: unknown[] = [];
  mocks.set('wall2_stagepop_studio', (args) => (calls.push(args), { ok: true, reason: 'ok' }));
  await open();
  fireEvent.click(tiles()[7], { detail: 1 });
  await act(async () => void (await new Promise((r) => setTimeout(r, 50))));
  expect(sends.length).toBe(0);
  fireEvent.click(tiles()[7], { detail: 1 });
  await waitFor(() => expect(sends).toEqual([{ key: 'golive', confirm: true }]));
  expect(calls.length).toBe(0);
});

it('only the key sent last glows, and a wall action counts', async () => {
  localStorage.setItem(SLOTS_KEY, JSON.stringify(withSlots(['two', 'share'])));
  await open();
  expect(document.querySelectorAll('[data-last]').length).toBe(0);
  fireEvent.click(tiles()[0], { detail: 1 });
  await waitFor(() => expect(tiles()[0].getAttribute('data-last')).toBe('true'));
  await act(async () => void (await new Promise((r) => setTimeout(r, 600))));
  fireEvent.click(tiles()[1], { detail: 1 });
  await waitFor(() => expect(tiles()[1].getAttribute('data-last')).toBe('true'));
  expect(document.querySelectorAll('[data-last]').length).toBe(1);
  expect(tiles()[0].hasAttribute('data-last')).toBe(false);
});

/** The declarations of the first rule in `css` whose selector is exactly `sel`. */
const ruleOf = (css: string, sel: string): string => {
  const i = css.indexOf(`${sel} {`);
  return i < 0 ? '' : css.slice(css.indexOf('{', i) + 1, css.indexOf('}', i));
};
/** Classes and attributes in a selector: the middle number of its specificity. */
const weight = (sel: string): number => (sel.match(/\.[\w-]+|\[[^\]]+\]/g) ?? []).length;

it('rule A: no studio key has a kind, and the stylesheet colours every studio key as the base key, beating every kind rule', async () => {
  await open();
  expect(tiles().some((k) => k.hasAttribute('data-kind'))).toBe(false);
  cleanup();
  const all = Object.values(PICKER_ORDER).flat();
  for (let at = 0; at < all.length; at += 8) {
    localStorage.setItem(SLOTS_KEY, JSON.stringify(DEFAULT_SLOTS.map((d, i) => (all[at + i] ? { a: all[at + i] } : d))));
    render(both());
    expect(tiles().length).toBe(8);
    expect(tiles().some((k) => k.hasAttribute('data-kind'))).toBe(false);
    cleanup();
  }
  expect(workCss.includes("key-tile[data-kind=")).toBe(true);
  expect(ruleOf(onair2Css, '.oa2 .oa2-studiokeys .deck-tile.key-tile.off')).toBe('');
  const sel = '.oa2 .oa2-studiokeys .deck-tile.key-tile';
  const base = /--g: ([\d, ]+);/.exec(ruleOf(workCss, '.key-tile,\n.fy-plate'))?.[1];
  const studio = /--g: ([\d, ]+);/.exec(ruleOf(onair2Css, sel))?.[1];
  expect(base).toBeTruthy();
  // The studio colour is the base colour, not a kind's.
  expect(studio).toBe(base);
  // The pin outweighs every kind rule (`.key-tile[data-kind='...']`), so a kind could never recolour it.
  for (const m of workCss.matchAll(/(\.key-tile\[data-kind=[^{]+)\{/g)) expect(weight(sel)).toBeGreaterThan(weight(m[1].trim().split(',')[0]));
  // The only accents are the last-sent glow and the armed state.
  expect(onair2Css).toContain(`${sel}[data-last='true']`);
  expect(onair2Css).toContain(`${sel}[data-armed='true']`);
});

it('rule B: a label too long for its key is shortened to one line, and the full name stays in the accessible name', async () => {
  localStorage.setItem(SLOTS_KEY, JSON.stringify(DEFAULT_SLOTS.map((d, i) => (i === 0 ? { a: 'scene1', l: 'ABCDEFGHIJKLMNOP' } : d))));
  await open();
  for (const k of tiles()) {
    const text = k.querySelector('.deck-lbl')?.textContent ?? '';
    expect(text.includes('\n')).toBe(false);
    expect(measureLabel(text)).toBeLessThanOrEqual(LABEL_MAX_PX);
    expect(k.getAttribute('aria-label')).toContain(text);
  }
  // Whatever the text, the drawn words are exactly what fitLabel gives for the full label, so no line can wrap.
  expect(fitLabel('Alpha Beta Gamma Delta', LABEL_MAX_PX, measureLabel)).toBe('Alpha Beta');
  for (const t of ['A', 'Two words', 'Wide wide wide wide wide wide', 'Wwwwwwwwwwwwwwwwwwwwwww']) {
    const fit = fitLabel(t, LABEL_MAX_PX, measureLabel);
    expect(/\s{2,}|\n/.test(fit)).toBe(false);
    expect(measureLabel(fit)).toBeLessThanOrEqual(LABEL_MAX_PX);
    expect(fitLabel(fit, LABEL_MAX_PX, measureLabel)).toBe(fit);
  }
  const long = tiles()[0];
  expect(long.querySelector('.deck-lbl')?.textContent?.endsWith('\u2026')).toBe(true);
  // The name holds the whole label and the drawn words.
  expect(long.getAttribute('aria-label')).toBe('ABCDEFGHIJKLMN\u2026, ABCDEFGHIJKLMNOP, Full Screen Speaker');
  const rule = ruleOf(onair2Css, '.oa2 .oa2-studiokeys .deck-tile.key-tile .deck-lbl.oa2-sklbl');
  expect(rule).toContain('white-space: nowrap');
  expect(rule).toContain('font-size: 16px');
  expect(rule).toContain('text-align: center');
});

it('Snip and Hide screen send their library keys, and glow only once the send went through', async () => {
  const lib: string[] = [];
  let fail = false;
  mocks.set('wall2_keys_send_library', (args) => {
    lib.push(String(args?.id));
    if (fail) throw 'failed';
    return null;
  });
  localStorage.setItem(SLOTS_KEY, JSON.stringify(withSlots(['snip', 'hide'])));
  await open();
  await waitFor(() => expect(document.querySelector('.oa2-studiokeys')).not.toBeNull());
  fail = true;
  fireEvent.click(tiles()[0], { detail: 1 });
  await waitFor(() => expect(lib).toEqual(['snip']));
  await act(async () => void (await new Promise((r) => setTimeout(r, 600))));
  expect(document.querySelector('[data-last]')).toBeNull();
  fail = false;
  fireEvent.click(tiles()[1], { detail: 1 });
  await waitFor(() => expect(lib).toEqual(['snip', 'strip-dark']));
  await waitFor(() => expect(tiles()[1].getAttribute('data-last')).toBe('true'));
  expect(document.querySelectorAll('[data-last]').length).toBe(1);
});

it('two keys with the same action: only the one pressed glows', async () => {
  localStorage.setItem(SLOTS_KEY, JSON.stringify(withSlots(['two', 'two'])));
  await open();
  fireEvent.click(tiles()[1], { detail: 1 });
  await waitFor(() => expect(tiles()[1].getAttribute('data-last')).toBe('true'));
  expect(tiles()[0].hasAttribute('data-last')).toBe(false);
});

it('a pending Go live confirm does not follow a reassignment to another key', async () => {
  await open();
  fireEvent.click(tiles()[7], { detail: 1 });
  expect(tiles()[7].getAttribute('data-armed')).toBe('true');
  rightClick(tiles()[0]);
  fireEvent.click(screen.getByRole('button', { name: 'Go live' }));
  expect(tiles()[0].getAttribute('data-key')).toBe('golive');
  expect(document.querySelector('[data-armed]')).toBeNull();
  fireEvent.click(tiles()[0], { detail: 1 });
  expect(sends.length).toBe(0);
  expect(tiles()[0].getAttribute('data-armed')).toBe('true');
});

const liveStatus = (): void => {
  useYtLive.setState({ status: { state: 'live', startedAt: NOW - 60_000, scheduledAt: null, viewers: 3, chat: false, readAt: NOW, stale: false, word: null, statusLeft: 1000, chatLeft: 1000 } });
};

it('while live the Go live key is End show, glows per slot through the swap, and End show sends only while live', async () => {
  await open();
  fireEvent.click(tiles()[7], { detail: 1 });
  fireEvent.click(tiles()[7], { detail: 1 });
  await waitFor(() => expect(tiles()[7].getAttribute('data-last')).toBe('true'));
  act(() => liveStatus());
  expect(tiles()[7].getAttribute('data-key')).toBe('end');
  expect(tiles()[7].getAttribute('data-last')).toBe('true');
  fireEvent.click(tiles()[7], { detail: 1 });
  fireEvent.click(tiles()[7], { detail: 1 });
  await waitFor(() => expect(sends.map((x) => x.key)).toEqual(['golive', 'end']));
  // Back to not live: the key is Go live again, still the one that glows, and no End show is sent.
  act(() => useYtLive.setState({ status: null }));
  expect(tiles()[7].getAttribute('data-key')).toBe('golive');
  expect(tiles()[7].getAttribute('data-last')).toBe('true');
  fireEvent.click(tiles()[7], { detail: 1 });
  expect(sends.map((x) => x.key)).toEqual(['golive', 'end']);
});

it('a press still in flight does not light a key that was reassigned meanwhile', async () => {
  let release: (v: unknown) => void = () => {};
  mocks.set('wall2_studio_key', () => new Promise((r) => (release = r)));
  localStorage.setItem(SLOTS_KEY, JSON.stringify(withSlots(['two'])));
  await open();
  fireEvent.click(tiles()[0], { detail: 1 });
  rightClick(tiles()[0]);
  fireEvent.click(screen.getByRole('button', { name: 'Share' }));
  expect(tiles()[0].getAttribute('data-key')).toBe('share');
  await act(async () => release({ sent: 'two', at: NOW }));
  expect(document.querySelector('[data-last]')).toBeNull();
});

it('two Go live keys: a confirm arms only the key pressed', async () => {
  localStorage.setItem(SLOTS_KEY, JSON.stringify(withSlots(['golive'])));
  await open();
  fireEvent.click(tiles()[0], { detail: 1 });
  expect(tiles()[0].getAttribute('data-armed')).toBe('true');
  expect(tiles()[7].hasAttribute('data-armed')).toBe(false);
  expect(tiles()[7].querySelector('.deck-lbl')?.textContent).toBe('Go live');
});

it('Snip through a slot also runs from the keyboard, as it is not a mouse-only key', async () => {
  const lib: string[] = [];
  mocks.set('wall2_keys_send_library', (args) => {
    lib.push(String(args?.id));
    return null;
  });
  localStorage.setItem(SLOTS_KEY, JSON.stringify(withSlots(['snip'])));
  await open();
  await waitFor(() => expect(document.querySelector('.oa2-studiokeys')).not.toBeNull());
  fireEvent.click(tiles()[0], { detail: 0 });
  await waitFor(() => expect(lib).toEqual(['snip']));
});

it('Escape closes the picker and returns the focus to the key', async () => {
  await open();
  const key = tiles()[3];
  key.focus();
  fireEvent.keyDown(key, { key: 'ContextMenu' });
  expect(screen.getByRole('dialog')).toBeTruthy();
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).toBeNull();
  await waitFor(() => expect(document.activeElement).toBe(tiles()[3]));
});

it('End show is not in the picker, and a stored End show becomes Go live', async () => {
  localStorage.setItem(SLOTS_KEY, JSON.stringify(DEFAULT_SLOTS.map((d, i) => (i === 0 ? { a: 'end' } : d))));
  await open();
  expect(tiles()[0].getAttribute('data-key')).toBe('golive');
  rightClick(tiles()[1]);
  expect(screen.queryByRole('button', { name: 'End show' })).toBeNull();
});

it('the picker opens from the keyboard, takes the focus, completes a pick, and returns the focus to the key', async () => {
  for (const press of [{ key: 'ContextMenu' }, { key: 'F10', shiftKey: true }]) {
    localStorage.clear();
    await open();
    const key = tiles()[7];
    key.focus();
    fireEvent.keyDown(key, press);
    const dlg = screen.getByRole('dialog');
    expect(dlg.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowDown' });
    const row = document.activeElement as HTMLElement;
    expect(row.classList.contains('pk-row')).toBe(true);
    // Enter on a button is a click.
    fireEvent.click(row);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(tiles()[7].getAttribute('data-key')).not.toBe('golive');
    await waitFor(() => expect(document.activeElement).toBe(tiles()[7]));
    cleanup();
  }
});

it('Mark a moment is busy while it writes', async () => {
  let release: (v: unknown) => void = () => {};
  mocks.set('wall2_onair_mark', () => new Promise((r) => (release = r)));
  await open();
  fireEvent.click(tiles()[6], { detail: 1 });
  await waitFor(() => expect(tiles()[6].getAttribute('aria-busy')).toBe('true'));
  await act(async () => release({ ok: true }));
});

it('the slots are saved on a change and read back; bad stored data and a bad label are cleaned', () => {
  expect(parseSlots(null).map((s) => s.a)).toEqual(DEFAULT_SLOTS.map((s) => s.a));
  const slots = DEFAULT_SLOTS.map((d, i) => (i === 0 ? { a: 'scene1' as const, l: 'Host' } : { ...d }));
  saveSlots(slots);
  expect(JSON.parse(localStorage.getItem(SLOTS_KEY) ?? '')).toEqual(slots);
  expect(loadSlots()).toEqual(slots);
  // A label on a key that is not a scene is dropped; a long one is cut to 16 characters.
  const raw = JSON.stringify(DEFAULT_SLOTS.map((d, i) => (i === 0 ? { a: 'scene2', l: '  ' + 'x'.repeat(40) } : i === 4 ? { a: 'mute', l: 'Quiet' } : d)));
  const out = parseSlots(raw);
  expect(out[0]).toEqual({ a: 'scene2', l: 'x'.repeat(16) });
  expect(out[4]).toEqual({ a: 'mute' });
  // A label that is not a string throws the whole value away; a label of only spaces is dropped.
  expect(parseSlots(JSON.stringify(DEFAULT_SLOTS.map((d, i) => (i === 0 ? { a: 'scene1', l: 7 } : d)))).map((x) => x.l)).toEqual(Array(8).fill(undefined));
  expect(parseSlots(JSON.stringify(DEFAULT_SLOTS.map((d, i) => (i === 0 ? { a: 'scene1', l: '   ' } : d))))[0]).toEqual({ a: 'scene1' });
  expect(parseSlots(JSON.stringify(DEFAULT_SLOTS.map((d, i) => (i === 6 ? { a: 'snip', l: 'Shot' } : d))))[6]).toEqual({ a: 'snip' });
  for (const bad of ['{', 'null', '{}', JSON.stringify(DEFAULT_SLOTS.slice(0, 7)), JSON.stringify([...DEFAULT_SLOTS.slice(0, 7), { a: 'mute', l: 4 }])]) expect(parseSlots(bad).map((s) => s.a)).toEqual(DEFAULT_SLOTS.map((s) => s.a));
});

it('fitLabel keeps a label that fits, drops words then letters when it does not, and never wraps', () => {
  const measure = (s: string) => s.length * 10;
  expect(fitLabel('Speaker', 100, measure)).toBe('Speaker');
  expect(fitLabel('Full Screen Speaker', 100, measure)).toBe('Full');
  const long = fitLabel('Supercalifragilistic', 100, measure);
  expect(long.endsWith('\u2026')).toBe(true);
  expect(measure(long)).toBeLessThanOrEqual(100);
  expect(long.includes('\n')).toBe(false);
  expect(fitLabel('Anything at all', 5, measure)).toBe('\u2026');
});

it('Find window is prominent for no window or several, quiet while a window is in use or minimized, and the status says which window is in use', async () => {
  const find = () => [...document.querySelectorAll('.oa2-hd button')].filter((b) => b.textContent?.includes('Find window'));
  const read = () =>
    act(async () => {
      await useStudio.getState().read();
    });
  state = 'none';
  await open();
  expect(find().length).toBe(2);
  expect(find().every((b) => b.classList.contains('cy'))).toBe(true);
  expect(screen.getByText('Studio window: no StreamYard window found')).toBeTruthy();
  state = 'several';
  await read();
  expect(find().every((b) => b.classList.contains('cy'))).toBe(true);
  expect(screen.getByText('Studio window: more than one StreamYard window found')).toBeTruthy();
  state = 'picked';
  await read();
  expect(find().length).toBe(2);
  expect(find().some((b) => b.classList.contains('cy'))).toBe(false);
  expect(screen.getByText('Studio window in use: StreamYard in Firefox')).toBeTruthy();
  state = 'minimized';
  await read();
  expect(find().length).toBe(2);
  expect(find().some((b) => b.classList.contains('cy'))).toBe(false);
  studio = false;
  state = 'picked';
  await read();
  expect(screen.getByText('Studio window in use: Firefox window you picked')).toBeTruthy();
});

it('one click on a quiet Find window starts a new pick', async () => {
  let started = 0;
  mocks.set('wall2_studio_pick_start', () => {
    started += 1;
    return { state: 'waiting' };
  });
  await open();
  const btn = [...document.querySelectorAll('.oa2-studiokeys .oa2-hd button')].find((b) => b.textContent?.includes('Find window')) as HTMLElement;
  fireEvent.click(btn);
  await waitFor(() => expect(started).toBe(1));
});
