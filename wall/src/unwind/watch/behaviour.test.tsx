import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mocks } from '../../bridge/tauri';
import { useSkyStore } from '../../horizon/sky';
import { resetNowPlaying } from '../../music/store';
import { Rail } from '../../rail/Rail';
import { useSignalStore } from '../../signals/store';
import { usePlaceStore } from '../../state/places';
import { HoverTipLayer, resetTip, TIP_DELAY_MS } from '../../ui/HoverTip';
import { resetLastPlayed } from '../lastPlayed';
import { LOOKS_KEY } from './looks';
import { framePoster } from './PlayerFrame';
import { SAVED_KEY, type SavedItem } from './saved';
import { resetWatch, useWatchStore } from './store';
import { UnwindView } from './testView';
import { YOUTUBE_EMBED_ORIGIN } from './urls';
import { CTL_REST_MS } from './Watch';

// Steps fake timers through several seconds at most; the limit keeps a stuck step from hanging CI.
vi.setConfig({ testTimeout: 20_000 });

const V = 'Ab3dEfGh1jK';
const ITEMS: SavedItem[] = [
  { kind: 'video', id: V, label: 'Night drive mix' },
  { kind: 'twitch', id: 'pixel_harbor', label: 'pixel_harbor' },
];

const flush = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

const frame = () => document.querySelector('iframe');
const layer = () => document.querySelector<HTMLElement>('.w-layer')!;
const stage = () => document.querySelector<HTMLElement>('.w-stage')!;
const ctl = () => document.querySelector('.w-now')?.getAttribute('data-ctl') ?? null;
const unwindButton = () => screen.getByRole('button', { name: 'Unwind' });

async function playing(look = 'drivein', kind: 'video' | 'twitch' = 'video') {
  localStorage.setItem(SAVED_KEY, JSON.stringify(ITEMS));
  localStorage.setItem(LOOKS_KEY, JSON.stringify({ mode: 'one', all: look }));
  resetWatch();
  useWatchStore.getState().setTab('watch');
  useWatchStore.getState().play(ITEMS.find((i) => i.kind === kind)!);
  // As if the player had said it started (no refused-autoplay wait in the middle of a test).
  useWatchStore.getState().setReport({ started: true });
  render(
    <>
      <Rail />
      <UnwindView />
      <HoverTipLayer />
    </>,
  );
  await flush();
  expect(frame()).not.toBeNull();
}

function send(win: Window | null, data: unknown, origin = YOUTUBE_EMBED_ORIGIN) {
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { origin, data: JSON.stringify(data), source: win }));
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  resetWatch();
  resetTip();
  usePlaceStore.setState({ active: 'unwind', from: 'work' });
  useSignalStore.setState({ call: null });
  mocks.set('get_now_playing', () => null);
});
afterEach(() => {
  vi.useRealTimers();
  mocks.clear();
  resetNowPlaying();
  resetLastPlayed();
  localStorage.clear();
  framePoster.render = null;
});

