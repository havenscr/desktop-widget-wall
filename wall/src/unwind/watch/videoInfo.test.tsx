import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mocks } from '../../bridge/tauri';
import { resetNowPlaying } from '../../music/store';
import { useSignalStore } from '../../signals/store';
import { usePlaceStore } from '../../state/places';
import { HoverTipLayer, resetTip, TIP_DELAY_MS } from '../../ui/HoverTip';
import { resetLastPlayed } from '../lastPlayed';
import { ADD_ERRORS, MAX_SAVED, SAVED_KEY, type SavedItem } from './saved';
import { OFFER_MS } from './WatchCard';
import { framePoster, PlayerFrame } from './PlayerFrame';
import { NO_REPORT, resetWatch, useWatchStore } from './store';
import { UnwindView } from './testView';
import { MAX_CHANNEL, MAX_MESSAGE, MAX_TITLE, readPlayerMessage, YOUTUBE_EMBED_ORIGIN } from './urls';

// Steps fake timers through several seconds at most; the limit keeps a stuck step from hanging CI.
vi.setConfig({ testTimeout: 20_000 });

const V = 'Ab3dEfGh1jK';
const PL = 'PLmockPlaylist0001';
const PL2 = 'PLmockPlaylist0002';
const ITEMS: SavedItem[] = [
  { kind: 'video', id: V, label: 'Night drive mix' },
  { kind: 'live', id: 'Lofi_Live01', label: 'YouTube live stream' },
  { kind: 'playlist', id: PL, label: 'Weekend list' },
  { kind: 'twitch', id: 'pixel_harbor', label: 'pixel_harbor' },
];

const flush = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

const delivery = (videoData: unknown, extra: Record<string, unknown> = {}) => JSON.stringify({ event: 'infoDelivery', info: { videoData, ...extra } });
const frameObj = {};
const read = (data: unknown) => readPlayerMessage(YOUTUBE_EMBED_ORIGIN, frameObj, frameObj, data);

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

describe('the video data in a player message', () => {
  it('reads the id, title and channel of a good videoData', () => {
    expect(read(delivery({ video_id: V, title: 'A good title', author: 'A channel' }))).toEqual({ videoId: V, title: 'A good title', channel: 'A channel' });
    expect(read(JSON.stringify({ event: 'initialDelivery', info: { videoData: { video_id: V, title: 'First' } } }))).toEqual({ ready: true, videoId: V, title: 'First' });
  });

  it('reads the position beside it and nothing else from videoData', () => {
    expect(read(delivery({ video_id: V, title: 'T', author: 'C', isLive: true, errorCode: 'x', list: 'y' }, { currentTime: 5 }))).toEqual({ time: 5, videoId: V, title: 'T', channel: 'C' });
  });

  it('gives nothing for a message with no videoData, or one that is not a plain object', () => {
    expect(read(JSON.stringify({ event: 'infoDelivery', info: { currentTime: 3 } }))).toEqual({ time: 3 });
    expect(read(delivery(null))).toBeNull();
    expect(read(delivery('title'))).toBeNull();
    expect(read(delivery(42))).toBeNull();
    expect(read(delivery([{ video_id: V, title: 'In an array' }]))).toBeNull();
  });

  it('ignores a title or channel that is not a string', () => {
    expect(read(delivery({ video_id: V, title: 7, author: { name: 'x' } }))).toEqual({ videoId: V });
    expect(read(delivery({ video_id: V, title: ['a'], author: null }))).toEqual({ videoId: V });
  });

  it('cuts a long title to 200 and a long channel to 100 characters', () => {
    const r = read(delivery({ video_id: V, title: 'T'.repeat(5000), author: 'C'.repeat(5000) }));
    expect(r?.title).toHaveLength(MAX_TITLE);
    expect(r?.channel).toHaveLength(MAX_CHANNEL);
    expect(MAX_TITLE).toBe(200);
    expect(MAX_CHANNEL).toBe(100);
  });

  it('drops control, direction and zero-width characters and folds spaces', () => {
    const dirty = 'A\u202eB\u200bC\u2066D\u2069E\ufeffF\u061cG\u0000H\nI\t\tJ   K';
    expect(read(delivery({ video_id: V, title: dirty, author: '\u202e\u200b' }))).toEqual({ videoId: V, title: 'ABCDEFG H I J K' });
    expect(read(delivery({ video_id: V, title: '   \n\t  ' }))).toEqual({ videoId: V });
  });

  it('drops a bad video_id and still reads the title', () => {
    for (const bad of ['short', `${V}x`, 'Ab3dEfGh1j/', 12, null, '<script>']) {
      expect(read(delivery({ video_id: bad, title: 'Still read' }))).toEqual({ title: 'Still read' });
    }
  });

  it('keeps markup as plain text (nothing is parsed)', () => {
    expect(read(delivery({ video_id: V, title: '<img src=x onerror=alert(1)>' }))?.title).toBe('<img src=x onerror=alert(1)>');
  });

  it('still refuses a message over the size limit, the wrong origin and the wrong source', () => {
    expect(read(delivery({ video_id: V, title: 'T'.repeat(MAX_MESSAGE) }))).toBeNull();
    expect(readPlayerMessage('https://evil.example', frameObj, frameObj, delivery({ video_id: V, title: 'T' }))).toBeNull();
    expect(readPlayerMessage(YOUTUBE_EMBED_ORIGIN, {}, frameObj, delivery({ video_id: V, title: 'T' }))).toBeNull();
  });
});

