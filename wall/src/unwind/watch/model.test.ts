import { beforeEach, describe, expect, it } from 'vitest';
import { usePlaceStore } from '../../state/places';
import { defaultLabel, LINK_ERRORS, MAX_LINK_LENGTH, parseLink, validRef } from './links';
import { DEFAULT_LOOKS, LOOKS, lookFor, nextLook, parseLooks, stepLook } from './looks';
import { addSaved, ADD_ERRORS, cleanLabel, MAX_SAVED, parseSaved, removeSaved, renameSaved, SAVED_KEY } from './saved';
import { resetWatch, useWatchStore } from './store';
import { stopReason, type StopInputs } from './stops';
import { commandMessage, embedUrl, isPlayerOrigin, pageWhere, readPlayState, TWITCH_EMBED_ORIGIN, YOUTUBE_EMBED_ORIGIN } from './urls';

const V = 'Ab3dEfGh1jK';
const PL = 'PLmockPlaylist0001';

describe('parseLink', () => {
  const accept: [string, string, string][] = [
    [`https://youtu.be/${V}`, 'video', V],
    [`youtu.be/${V}`, 'video', V],
    [`https://youtu.be/${V}?si=abc&t=42`, 'video', V],
    [`https://www.youtube.com/watch?v=${V}`, 'video', V],
    [`youtube.com/watch?v=${V}&t=1m&feature=share#top`, 'video', V],
    [`https://m.youtube.com/watch?v=${V}`, 'video', V],
    [`http://www.youtube.com/watch?v=${V}`, 'video', V],
    [`HTTPS://WWW.YOUTUBE.COM/WATCH?v=${V}`, 'video', V],
    [`https://www.youtube.com/live/${V}`, 'live', V],
    [`https://www.youtube.com/live/${V}?feature=share`, 'live', V],
    [`https://www.youtube.com/LIVE/${V}/`, 'live', V],
    [`https://www.youtube.com/playlist?list=${PL}`, 'playlist', PL],
    [`https://www.youtube.com/watch?v=${V}&list=${PL}&index=3`, 'playlist', PL],
    [`https://www.twitch.tv/pixel_harbor`, 'twitch', 'pixel_harbor'],
    [`twitch.tv/Pixel_Harbor/`, 'twitch', 'pixel_harbor'],
    [`https://m.twitch.tv/abc`, 'twitch', 'abc'],
    [`  https://youtu.be/${V}  `, 'video', V],
  ];
  it.each(accept)('accepts %s', (link, kind, id) => {
    expect(parseLink(link)).toEqual({ ok: true, ref: { kind, id } });
  });

  it('keeps the id case of YouTube ids and lower-cases Twitch logins', () => {
    const r = parseLink('https://YOUTU.BE/aBcDeFgHiJk');
    expect(r.ok && r.ref.id).toBe('aBcDeFgHiJk');
  });

  it('falls back to the video when a watch link carries a list that is not a playlist id', () => {
    expect(parseLink(`https://www.youtube.com/watch?v=${V}&list=short`)).toEqual({ ok: true, ref: { kind: 'video', id: V } });
  });

  const refuse: [string, string][] = [
    ['', LINK_ERRORS.empty],
    ['   ', LINK_ERRORS.empty],
    [`https://youtube.com.evil.example/watch?v=${V}`, LINK_ERRORS.other],
    [`https://evil.example/youtube.com/watch?v=${V}`, LINK_ERRORS.other],
    [`https://www.youtube.com@evil.example/watch?v=${V}`, LINK_ERRORS.other],
    [`https://user:pw@www.youtube.com/watch?v=${V}`, LINK_ERRORS.other],
    [`https://www.youtube.com:8443/watch?v=${V}`, LINK_ERRORS.other],
    [`https://notyoutube.com/watch?v=${V}`, LINK_ERRORS.other],
    [`https://youtu.be.evil.example/${V}`, LINK_ERRORS.other],
    [`https://twitch.tv.evil.example/abc`, LINK_ERRORS.other],
    [`https://player.twitch.tv/?channel=abc`, LINK_ERRORS.other],
    [`https://www.youtube-nocookie.com/embed/${V}`, LINK_ERRORS.other],
    ['javascript:alert(1)', LINK_ERRORS.other],
    ['JavaScript://youtube.com/%0aalert(1)', LINK_ERRORS.other],
    [`data:text/html,<a href="https://youtu.be/${V}">`, LINK_ERRORS.other],
    [`ftp://youtu.be/${V}`, LINK_ERRORS.other],
    [`https:youtu.be/${V}`, LINK_ERRORS.other],
    [`//youtu.be/${V}`, LINK_ERRORS.other],
    [`https://youtu.be/${V} https://twitch.tv/abc`, LINK_ERRORS.other],
    [`https://youtu.be/${V}x`, LINK_ERRORS.youtube],
    [`https://youtu.be/short`, LINK_ERRORS.youtube],
    [`https://youtu.be/${V}/extra`, LINK_ERRORS.youtube],
    [`https://youtu.be/Ab3dEfGh1j%2F`, LINK_ERRORS.youtube],
    [`https://www.youtube.com/watch?v=Ab3dEfGh1j"`, LINK_ERRORS.youtube],
    [`https://www.youtube.com/watch`, LINK_ERRORS.youtube],
    [`https://www.youtube.com/shorts/${V}`, LINK_ERRORS.youtube],
    [`https://www.youtube.com/embed/${V}`, LINK_ERRORS.youtube],
    [`https://www.youtube.com/playlist?list=PL1`, LINK_ERRORS.youtube],
    [`https://www.youtube.com/playlist?list=${'P'.repeat(65)}`, LINK_ERRORS.youtube],
    [`https://www.youtube.com/live/${V}/x`, LINK_ERRORS.youtube],
    [`https://music.youtube.com/watch?v=${V}`, LINK_ERRORS.other],
    ['https://www.twitch.tv/', LINK_ERRORS.twitch],
    ['https://www.twitch.tv/ab', LINK_ERRORS.twitch],
    [`https://www.twitch.tv/${'a'.repeat(26)}`, LINK_ERRORS.twitch],
    ['https://www.twitch.tv/pixel-harbor', LINK_ERRORS.twitch],
    ['https://www.twitch.tv/directory', LINK_ERRORS.twitch],
    ['https://www.twitch.tv/abc/videos', LINK_ERRORS.twitch],
    [`https://youtu.be/${V}?x=${'a'.repeat(MAX_LINK_LENGTH)}`, LINK_ERRORS.long],
  ];
  it.each(refuse)('refuses %s', (link, error) => {
    expect(parseLink(link)).toEqual({ ok: false, error });
  });

  it('refuses what is not text', () => {
    expect(parseLink(undefined).ok).toBe(false);
    expect(parseLink(42).ok).toBe(false);
  });
});