describe('the video keeps playing out of sight', () => {
  it('leaving Watch for Listen and Unwind for Work keeps the same frame element under the same parent; coming back shows it in its look', async () => {
    await playing('feather');
    const el = frame()!;
    const parent = el.parentElement!;
    const screenEl = stage().querySelector('.w-screen');
    expect(layer().getAttribute('data-shown')).toBe('true');
    expect(stage().className).toBe('w-stage w-feather');

    await act(async () => useWatchStore.getState().setTab('listen'));
    expect(frame()).toBe(el);
    expect(el.parentElement).toBe(parent);
    expect(layer().getAttribute('data-shown')).toBe('false');
    expect(layer().getAttribute('aria-hidden')).toBe('true');
    expect(stage().className).toBe('w-stage w-parked');
    expect(document.querySelector('.w-glow, .w-edge')).toBeNull();

    await act(async () => usePlaceStore.getState().setActive('work'));
    expect(frame()).toBe(el);
    expect(el.parentElement).toBe(parent);
    expect(useWatchStore.getState().playing?.label).toBe('Night drive mix');

    await act(async () => usePlaceStore.getState().setActive('zen'));
    expect(frame()).toBe(el);

    await act(async () => usePlaceStore.getState().setActive('unwind'));
    await act(async () => useWatchStore.getState().setTab('watch'));
    expect(frame()).toBe(el);
    expect(el.parentElement).toBe(parent);
    expect(stage().querySelector('.w-screen')).toBe(screenEl);
    expect(layer().getAttribute('data-shown')).toBe('true');
    expect(stage().className).toBe('w-stage w-feather');
    expect(document.querySelector('.w-glow')).not.toBeNull();
  });

  it('out of sight it claims nothing from the sky, and its look claims again on return', async () => {
    await playing('sun');
    expect(useSkyStore.getState().claims.watch?.noMoon).toBe(true);
    await act(async () => usePlaceStore.getState().setActive('home'));
    expect(useSkyStore.getState().claims).toEqual({});
    await act(async () => usePlaceStore.getState().setActive('unwind'));
    expect(useSkyStore.getState().claims.watch?.noMoon).toBe(true);
  });

  it('the pointer never reaches the parked frame, even when the player asks for a click', async () => {
    await playing('drivein');
    act(() => useWatchStore.getState().setNeedsClick(true));
    expect(frame()!.className).toContain('w-take');
    await act(async () => useWatchStore.getState().setTab('listen'));
    expect(frame()!.className).not.toContain('w-take');
    expect(frame()!.tabIndex).toBe(-1);
    await act(async () => useWatchStore.getState().setTab('watch'));
    expect(frame()!.className).toContain('w-take');
  });

  it('a call still stops and removes it, out of sight too', async () => {
    await playing();
    await act(async () => usePlaceStore.getState().setActive('work'));
    await act(async () => useSignalStore.setState({ call: { kind: 'teams', since: 0, camera: false } as never }));
    expect(frame()).toBeNull();
    expect(useWatchStore.getState().playing).toBeNull();
    expect(useWatchStore.getState().stopped).toBe('Stopped for your call.');
  });

  it('the Stop button removes it', async () => {
    await playing();
    await act(async () => screen.getByRole('button', { name: 'Stop' }).click());
    expect(frame()).toBeNull();
    expect(useWatchStore.getState().playing).toBeNull();
  });

  it('the rail marks Unwind while it plays out of sight; the tip names it and a click goes back to it', async () => {
    await playing();
    expect(unwindButton().querySelector('.rb-play')).toBeNull();
    await act(async () => useWatchStore.getState().setTab('listen'));
    expect(unwindButton().querySelector('.rb-ico .rb-play')).not.toBeNull();
    await act(async () => usePlaceStore.getState().setActive('work'));
    expect(unwindButton().querySelector('.rb-play')).not.toBeNull();
    expect(unwindButton().getAttribute('aria-description')).toBe('Night drive mix is playing');
    fireEvent.mouseEnter(unwindButton());
    await flush(TIP_DELAY_MS);
    expect(document.querySelector('.hover-tip')!.textContent).toBe('Night drive mix is playing. Click to go to it.');
    fireEvent.mouseLeave(unwindButton());
    const el = frame();
    await act(async () => fireEvent.click(unwindButton()));
    expect(usePlaceStore.getState().active).toBe('unwind');
    expect(useWatchStore.getState().tab).toBe('watch');
    expect(frame()).toBe(el);
    expect(unwindButton().querySelector('.rb-play')).toBeNull();
    // Nothing playing: no mark anywhere.
    await act(async () => useWatchStore.getState().stop());
    await act(async () => usePlaceStore.getState().setActive('work'));
    expect(unwindButton().querySelector('.rb-play')).toBeNull();
  });
});