describe('the store keeps what the player reports', () => {
  function seed() {
    localStorage.setItem(SAVED_KEY, JSON.stringify(ITEMS));
    resetWatch();
  }

  it('a change of title alone is not dropped by setReport', () => {
    seed();
    const st = useWatchStore.getState();
    st.play(ITEMS[0]);
    st.setReport({ title: 'One' });
    expect(useWatchStore.getState().report.title).toBe('One');
    st.setReport({ channel: 'Chan' });
    expect(useWatchStore.getState().report).toMatchObject({ title: 'One', channel: 'Chan' });
    st.setReport({ title: 'Two' });
    expect(useWatchStore.getState().report.title).toBe('Two');
  });

  it('play and stop clear the title and channel', () => {
    seed();
    const st = useWatchStore.getState();
    st.play(ITEMS[0]);
    st.setReport({ title: 'One', channel: 'Chan' });
    st.play(ITEMS[1]);
    expect(useWatchStore.getState().report).toEqual(NO_REPORT);
    st.setReport({ title: 'One', channel: 'Chan' });
    st.stop();
    expect(useWatchStore.getState().report.title).toBeNull();
    expect(useWatchStore.getState().report.channel).toBeNull();
  });

  describe('fillLabel', () => {
    const defaults: SavedItem[] = [
      { kind: 'video', id: V, label: 'YouTube video' },
      { kind: 'live', id: 'Lofi_Live01', label: 'YouTube live stream' },
      { kind: 'playlist', id: PL, label: 'YouTube playlist' },
      { kind: 'twitch', id: 'pixel_harbor', label: 'pixel_harbor on Twitch' },
      { kind: 'video', id: 'Zz9yXxWw8vU', label: 'Typed by hand' },
    ];
    beforeEach(() => {
      localStorage.setItem(SAVED_KEY, JSON.stringify(defaults));
      resetWatch();
    });
    const labels = () => useWatchStore.getState().saved.map((i) => i.label);
    const stored = () => JSON.parse(localStorage.getItem(SAVED_KEY)!).map((i: SavedItem) => i.label);

    it('fills a default label of a video and of a live stream, and saves it', () => {
      const st = useWatchStore.getState();
      expect(st.fillLabel(`video:${V}`, 'Real title')).toBe(true);
      expect(st.fillLabel('live:Lofi_Live01', 'Real stream')).toBe(true);
      expect(labels()).toEqual(['Real title', 'Real stream', 'YouTube playlist', 'pixel_harbor on Twitch', 'Typed by hand']);
      expect(stored()).toEqual(labels());
    });

    it('cleans and cuts the title like any label', () => {
      useWatchStore.getState().fillLabel(`video:${V}`, `\u202e${'W'.repeat(100)}`);
      expect(labels()[0]).toBe('W'.repeat(60));
    });

    it('fills once: the second call finds a name and changes nothing', () => {
      const st = useWatchStore.getState();
      expect(st.fillLabel(`video:${V}`, 'First')).toBe(true);
      expect(st.fillLabel(`video:${V}`, 'Second')).toBe(false);
      expect(labels()[0]).toBe('First');
    });

    it('never over a label that was typed, for a playlist or for Twitch', () => {
      const st = useWatchStore.getState();
      expect(st.fillLabel('video:Zz9yXxWw8vU', 'Other')).toBe(false);
      expect(st.fillLabel(`playlist:${PL}`, 'Other')).toBe(false);
      expect(st.fillLabel('twitch:pixel_harbor', 'Other')).toBe(false);
      expect(st.fillLabel('video:Nope0000000', 'Other')).toBe(false);
      expect(labels()).toEqual(defaults.map((d) => d.label));
    });

    it('never while that item\'s name field is open', () => {
      const st = useWatchStore.getState();
      st.setEditing(`video:${V}`);
      expect(st.fillLabel(`video:${V}`, 'Real title')).toBe(false);
      expect(labels()[0]).toBe('YouTube video');
      st.setEditing(null);
      expect(st.fillLabel(`video:${V}`, 'Real title')).toBe(true);
    });

    it('keeps the playing item in step with its new label', () => {
      const st = useWatchStore.getState();
      st.play(defaults[0]);
      st.fillLabel(`video:${V}`, 'Real title');
      expect(useWatchStore.getState().playing?.label).toBe('Real title');
    });
  });
});