describe('Twitch site routes', () => {
  const routes = ['activate', 'bits', 'broadcast', 'checkout', 'collections', 'dashboard', 'directory', 'downloads', 'drops', 'following', 'friends', 'inventory', 'jobs', 'login', 'logout', 'messages', 'moderator', 'payments', 'popout', 'prime', 'products', 'redeem', 'search', 'settings', 'signup', 'store', 'subscriptions', 'team', 'turbo', 'videos', 'wallet'];
  it.each(routes)('refuses twitch.tv/%s as a channel', (r) => {
    expect(parseLink(`https://www.twitch.tv/${r}`)).toEqual({ ok: false, error: LINK_ERRORS.twitch });
    expect(parseLink(`twitch.tv/${r.toUpperCase()}/`)).toEqual({ ok: false, error: LINK_ERRORS.twitch });
  });
  it('still accepts a channel whose name only starts like a route', () => {
    expect(parseLink('https://www.twitch.tv/activate_now')).toEqual({ ok: true, ref: { kind: 'twitch', id: 'activate_now' } });
  });
});

describe('the frame address', () => {
  const where = { origin: 'https://tauri.localhost', hostname: 'tauri.localhost' };
  it('builds YouTube on the no-cookie embed host with the page origin', () => {
    expect(embedUrl({ kind: 'video', id: V }, where)).toBe(
      `https://www.youtube-nocookie.com/embed/${V}?autoplay=1&controls=0&disablekb=1&fs=0&iv_load_policy=3&playsinline=1&rel=0&enablejsapi=1&origin=https%3A%2F%2Ftauri.localhost`,
    );
    expect(embedUrl({ kind: 'live', id: V }, where)).toContain(`https://www.youtube-nocookie.com/embed/${V}?`);
    expect(embedUrl({ kind: 'playlist', id: PL }, where)).toBe(
      `https://www.youtube-nocookie.com/embed/videoseries?list=${PL}&autoplay=1&controls=0&disablekb=1&fs=0&iv_load_policy=3&playsinline=1&rel=0&enablejsapi=1&origin=https%3A%2F%2Ftauri.localhost`,
    );
  });
  it('builds Twitch on the player host with the page host name as parent', () => {
    expect(embedUrl({ kind: 'twitch', id: 'pixel_harbor' }, where)).toBe('https://player.twitch.tv/?channel=pixel_harbor&parent=tauri.localhost');
  });
  it('builds nothing from an unchecked or odd value', () => {
    for (const bad of [
      { kind: 'video', id: 'x' },
      { kind: 'video', id: '../../evil' },
      { kind: 'video', id: 'Ab3dEfGh1j&' },
      { kind: 'twitch', id: 'Abc' },
      { kind: 'twitch', id: 'a&parent=x' },
      { kind: 'url', id: 'https://evil.example' },
      { kind: 'playlist', id: `${PL}#` },
      null,
      'https://youtu.be/x',
    ]) {
      expect(embedUrl(bad, where)).toBeNull();
    }
    expect(embedUrl({ kind: 'video', id: V }, null)).toBeNull();
  });
  it('only ever points at the two player hosts, with every value escaped', () => {
    const hostile = { origin: 'https://a.example/?x=1&y="<', hostname: 'a.example' };
    const u = new URL(embedUrl({ kind: 'video', id: V }, hostile)!);
    expect(u.origin).toBe(YOUTUBE_EMBED_ORIGIN);
    expect(u.searchParams.get('origin')).toBe(hostile.origin);
    expect(u.searchParams.get('y')).toBeNull();
    expect(new URL(embedUrl({ kind: 'twitch', id: 'abc' }, where)!).origin).toBe(TWITCH_EMBED_ORIGIN);
  });
  it('reads the page origin only for http and https pages with a plain host name', () => {
    expect(pageWhere({ protocol: 'https:', origin: 'https://tauri.localhost', hostname: 'tauri.localhost' })).toEqual({ origin: 'https://tauri.localhost', hostname: 'tauri.localhost' });
    expect(pageWhere({ protocol: 'file:', origin: 'null', hostname: '' })).toBeNull();
    expect(pageWhere({ protocol: 'https:', origin: 'https://[::1]', hostname: '[::1]' })).toBeNull();
  });
  it('builds the YouTube command messages', () => {
    expect(JSON.parse(commandMessage('pauseVideo'))).toEqual({ event: 'command', func: 'pauseVideo', args: [] });
  });
});