describe('the controls fade (5A)', () => {
  it('fade 3 seconds after play, keep the title, and come back when the pointer enters the left block', async () => {
    await playing();
    expect(ctl()).toBe('shown');
    await flush(CTL_REST_MS - 100);
    expect(ctl()).toBe('shown');
    await flush(100);
    expect(ctl()).toBe('rest');
    expect(document.querySelector('.w-panel')!.getAttribute('data-ctl')).toBe('rest');
    expect(screen.getByText('Night drive mix', { selector: '.w-title' })).toBeTruthy();
    fireEvent.pointerEnter(document.querySelector('.w-now')!);
    expect(ctl()).toBe('shown');
    await flush(CTL_REST_MS * 2);
    expect(ctl()).toBe('shown');
    fireEvent.pointerLeave(document.querySelector('.w-now')!);
    await flush(CTL_REST_MS);
    expect(ctl()).toBe('rest');
  });

  it('the Look row and the band over the video\'s lower edge bring them back too', async () => {
    await playing();
    await flush(CTL_REST_MS);
    expect(ctl()).toBe('rest');
    fireEvent.pointerEnter(document.querySelector('.w-lookbar')!);
    expect(ctl()).toBe('shown');
    fireEvent.pointerLeave(document.querySelector('.w-lookbar')!);
    await flush(CTL_REST_MS);
    expect(ctl()).toBe('rest');
    const band = document.querySelector('.w-edge')!;
    expect(band.closest('.w-layer')).not.toBeNull();
    expect(band.contains(frame())).toBe(false);
    fireEvent.pointerEnter(band);
    expect(ctl()).toBe('shown');
    await flush(CTL_REST_MS * 2);
    expect(ctl()).toBe('shown');
    fireEvent.pointerLeave(band);
    await flush(CTL_REST_MS);
    expect(ctl()).toBe('rest');
  });

  it('Tab brings them back, and they stay while a control has focus', async () => {
    await playing();
    await flush(CTL_REST_MS);
    expect(ctl()).toBe('rest');
    fireEvent.keyDown(document.body, { key: 'Tab' });
    expect(ctl()).toBe('shown');
    const pause = screen.getByRole('button', { name: 'Pause' });
    act(() => pause.focus());
    await flush(CTL_REST_MS * 2);
    expect(ctl()).toBe('shown');
    act(() => pause.blur());
    await flush(CTL_REST_MS);
    expect(ctl()).toBe('rest');
  });

  it('never fade while paused, while a notice shows or with nothing on', async () => {
    await playing();
    act(() => useWatchStore.getState().setPaused(true));
    await flush(CTL_REST_MS * 3);
    expect(ctl()).toBe('shown');
    act(() => useWatchStore.getState().setPaused(false));
    await flush(CTL_REST_MS);
    expect(ctl()).toBe('rest');
    // The click line.
    act(() => useWatchStore.getState().setNeedsClick(true));
    expect(ctl()).toBe('shown');
    await flush(CTL_REST_MS * 3);
    expect(ctl()).toBe('shown');
    expect(screen.getByText('Click the video to start')).toBeTruthy();
    act(() => useWatchStore.getState().setNeedsClick(false));
    // An open failure.
    mocks.set('wall2_watch_open', () => {
      throw new Error('no browser');
    });
    await act(async () => screen.getByRole('button', { name: /Open in YouTube/ }).click());
    await flush();
    expect(screen.getByText('Could not open the browser')).toBeTruthy();
    await flush(CTL_REST_MS + 500);
    expect(ctl()).toBe('shown');
    // Nothing on.
    await act(async () => useWatchStore.getState().stop());
    await flush(CTL_REST_MS * 2);
    expect(ctl()).toBe('shown');
  });
});