describe('the frame takes the title only for its own item', () => {
  function bare(item: SavedItem = ITEMS[0], saved: SavedItem[] = ITEMS) {
    localStorage.setItem(SAVED_KEY, JSON.stringify(saved));
    resetWatch();
    useWatchStore.getState().setTab('watch');
    useWatchStore.getState().play(item);
    render(<PlayerFrame item={item} title={item.label} />);
    return document.querySelector('iframe')!.contentWindow!;
  }
  const send = (win: Window | null, data: string, origin = YOUTUBE_EMBED_ORIGIN) =>
    act(() => {
      window.dispatchEvent(new MessageEvent('message', { origin, data, source: win }));
    });
  const sets = () => {
    let n = 0;
    const off = useWatchStore.subscribe((s, prev) => {
      if (s.report !== prev.report) n += 1;
    });
    return { count: () => n, off };
  };

  it('ignores a report for another video id', () => {
    const win = bare();
    send(win, delivery({ video_id: 'Zz9yXxWw8vU', title: 'Not this one', author: 'Not this channel' }));
    expect(useWatchStore.getState().report.title).toBeNull();
    expect(useWatchStore.getState().report.channel).toBeNull();
  });

  it('ignores a report with no video id, from the wrong origin or from the wrong window', () => {
    const win = bare();
    send(win, delivery({ title: 'No id' }));
    send(win, delivery({ video_id: V, title: 'Bad origin' }), 'https://evil.example');
    send(null, delivery({ video_id: V, title: 'Bad source' }));
    expect(useWatchStore.getState().report.title).toBeNull();
  });

  it('takes a matching report and sets the store once for a repeated identical message', () => {
    const win = bare();
    const s = sets();
    const msg = delivery({ video_id: V, title: 'Real title', author: 'Real channel' });
    send(win, msg);
    expect(useWatchStore.getState().report).toMatchObject({ title: 'Real title', channel: 'Real channel' });
    expect(s.count()).toBe(1);
    send(win, msg);
    send(win, msg);
    expect(s.count()).toBe(1);
    send(win, delivery({ video_id: V, title: 'New title', author: 'Real channel' }));
    expect(s.count()).toBe(2);
    s.off();
  });

  it('is not held back by the once a second rule for positions', () => {
    const win = bare();
    send(win, delivery({}, { currentTime: 1 }));
    send(win, delivery({ video_id: V, title: 'Right after' }, { currentTime: 2 }));
    expect(useWatchStore.getState().report.title).toBe('Right after');
  });

  it('fills a default label from the matching title, once', () => {
    const saved: SavedItem[] = [{ kind: 'video', id: V, label: 'YouTube video' }];
    const win = bare(saved[0], saved);
    send(win, delivery({ video_id: V, title: 'Real title' }));
    expect(useWatchStore.getState().saved[0].label).toBe('Real title');
    send(win, delivery({ video_id: V, title: 'Changed later' }));
    expect(useWatchStore.getState().saved[0].label).toBe('Real title');
    expect(useWatchStore.getState().report.title).toBe('Changed later');
  });

  it('takes nothing for a playlist, whatever id it names', () => {
    const win = bare(ITEMS[2]);
    send(win, delivery({ video_id: PL.slice(0, 11), title: 'An item', author: 'A channel' }));
    send(win, delivery({ video_id: V, title: 'An item', author: 'A channel' }));
    expect(useWatchStore.getState().report.title).toBeNull();
    expect(useWatchStore.getState().saved[2].label).toBe('Weekend list');
  });
});