describe('messages from a player', () => {
  it('trusts only the two exact origins', () => {
    expect(isPlayerOrigin(YOUTUBE_EMBED_ORIGIN)).toBe(true);
    expect(isPlayerOrigin(TWITCH_EMBED_ORIGIN)).toBe(true);
    for (const o of ['https://www.youtube.com', 'http://www.youtube-nocookie.com', 'https://www.youtube-nocookie.com.evil.example', 'https://player.twitch.tv:444', 'null', '', undefined]) {
      expect(isPlayerOrigin(o)).toBe(false);
    }
  });
  it('reads only the play state, only from the YouTube embed', () => {
    const msg = (o: unknown) => JSON.stringify(o);
    expect(readPlayState(YOUTUBE_EMBED_ORIGIN, msg({ event: 'onStateChange', info: 1 }))).toBe('playing');
    expect(readPlayState(YOUTUBE_EMBED_ORIGIN, msg({ event: 'onStateChange', info: 2 }))).toBe('paused');
    expect(readPlayState(YOUTUBE_EMBED_ORIGIN, msg({ event: 'infoDelivery', info: { playerState: 0 } }))).toBe('ended');
    expect(readPlayState('https://evil.example', msg({ event: 'onStateChange', info: 1 }))).toBeNull();
    expect(readPlayState(TWITCH_EMBED_ORIGIN, msg({ event: 'onStateChange', info: 1 }))).toBeNull();
    expect(readPlayState(YOUTUBE_EMBED_ORIGIN, { event: 'onStateChange', info: 1 })).toBeNull();
    expect(readPlayState(YOUTUBE_EMBED_ORIGIN, 'not json')).toBeNull();
    expect(readPlayState(YOUTUBE_EMBED_ORIGIN, msg({ event: 'onStateChange', info: 'https://evil.example' }))).toBeNull();
    expect(readPlayState(YOUTUBE_EMBED_ORIGIN, 'x'.repeat(20_001))).toBeNull();
  });
});

