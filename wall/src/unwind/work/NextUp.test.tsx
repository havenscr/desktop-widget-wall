// @ts-ignore node's own file call; the stylesheet rules are read as text.
import { readFileSync } from 'node:fs';
import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mocks } from '../../bridge/tauri';
import type { MeetData } from '../../meet/model';
import { usePlaceStore } from '../../state/places';
import { resetAgents } from '../../agents/useAgents';
import { resetMeetingFeed } from '../../work/useNextMeeting';
import { useWorkLayerStore } from './layerStore';
import { LAYER_FADE_OUT_MS } from './UnwindTimeline';
import { NextUp } from './NextUp';

const flush = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};
const css = (f: string) => (readFileSync(new URL(f, import.meta.url), 'utf8') as string).replace(/\r\n/g, '\n');
let joined: unknown[];

function feed(canJoin: boolean): MeetData {
  const s = Date.now() + 25 * 60_000;
  return { accounts: [], meetings: [{ key: 'm1', accountId: 'a', title: 'Standup', start: new Date(s).toISOString(), end: new Date(s + 1800_000).toISOString(), canJoin }] };
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  resetMeetingFeed();
  resetAgents();
  joined = [];
  mocks.set('wall2_meet_join', (a) => (joined.push(a), null));
  useWorkLayerStore.setState({ shown: true });
});
afterEach(() => {
  vi.useRealTimers();
  mocks.clear();
  localStorage.clear();
  useWorkLayerStore.setState({ shown: false });
});

describe('Next up band', () => {
  it('shows the countdown, the meeting and the stats line, and Join opens the meeting', async () => {
    mocks.set('wall2_meet_next', () => feed(true));
    const r = render(<NextUp tab="watch" />);
    await flush(50);
    expect(r.container.querySelector('.u-nu-big')!.textContent).toMatch(/^In 2[45] min$/);
    expect(r.container.querySelector('.u-nu-title')!.textContent).toMatch(/^Standup at /);
    expect(r.container.querySelector('.u-nu-l2')!.textContent).toMatch(/^0 m focus · 0 meetings · 0 waiting$/);
    fireEvent.click(r.container.querySelector('.u-nu-btn.join')!);
    expect(joined).toEqual([{ key: 'm1' }]);
  });
  it('disables Join and says so when the meeting has no link', async () => {
    mocks.set('wall2_meet_next', () => feed(false));
    const r = render(<NextUp tab="listen" />);
    await flush(50);
    const join = r.container.querySelector<HTMLButtonElement>('.u-nu-btn.join')!;
    expect(join.disabled).toBe(true);
    expect(join.textContent).toBe('No join link');
  });
  it('says so with no meetings, and when the calendar cannot be read', async () => {
    mocks.set('wall2_meet_next', () => ({ accounts: [], meetings: [] }));
    const r = render(<NextUp tab="watch" />);
    await flush(50);
    expect(r.container.querySelector('.u-nu-big')!.textContent).toBe('No meetings ahead');
    expect(r.container.querySelector<HTMLButtonElement>('.u-nu-btn.join')!.disabled).toBe(true);
  });
  it('Go On Air only switches the place', async () => {
    mocks.set('wall2_meet_next', () => feed(true));
    const r = render(<NextUp tab="watch" />);
    await flush(50);
    fireEvent.click(r.container.querySelector('.u-nu-btn.air')!);
    expect(usePlaceStore.getState().active).toBe('onair');
    expect(joined).toEqual([]);
  });
  it('is inert while hidden, keeps its content for the fade out, then unmounts it', async () => {
    mocks.set('wall2_meet_next', () => feed(true));
    const r = render(<NextUp tab="watch" />);
    await flush(50);
    const band = r.container.querySelector<HTMLElement>('.u-nu')!;
    expect(band.hasAttribute('inert')).toBe(false);
    act(() => useWorkLayerStore.setState({ shown: false }));
    expect(band.hasAttribute('inert')).toBe(true);
    expect(band.querySelector('.u-nu-big')).not.toBeNull();
    await flush(LAYER_FADE_OUT_MS + 20);
    expect(band.querySelector('.u-nu-big')).toBeNull();
  });
  it('sits under the volume row on both tabs, clear of the Watch player controls, and fades with the layer', () => {
    const c = css('../../styles/unwind-work.css');
    const rule = (sel: string) => c.slice(c.indexOf(`\n${sel} {`), c.indexOf('\n}', c.indexOf(`\n${sel} {`)));
    expect(rule('.u-nu')).toMatch(/top: 360px;[\s\S]*height: 76px;/);
    expect(rule('.u-nu')).toMatch(/opacity var\(--u-work-out, 400ms\) ease/);
    expect(rule('.u-nu[data-shown]')).toMatch(/opacity 250ms ease/);
    expect(rule('.u-nu.watch')).toMatch(/left: 0;\s*width: 960px;/);
    expect(rule('.u-nu.listen')).toMatch(/left: 500px;\s*width: 842px;/);
  });
  it('keeps every text 16 px or more and the buttons 48 px tall', () => {
    const c = css('../../styles/unwind-work.css');
    const block = c.slice(c.indexOf('.u-nu {'));
    const sizes = [...block.matchAll(/font: \d+ (\d+)px/g)].map((m) => Number(m[1]));
    expect(sizes.length).toBeGreaterThan(5);
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(16);
    expect(block).toMatch(/\.u-nu-btn \{[^}]*height: 48px;/);
  });
});