describe('the left block', () => {
  const block = () => document.querySelector('.w-now')!;
  const title = () => block().querySelector('.w-title')!;
  const by = () => block().querySelector('.w-by');

  async function show(item: SavedItem, saved: SavedItem[] = ITEMS) {
    localStorage.setItem(SAVED_KEY, JSON.stringify(saved));
    resetWatch();
    useWatchStore.getState().setTab('watch');
    useWatchStore.getState().play(item);
    useWatchStore.getState().setReport({ started: true });
    render(
      <>
        <UnwindView />
        <HoverTipLayer />
      </>,
    );
    await flush();
  }
  const tipText = async (el: Element) => {
    fireEvent.mouseEnter(el);
    await flush(TIP_DELAY_MS);
    return document.querySelector('.hover-tip')?.innerHTML ?? '';
  };

  it('shows the label, and no channel line, until the player reports', async () => {
    await show(ITEMS[0]);
    expect(title().textContent).toBe('Night drive mix');
    expect(by()).toBeNull();
    expect(screen.getByText('Playing on the wall')).toBeTruthy();
  });

  it('shows the reported title and channel, with the kind and status lines as before', async () => {
    await show(ITEMS[0]);
    act(() => useWatchStore.getState().setReport({ title: 'Real title', channel: 'Real channel' }));
    expect(title().textContent).toBe('Real title');
    expect(by()!.textContent).toBe('Real channel');
    expect(by()!.tagName).toBe('DIV');
    expect(by()!.querySelector('a')).toBeNull();
    expect(block().querySelector('.u-src')!.textContent).toBe('YouTube video');
    expect(screen.getByText('Playing on the wall')).toBeTruthy();
  });

  it('the title tip carries the full title and, when different, the saved name', async () => {
    await show(ITEMS[0]);
    act(() => useWatchStore.getState().setReport({ title: 'Real title', channel: 'Real channel' }));
    const html = await tipText(title());
    expect(html).toContain('Real title');
    expect(html).toContain('Saved as: Night drive mix');
  });

  it('the title tip has no second line when the label is the title', async () => {
    await show(ITEMS[0]);
    act(() => useWatchStore.getState().setReport({ title: 'Night drive mix' }));
    expect(await tipText(title())).not.toContain('Saved as');
  });

  it('the channel tip names the channel and where it comes from', async () => {
    await show(ITEMS[0]);
    act(() => useWatchStore.getState().setReport({ title: 'Real title', channel: 'Real channel' }));
    expect(await tipText(by()!)).toContain('Channel: Real channel. As the player reports it.');
  });

  it('shows a title with no channel line when the channel is not known', async () => {
    await show(ITEMS[0]);
    act(() => useWatchStore.getState().setReport({ title: 'Real title' }));
    expect(title().textContent).toBe('Real title');
    expect(by()).toBeNull();
  });

  it('applies to a live stream', async () => {
    await show(ITEMS[1]);
    act(() => useWatchStore.getState().setReport({ title: 'Live title', channel: 'Live channel' }));
    expect(title().textContent).toBe('Live title');
    expect(by()!.textContent).toBe('Live channel');
  });

  it('leaves a playlist and a Twitch item as they were, even if a report were set', async () => {
    await show(ITEMS[2]);
    act(() => useWatchStore.getState().setReport({ title: 'An item', channel: 'A channel' }));
    expect(title().textContent).toBe('Weekend list');
    expect(by()).toBeNull();
    document.body.innerHTML = '';
    await show(ITEMS[3]);
    expect(title().textContent).toBe('pixel_harbor');
    expect(by()).toBeNull();
    expect(screen.getByText('Live on the wall')).toBeTruthy();
  });

  it('a stop clears it: the next item starts with its own label', async () => {
    await show(ITEMS[0]);
    act(() => useWatchStore.getState().setReport({ title: 'Real title', channel: 'Real channel' }));
    act(() => useWatchStore.getState().play(ITEMS[1]));
    expect(title().textContent).toBe('YouTube live stream');
    expect(by()).toBeNull();
  });
});