describe('saved items', () => {
  const ok = { kind: 'video', id: V, label: 'Night drive' };
  it('keeps only well formed entries, cleans labels, drops repeats, at most 24', () => {
    const raw = JSON.stringify([
      ok,
      { kind: 'video', id: V, label: 'again' },
      { kind: 'video', id: 'https://evil.example', label: 'x' },
      { kind: 'url', id: V },
      { kind: 'twitch', id: 'Upper', label: 'x' },
      { kind: 'twitch', id: 'abc', label: '  two\nlines\u2028here  ' },
      { kind: 'playlist', id: PL, label: 7 },
      null,
      'text',
      ...Array.from({ length: 40 }, (_, i) => ({ kind: 'twitch', id: `chan_${i}`, label: 'c' })),
    ]);
    const items = parseSaved(raw);
    expect(items.length).toBe(MAX_SAVED);
    expect(items[0]).toEqual(ok);
    expect(items[1]).toEqual({ kind: 'twitch', id: 'abc', label: 'two lines here' });
    expect(items[2]).toEqual({ kind: 'playlist', id: PL, label: 'YouTube playlist' });
  });
  it('reads nothing from broken or oversized storage', () => {
    for (const raw of [null, '', 'not json', '{"kind":"video"}', '42', 'x'.repeat(40_000)]) expect(parseSaved(raw)).toEqual([]);
  });
  it('drops bidi overrides, isolates and zero-width characters from a label', () => {
    const ref = { kind: 'video' as const, id: V };
    const hostile = ['Nig', '\u202e', 'ht', '\u2066', ' drive', '\u2069', '\u200b', '\u200d', '\u202a', ' mix', '\ufeff', '\u2060', '\u200f'].join('');
    expect(cleanLabel(hostile, ref)).toBe('Night drive mix');
    expect(cleanLabel('\u202e\u200b', ref)).toBe('YouTube video');
    expect(cleanLabel('a\u0085b', ref)).toBe('a b');
  });
  it('bounds a label to 60 characters on one line', () => {
    expect(cleanLabel('a'.repeat(100), { kind: 'video', id: V }).length).toBe(60);
    expect(cleanLabel('', { kind: 'twitch', id: 'abc' })).toBe('abc on Twitch');
    expect(defaultLabel({ kind: 'live', id: V })).toBe('YouTube live stream');
  });
  it('adds at the top, refuses repeats and a full list, renames and removes', () => {
    const one = addSaved([], { kind: 'video', id: V });
    expect(one.ok && one.items).toEqual([{ kind: 'video', id: V, label: 'YouTube video' }]);
    const items = one.ok ? one.items : [];
    expect(addSaved(items, { kind: 'video', id: V })).toEqual({ ok: false, error: ADD_ERRORS.dup });
    const full = Array.from({ length: MAX_SAVED }, (_, i) => ({ kind: 'twitch' as const, id: `chan_${i}`, label: 'c' }));
    expect(addSaved(full, { kind: 'video', id: V })).toEqual({ ok: false, error: ADD_ERRORS.full });
    expect(renameSaved(items, `video:${V}`, '  Rain  ')[0].label).toBe('Rain');
    expect(removeSaved(items, `video:${V}`)).toEqual([]);
  });
  it('checks a kind and id pair', () => {
    expect(validRef({ kind: 'video', id: V })).toBe(true);
    expect(validRef({ kind: 'video', id: V.toLowerCase() + 'x' })).toBe(false);
    expect(validRef({ kind: 'twitch' })).toBe(false);
  });
});