describe('the keys on the Watch tab', () => {
  it('Space plays and pauses from the page, but not while typing in the link field or on a focused button', async () => {
    await playing();
    fireEvent.keyDown(document.body, { key: ' ' });
    expect(useWatchStore.getState().paused).toBe(true);
    fireEvent.keyDown(document.body, { key: ' ' });
    expect(useWatchStore.getState().paused).toBe(false);
    const field = screen.getByLabelText('Paste a YouTube or Twitch link');
    act(() => field.focus());
    fireEvent.keyDown(field, { key: ' ' });
    expect(useWatchStore.getState().paused).toBe(false);
    act(() => field.blur());
    const stop = screen.getByRole('button', { name: 'Stop' });
    act(() => stop.focus());
    fireEvent.keyDown(stop, { key: ' ' });
    expect(useWatchStore.getState().paused).toBe(false);
    expect(useWatchStore.getState().playing).not.toBeNull();
  });

  it('Escape stops the video, but not while the sheet is open, not while typing and not from another place', async () => {
    await playing();
    act(() => useWatchStore.getState().setSheet(true));
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(useWatchStore.getState().playing).not.toBeNull();
    act(() => useWatchStore.getState().setSheet(false));
    const field = screen.getByLabelText('Paste a YouTube or Twitch link');
    act(() => field.focus());
    fireEvent.keyDown(field, { key: 'Escape' });
    expect(useWatchStore.getState().playing).not.toBeNull();
    act(() => field.blur());
    await act(async () => usePlaceStore.getState().setActive('work'));
    fireEvent.keyDown(document.body, { key: 'Escape' });
    fireEvent.keyDown(document.body, { key: ' ' });
    expect(useWatchStore.getState().playing).not.toBeNull();
    expect(useWatchStore.getState().paused).toBe(false);
    await act(async () => usePlaceStore.getState().setActive('unwind'));
    await act(async () => useWatchStore.getState().setTab('listen'));
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(useWatchStore.getState().playing).not.toBeNull();
    await act(async () => useWatchStore.getState().setTab('watch'));
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(useWatchStore.getState().playing).toBeNull();
    expect(frame()).toBeNull();
  });
});

/** Makes `:focus-visible` answer `on` (jsdom answers true for any focus; a browser says false after a mouse click). */
function stubFocusVisible(on: boolean) {
  const orig = Element.prototype.matches;
  return vi.spyOn(Element.prototype, 'matches').mockImplementation(function (this: Element, sel: string) {
    return sel === ':focus-visible' ? on : orig.call(this, sel);
  });
}

describe('review fixes: focus after a mouse click, and the keys on a button', () => {
  it('a mouse click on a control does not hold the controls: they rest 3 seconds after the pointer leaves, and the clicked button lets go of focus', async () => {
    await playing();
    const spy = stubFocusVisible(false);
    try {
      const now = document.querySelector('.w-now')!;
      const pause = screen.getByRole('button', { name: 'Pause' });
      fireEvent.pointerEnter(now);
      act(() => pause.focus());
      fireEvent.pointerLeave(now);
      expect(document.activeElement).not.toBe(pause);
      await flush(CTL_REST_MS - 100);
      expect(ctl()).toBe('shown');
      await flush(100);
      expect(ctl()).toBe('rest');
    } finally {
      spy.mockRestore();
    }
  });

  it('a focus that came from the keyboard holds the controls shown while it stays', async () => {
    await playing();
    const spy = stubFocusVisible(true);
    try {
      const pause = screen.getByRole('button', { name: 'Pause' });
      act(() => pause.focus());
      await flush(CTL_REST_MS * 3);
      expect(ctl()).toBe('shown');
      expect(document.activeElement).toBe(pause);
      act(() => pause.blur());
      await flush(CTL_REST_MS);
      expect(ctl()).toBe('rest');
    } finally {
      spy.mockRestore();
    }
  });

  it('Escape on a focused button does nothing; Escape on the page stops the video and is default-prevented; Escape with nothing playing is left alone', async () => {
    await playing();
    const stopBtn = screen.getByRole('button', { name: 'Stop' });
    act(() => stopBtn.focus());
    expect(fireEvent.keyDown(stopBtn, { key: 'Escape' })).toBe(true);
    expect(useWatchStore.getState().playing).not.toBeNull();
    act(() => stopBtn.blur());
    expect(fireEvent.keyDown(document.body, { key: 'Escape' })).toBe(false);
    expect(useWatchStore.getState().playing).toBeNull();
    // Nothing playing: the key goes on to leave fullscreen.
    expect(fireEvent.keyDown(document.body, { key: 'Escape' })).toBe(true);
  });
});