describe('the paste offer', () => {
  const field = () => screen.getByLabelText('Paste a YouTube or Twitch link') as HTMLInputElement;
  const offer = () => document.querySelector('.w-offer');
  const err = () => document.querySelector('.w-err');
  const saved = () => useWatchStore.getState().saved;

  async function paste(text: string) {
    fireEvent.change(field(), { target: { value: text } });
    await act(async () => {
      fireEvent.submit(field().closest('form')!);
    });
  }
  async function open(items: SavedItem[] = []) {
    localStorage.setItem(SAVED_KEY, JSON.stringify(items));
    resetWatch();
    useWatchStore.getState().setTab('watch');
    render(
      <>
        <UnwindView />
        <HoverTipLayer />
      </>,
    );
    await flush();
  }

  it('appears for a video link that also names a playlist, saved as the video', async () => {
    await open();
    await paste(`https://www.youtube.com/watch?v=${V}&list=${PL2}&index=2`);
    expect(saved().map((i) => `${i.kind}:${i.id}`)).toEqual([`video:${V}`]);
    expect(offer()!.textContent).toContain('Saved the video. The link also names a playlist.');
    expect(offer()!.getAttribute('role')).toBe('status');
    expect(err()).toBeNull();
    expect(screen.getByRole('button', { name: 'Save the playlist too' })).toBeTruthy();
    expect(useWatchStore.getState().editing).toBe(`video:${V}`);
  });

  it('does not appear for a plain video link, a playlist link or a refusal', async () => {
    await open();
    await paste(`https://youtu.be/${V}`);
    expect(offer()).toBeNull();
    await paste(`https://www.youtube.com/playlist?list=${PL2}`);
    expect(offer()).toBeNull();
    await paste('https://example.com/x');
    expect(offer()).toBeNull();
    expect(err()).not.toBeNull();
  });

  it('its button adds the playlist as its own entry and the line goes; the video\'s name field stays open', async () => {
    await open();
    await paste(`https://www.youtube.com/watch?v=${V}&list=${PL2}`);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save the playlist too' }));
    });
    expect(saved().map((i) => `${i.kind}:${i.id}`)).toEqual([`playlist:${PL2}`, `video:${V}`]);
    expect(saved()[0].label).toBe('YouTube playlist');
    expect(JSON.parse(localStorage.getItem(SAVED_KEY)!)).toHaveLength(2);
    expect(offer()).toBeNull();
    expect(err()).toBeNull();
    expect(useWatchStore.getState().editing).toBe(`video:${V}`);
  });

  it('its button has a hover tip', async () => {
    await open();
    await paste(`https://www.youtube.com/watch?v=${V}&list=${PL2}`);
    fireEvent.mouseEnter(screen.getByRole('button', { name: 'Save the playlist too' }));
    await flush(TIP_DELAY_MS);
    expect(document.querySelector('.hover-tip')!.textContent).toBe('Adds that YouTube playlist to the list as its own entry');
  });

  it('says "already in the list" when the playlist is saved already', async () => {
    await open([{ kind: 'playlist', id: PL2, label: 'Mine' }]);
    await paste(`https://www.youtube.com/watch?v=${V}&list=${PL2}`);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save the playlist too' }));
    });
    expect(err()!.textContent).toBe(ADD_ERRORS.dup);
    expect(offer()).toBeNull();
    expect(saved()).toHaveLength(2);
  });

  it('says "list is full" when the video took the last place', async () => {
    const items: SavedItem[] = Array.from({ length: MAX_SAVED - 1 }, (_, i) => ({ kind: 'video', id: `Fill${String(i).padStart(2, '0')}abcde`.slice(0, 11), label: `Filler ${i}` }));
    await open(items);
    await paste(`https://www.youtube.com/watch?v=${V}&list=${PL2}`);
    expect(saved()).toHaveLength(MAX_SAVED);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save the playlist too' }));
    });
    expect(err()!.textContent).toBe(ADD_ERRORS.full);
    expect(saved()).toHaveLength(MAX_SAVED);
  });

  it('a video already in the list with a playlist not saved: the refusal stays and the offer follows, with its own sentence', async () => {
    await open([{ kind: 'video', id: V, label: 'Mine' }]);
    await paste(`https://www.youtube.com/watch?v=${V}&list=${PL2}`);
    expect(err()!.textContent).toBe(ADD_ERRORS.dup);
    expect(offer()!.textContent).toContain('That video is already saved. The link also names a playlist.');
    expect(offer()!.textContent).not.toContain('Saved the video.');
    expect(saved()).toHaveLength(1);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save the playlist too' }));
    });
    expect(saved().map((i) => `${i.kind}:${i.id}`)).toEqual([`playlist:${PL2}`, `video:${V}`]);
    expect(offer()).toBeNull();
  });

  it('a video and its playlist both saved already: only the refusal, no offer', async () => {
    await open([
      { kind: 'video', id: V, label: 'Mine' },
      { kind: 'playlist', id: PL2, label: 'Mine too' },
    ]);
    await paste(`https://www.youtube.com/watch?v=${V}&list=${PL2}`);
    expect(err()!.textContent).toBe(ADD_ERRORS.dup);
    expect(offer()).toBeNull();
  });

  it('a video already saved with a Mix list: only the refusal, no offer', async () => {
    await open([{ kind: 'video', id: V, label: 'Mine' }]);
    await paste(`https://www.youtube.com/watch?v=${V}&list=RD${V}`);
    expect(err()!.textContent).toBe(ADD_ERRORS.dup);
    expect(offer()).toBeNull();
  });

  it('a new video with a Mix, radio, Watch later or Liked list is saved with no offer', async () => {
    await open();
    for (const [i, list] of [`RD${V}`, 'RDCLAK5uy_mockRadioList', 'WL', 'LL'].entries()) {
      await paste(`https://www.youtube.com/watch?v=Mix000000${i}x&list=${list}`);
      expect(offer()).toBeNull();
      expect(err()).toBeNull();
    }
    expect(saved()).toHaveLength(4);
  });

  it('the focus goes to the paste field after the button, whether the save worked or was refused', async () => {
    await open();
    await paste(`https://www.youtube.com/watch?v=${V}&list=${PL2}`);
    const button = screen.getByRole('button', { name: 'Save the playlist too' });
    act(() => button.focus());
    expect(document.activeElement).toBe(button);
    await act(async () => {
      fireEvent.click(button);
    });
    expect(document.activeElement).toBe(field());
    // Refused: the playlist is in the list already.
    await paste(`https://www.youtube.com/watch?v=Zz9yXxWw8vU&list=${PL2}`);
    const again = screen.getByRole('button', { name: 'Save the playlist too' });
    act(() => again.focus());
    await act(async () => {
      fireEvent.click(again);
    });
    expect(err()!.textContent).toBe(ADD_ERRORS.dup);
    expect(document.activeElement).toBe(field());
  });

  it('goes on the next paste', async () => {
    await open();
    await paste(`https://www.youtube.com/watch?v=${V}&list=${PL2}`);
    expect(offer()).not.toBeNull();
    await paste(`https://youtu.be/Zz9yXxWw8vU`);
    expect(offer()).toBeNull();
  });

  it('goes when the field is typed in', async () => {
    await open();
    await paste(`https://www.youtube.com/watch?v=${V}&list=${PL2}`);
    fireEvent.change(field(), { target: { value: 'h' } });
    expect(offer()).toBeNull();
  });

  it('goes after 20 seconds, and not before', async () => {
    await open();
    await paste(`https://www.youtube.com/watch?v=${V}&list=${PL2}`);
    await flush(OFFER_MS - 100);
    expect(offer()).not.toBeNull();
    await flush(100);
    expect(offer()).toBeNull();
    expect(OFFER_MS).toBe(20_000);
  });
});