describe('looks', () => {
  it('reads stored settings field by field', () => {
    expect(parseLooks(null)).toEqual(DEFAULT_LOOKS);
    expect(parseLooks('nope')).toEqual(DEFAULT_LOOKS);
    expect(parseLooks(JSON.stringify({ mode: 'kind', all: 'feather', video: 'whole', twitch: 'feather' }))).toEqual({
      mode: 'kind',
      all: 'feather',
      video: DEFAULT_LOOKS.video,
      live: DEFAULT_LOOKS.live,
      twitch: 'feather',
    });
    expect(parseLooks(JSON.stringify({ mode: 'other' })).mode).toBe('one');
  });
  it('picks the look per kind and steps through every look', () => {
    const kind = { ...DEFAULT_LOOKS, mode: 'kind' as const };
    expect(lookFor(kind, 'playlist')).toBe(kind.video);
    expect(lookFor(kind, 'twitch')).toBe(kind.twitch);
    expect(lookFor(DEFAULT_LOOKS, 'twitch')).toBe(DEFAULT_LOOKS.all);
    expect(nextLook(LOOKS[LOOKS.length - 1].id)).toBe(LOOKS[0].id);
    expect(stepLook(DEFAULT_LOOKS, 'video').all).toBe(nextLook(DEFAULT_LOOKS.all));
    const stepped = stepLook(kind, 'live');
    expect(stepped.live).toBe(nextLook(kind.live));
    expect(stepped.video).toBe(kind.video);
  });
});

describe('stop rules', () => {
  const base: StopInputs = { place: 'unwind', tab: 'watch', visible: true, displayDark: false, screensOff: false, inCall: false };
  it('lets a video play only on Watch on Unwind, shown, display on, screens on, no call', () => {
    expect(stopReason(base)).toBeNull();
    expect(stopReason({ ...base, place: 'zen' })).toBe('place');
    expect(stopReason({ ...base, place: 'work' })).toBe('place');
    expect(stopReason({ ...base, tab: 'listen' })).toBe('tab');
    expect(stopReason({ ...base, visible: false })).toBe('hidden');
    expect(stopReason({ ...base, displayDark: true })).toBe('display');
    expect(stopReason({ ...base, screensOff: true })).toBe('screens-off');
    expect(stopReason({ ...base, inCall: true })).toBe('call');
  });

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(SAVED_KEY, JSON.stringify([{ kind: 'video', id: V, label: 'Night drive' }]));
    resetWatch();
    usePlaceStore.setState({ active: 'unwind' });
  });
  it('removes the frame when Zen opens or another place does, and never restarts it', () => {
    const st = useWatchStore.getState();
    st.play({ kind: 'video', id: V });
    expect(useWatchStore.getState().playing?.label).toBe('Night drive');
    usePlaceStore.getState().setActive('zen');
    expect(useWatchStore.getState().playing).toBeNull();
    usePlaceStore.setState({ active: 'unwind' });
    expect(useWatchStore.getState().playing).toBeNull();
    st.play({ kind: 'video', id: V });
    usePlaceStore.getState().setActive('work');
    expect(useWatchStore.getState().playing).toBeNull();
  });
  it('removes the frame when the tab goes back to Listen', () => {
    useWatchStore.getState().play({ kind: 'video', id: V });
    expect(useWatchStore.getState().tab).toBe('watch');
    useWatchStore.getState().setTab('listen');
    expect(useWatchStore.getState().playing).toBeNull();
    useWatchStore.getState().setTab('watch');
    expect(useWatchStore.getState().playing).toBeNull();
  });
  it('plays only what is saved, and removing the item stops it', () => {
    useWatchStore.getState().play({ kind: 'video', id: 'Zz3dEfGh1jK' });
    expect(useWatchStore.getState().playing).toBeNull();
    useWatchStore.getState().play({ kind: 'video', id: V });
    useWatchStore.getState().remove(`video:${V}`);
    expect(useWatchStore.getState().playing).toBeNull();
  });
  it('adds a pasted link to the list and storage, or says why not', () => {
    expect(useWatchStore.getState().addLink('https://www.twitch.tv/pixel_harbor')).toBeNull();
    expect(useWatchStore.getState().saved[0]).toEqual({ kind: 'twitch', id: 'pixel_harbor', label: 'pixel_harbor on Twitch' });
    expect(useWatchStore.getState().editing).toBe('twitch:pixel_harbor');
    expect(parseSaved(localStorage.getItem(SAVED_KEY)).length).toBe(2);
    expect(useWatchStore.getState().addLink('https://evil.example')).toBe(LINK_ERRORS.other);
    expect(useWatchStore.getState().addLink(`youtu.be/${V}`)).toBe(ADD_ERRORS.dup);
  });
});