describe('review fixes: the rail mark says what the video is doing', () => {
  const tipText = async () => {
    fireEvent.mouseEnter(unwindButton());
    await flush(TIP_DELAY_MS);
    const text = document.querySelector('.hover-tip')!.textContent;
    fireEvent.mouseLeave(unwindButton());
    return text;
  };

  it('playing shows the play mark, paused or waiting for a click shows the pause mark, an ended video shows none; a click goes to Watch while marked', async () => {
    await playing();
    await act(async () => usePlaceStore.getState().setActive('work'));
    expect(unwindButton().querySelector('.rb-play:not(.rb-paused)')).not.toBeNull();
    expect(await tipText()).toBe('Night drive mix is playing. Click to go to it.');

    act(() => useWatchStore.getState().setPaused(true));
    expect(unwindButton().querySelector('.rb-play.rb-paused')).not.toBeNull();
    expect(unwindButton().getAttribute('aria-description')).toBe('Night drive mix is paused');
    expect(await tipText()).toBe('Night drive mix is paused. Click to go to it.');

    act(() => useWatchStore.getState().setPaused(false));
    act(() => useWatchStore.getState().setNeedsClick(true));
    expect(unwindButton().querySelector('.rb-play.rb-paused')).not.toBeNull();
    expect(await tipText()).toBe('Night drive mix is paused. Click to go to it.');
    await act(async () => fireEvent.click(unwindButton()));
    expect(usePlaceStore.getState().active).toBe('unwind');
    expect(useWatchStore.getState().tab).toBe('watch');

    await act(async () => usePlaceStore.getState().setActive('work'));
    act(() => useWatchStore.getState().setNeedsClick(false));
    act(() => useWatchStore.getState().setReport({ ended: true }));
    expect(unwindButton().querySelector('.rb-play')).toBeNull();
    expect(unwindButton().getAttribute('aria-description')).toBeNull();
    await act(async () => fireEvent.click(unwindButton()));
    expect(usePlaceStore.getState().active).toBe('unwind');
  });
});

describe('review fixes: focus never stays in the parked player', () => {
  it('leaving Watch drops focus from the frame, and the frame keeps its place', async () => {
    await playing();
    const el = frame()!;
    const parent = el.parentElement;
    act(() => el.focus());
    expect(document.activeElement).toBe(el);
    await act(async () => useWatchStore.getState().setTab('listen'));
    expect(document.activeElement).not.toBe(el);
    expect(frame()).toBe(el);
    expect(el.parentElement).toBe(parent);
    // Focus on something else is left alone.
    await act(async () => useWatchStore.getState().setTab('watch'));
    act(() => unwindButton().focus());
    await act(async () => useWatchStore.getState().setTab('listen'));
    expect(document.activeElement).toBe(unwindButton());
  });
});

describe('the message gate after the stage was out of sight', () => {
  it('reads messages only from this frame on the embed origin, and sends commands only there', async () => {
    await playing();
    const el = frame()!;
    const win = el.contentWindow!;
    const post = vi.spyOn(win, 'postMessage').mockImplementation(() => {});
    act(() => fireEvent.load(el));
    await act(async () => useWatchStore.getState().setTab('listen'));
    await act(async () => usePlaceStore.getState().setActive('work'));
    await act(async () => usePlaceStore.getState().setActive('unwind'));
    await act(async () => useWatchStore.getState().setTab('watch'));
    expect(frame()).toBe(el);
    act(() => useWatchStore.getState().setReport({ count: 0, index: 0 }));
    const msg = { event: 'infoDelivery', info: { playlist: ['a', 'b', 'c'], playlistIndex: 1 } };
    send(win, msg, 'https://evil.example');
    send(window, msg);
    send(null, msg);
    expect(useWatchStore.getState().report.count).toBe(0);
    send(win, msg);
    expect(useWatchStore.getState().report.count).toBe(3);
    post.mockClear();
    await act(async () => screen.getByRole('button', { name: 'Pause' }).click());
    expect(post).toHaveBeenCalled();
    for (const call of post.mock.calls) expect(call[1]).toBe(YOUTUBE_EMBED_ORIGIN);
  });
});
