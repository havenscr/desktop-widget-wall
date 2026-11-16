import { mocks } from '../tauri';
import type { YtDetail, YtPage, YtPlayable, YtPlaylist, YtVideo } from '../../music/youtube';
import { FIVE_LINE, playFrom, setNote } from '../../unwind/ytmusic/queue';
import { useWatchStore } from '../../unwind/watch/store';

/**
 * `youtube=` picks what the YouTube row in Tools shows (a development knob only):
 * `off` (default, not set up), `out` (signed out), `waiting` (signed out, and Sign in never
 * finishes), `in` (signed in), `again` (the saved sign-in died), `broken` (signed in, Google
 * refused the client), `brokenout` (signed out, Google refused the client), `down` (the status
 * cannot be read), `refuse` (signed out, and Sign in is refused), `rejectsave` (not set up, and
 * Save is refused), `missing` (signed in, but the saved setup is gone), `unreadable` (signed out, the
 * saved setup cannot be read) and `reloaded` (a sign-in is waiting that the page did not start).
 *
 * `ytlib=` (with `youtube=in`) picks what the library shows: `full` (default: twelve playlists, 30 liked
 * videos, a playlist of 41 with one row of each greyed kind), `few` (two playlists, three liked), `empty`,
 * `slow` (never answers), `down`, `busy`, `again` (sign in again), `gone` (the playlist read answers
 * not found), `low` (12 searches left), `spent` (none left), `long` (very long names, a list of 2000).
 * `ytscroll=<px>` scrolls every list of rows to that many pixels once it has more rows than it shows (a still of the menu on a
 * row near the foot of the list). Names are invented; pictures are drawn motifs, never an address.
 * `ytdetails=` picks own-playlist details: `ok` (default), `none`, `down` or `slow`.
 *
 * `ytplay=` (with `youtube=in` and the mock frame, `watch=mock`: it never loads a real player, and without it nothing
 * is played) starts a pick on the wall about 700 ms after the page is up, as a click on a row would, and sets what the
 * player would have reported: `on` (Night Drive from its first row, 1:06 of 3:34), `paused`, `refused` (autoplay was not
 * allowed: the line and "Start it on Watch"), `skipped` (the first video fails with code 101: the note line, its row
 * greyed, the next one plays a second later), `five` (stopped after five videos in a row would not play), `ended` (the
 * last entry of the list has ended), `watch` (a Watch video plays: the foot shows it), `liked` (a Liked row plays)
 * and `search` (a row of the search answer for `ytsearch=night` plays). Add `wtab=listen` to stay on Listen.
 */
const PALETTES = [['#1b1440', '#ff5c96', '#ffb054', '#35e6ea'], ['#10243a', '#7dd3c7', '#f5cf77', '#f2b8c6'], ['#241038', '#9a7bff', '#ff3d9a', '#ffd9a0'], ['#0e2030', '#5cc4ff', '#d8f1ff', '#7df0c2'], ['#2a1430', '#ff7a6b', '#ffc24d', '#5df2b6'], ['#141a3c', '#92a8d1', '#f2b8c6', '#f5cf77']];
/** A drawn 16:9 motif (six shapes, six palettes) as a data address: stands in for a picture from YouTube. */
function motif(seed: number): string {
  const [bg, a, b, c] = PALETTES[seed % PALETTES.length];
  const w = 160;
  const h = 90;
  const m = (seed * 7 + 3) % 6;
  let g = '';
  if (m === 0) g = `<circle cx="80" cy="41" r="23" fill="${b}"/><path d="M0 72 L58 38 L99 63 L128 47 L160 68 V90 H0Z" fill="${a}"/>`;
  if (m === 1) g = [0, 1, 2, 3].map((k) => `<rect x="0" y="${27 + k * 15}" width="${w}" height="8" fill="${[a, b, c, a][k]}" opacity="${0.95 - k * 0.15}"/>`).join('') + `<circle cx="115" cy="22" r="11" fill="${c}"/>`;
  if (m === 2) g = [38, 27, 16].map((r, k) => `<circle cx="80" cy="45" r="${r}" fill="${[a, bg, b][k]}"/>`).join('') + `<circle cx="80" cy="45" r="4" fill="${c}"/>`;
  if (m === 3) g = `<path d="M0 90 L112 0 H160 L48 90Z" fill="${a}"/><path d="M67 90 L160 16 V45 L106 90Z" fill="${b}"/><circle cx="38" cy="25" r="12" fill="${c}"/>`;
  if (m === 4) g = `<rect x="0" y="56" width="${w}" height="34" fill="${a}" opacity=".9"/><path d="M80 56 m-25 0 a25 25 0 0 1 50 0Z" fill="${b}"/>` + [63, 70, 79].map((y) => `<rect x="0" y="${y}" width="${w}" height="1.5" fill="${bg}" opacity=".6"/>`).join('');
  if (m === 5) g = `<circle cx="109" cy="29" r="16" fill="${c}"/><path d="M0 59 Q40 45 80 59 T160 59 V90 H0Z" fill="${a}"/><path d="M0 72 Q40 59 80 72 T160 72 V90 H0Z" fill="${b}"/>`;
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="${bg}"/>${g}</svg>`)}`;
}

const LIST_NAMES: [string, number][] = [['Night Drive', 41], ['Rainy Window', 28], ['Slow Sunday', 36], ['Neon Coast', 64], ['Late Shift', 19], ['Morning Light', 45], ['Paper Lanterns', 52], ['Open Road', 73], ['Harbor Lights', 30], ['Quiet Hours', 22], ['Glass Harbor Mix', 17], ['Static Bloom Sessions', 58]];
const SONGS: [string, string][] = [['Glass Harbor', 'Mira Vale'], ['Low Tide Motel', 'Aurora Set'], ['Violet Hour', 'Juno Park'], ['Static Bloom', 'The Night Shift'], ['Afterglow Avenue', 'Mira Vale'], ['Cassette Rain', 'Aurora Set'], ['Northbound Lights', 'Juno Park'], ['Soft Circuit', 'The Night Shift'], ['Last Train West', 'Mira Vale'], ['Sleepwalk Radio', 'Aurora Set'], ['Paper Moon Café', 'Juno Park'], ['Slow Orbit', 'The Night Shift']];
const LONG_STEM = 'an extremely long name for late evenings when the lights are low and the rain keeps going and going';
const vid = (n: number) => `mock${String(n).padStart(7, '0')}`.slice(0, 11).padEnd(11, 'x');
const listId = (n: number) => `PLmocklist${String(n).padStart(3, '0')}`;

export function registerYoutubeMocks(): void {
  const mode = () => new URLSearchParams(window.location.search).get('youtube') ?? 'off';
  let setup = !['off', 'rejectsave', 'missing'].includes(mode());
  let signedIn = ['in', 'broken', 'missing'].includes(mode());
  let damaged = mode() === 'unreadable';
  let waitingNative = mode() === 'reloaded';
  const lib = () => new URLSearchParams(window.location.search).get('ytlib') ?? 'full';
  const long = () => lib() === 'long';
  let searched = 0;
  const left = () => (lib() === 'spent' ? 0 : Math.max(0, (lib() === 'low' ? 12 : 100) - searched));
  const video = (n: number, playable: YtPlayable = 'yes', stem = SONGS[n % SONGS.length]): YtVideo => ({
    id: vid(n),
    title: long() ? `${stem[0]}, ${LONG_STEM}` : stem[0],
    channel: long() ? `${stem[1]} and the Lantern Choir with the Quiet Geometry Orchestra, a very long channel name` : stem[1],
    seconds: playable === 'removed' || playable === 'private' ? 0 : n === 0 ? 214 : 150 + ((n * 37) % 240),
    thumb: motif(n),
    playable,
  });
  const failing = () => {
    const m = lib();
    if (m === 'down' || m === 'busy' || m === 'again') throw new Error(m === 'again' ? 'sign in again' : m);
  };
  const never = <T,>() => new Promise<T>(() => undefined);
  const paged = <T,>(all: T[], token: unknown): YtPage<T> => {
    const start = typeof token === 'string' ? Number(token.replace('p', '')) : 0;
    const end = Math.min(all.length, start + 50);
    return { items: all.slice(start, end), next: end < all.length ? `p${end}` : null };
  };
  const playlists = (): YtPlaylist[] => {
    const m = lib();
    if (m === 'empty') return [];
    const names = m === 'few' ? LIST_NAMES.slice(0, 2) : LIST_NAMES;
    return names.map(([title, count], i) => ({ id: listId(i), title: long() ? `${title}, ${LONG_STEM}` : title, count: long() ? 2000 : count, thumb: motif(i) }));
  };
  const GREY: Record<number, YtPlayable> = { 4: 'embed', 11: 'region', 19: 'private', 27: 'removed' };
  mocks.set('wall2_youtube_playlists', (args) => {
    failing();
    if (lib() === 'slow') return never();
    return paged(playlists(), args?.pageToken);
  });
  mocks.set('wall2_youtube_items', (args) => {
    failing();
    if (lib() === 'slow') return never();
    if (lib() === 'gone') throw new Error('not found');
    if (lib() === 'empty') return { items: [], next: null };
    const list = playlists().find((p) => p.id === args?.playlistId);
    const n = list?.count ?? 41;
    const all = Array.from({ length: n }, (_, i) => video(i, n >= 30 && !long() ? GREY[i] ?? 'yes' : 'yes'));
    return paged(all, args?.pageToken);
  });
  mocks.set('wall2_youtube_liked', (args) => {
    failing();
    if (lib() === 'slow') return never();
    const m = lib();
    const n = m === 'empty' ? 0 : m === 'few' ? 3 : 30;
    return paged(Array.from({ length: n }, (_, i) => video(100 + i, i === 6 ? 'embed' : 'yes', SONGS[(i + 5) % SONGS.length])), args?.pageToken);
  });
  mocks.set('wall2_youtube_search', (args) => {
    failing();
    if (lib() === 'slow') return never();
    if (left() <= 0) throw new Error('quota');
    searched += 1;
    const words = String(args?.query ?? '').trim().toLowerCase();
    if (words === 'nothing') return { items: [], next: null };
    return { items: Array.from({ length: 12 }, (_, i) => video(200 + i, 'yes', SONGS[i % SONGS.length])), next: null };
  });
  mocks.set('wall2_youtube_videos', (args) => {
    if (!signedIn) throw new Error('sign in again');
    const detailMode = new URLSearchParams(window.location.search).get('ytdetails') ?? 'ok';
    if (detailMode === 'slow') return never<YtDetail[]>();
    if (detailMode === 'down') throw new Error('down');
    if (detailMode === 'none') return [];
    const ids = Array.isArray(args?.ids) ? args.ids.filter((id): id is string => typeof id === 'string') : [];
    return ids.map((id) => {
      const hash = Array.from(id).reduce((sum, char) => (sum * 33 + char.charCodeAt(0)) >>> 0, 0);
      const song = SONGS[hash % SONGS.length];
      return { id, title: song[0], channel: song[1], seconds: 150 + (hash % 240) } satisfies YtDetail;
    });
  });
  mocks.set('wall2_youtube_status', () => {
    if (mode() === 'down') throw new Error('failed');
    const reason = mode() === 'missing' && !setup && signedIn ? 'setup missing' : !setup ? 'not set up' : waitingNative ? 'signing in' : damaged ? 'setup unreadable' : mode() === 'again' && !signedIn ? 'sign in again' : mode().startsWith('broken') ? 'setup broken' : null;
    return { setup, signedIn, reason, searchesLeft: signedIn ? left() : null };
  });
  mocks.set('wall2_youtube_set_client', () => {
    if (mode() === 'rejectsave') throw new Error('invalid');
    setup = true;
    damaged = false;
  });
  mocks.set('wall2_youtube_forget_client', () => {
    setup = false;
    damaged = false;
  });
  mocks.set('wall2_youtube_sign_in', () => {
    if (mode() === 'waiting') return new Promise<void>(() => undefined);
    if (mode() === 'refuse') throw new Error('denied');
    signedIn = true;
  });
  mocks.set('wall2_youtube_cancel_sign_in', () => {
    waitingNative = false;
  });
  mocks.set('wall2_youtube_sign_out', () => { signedIn = false; });
  const scrolled = Number(new URLSearchParams(window.location.search).get('ytscroll'));
  if (scrolled > 0) {
    const seen = new WeakSet<Element>();
    new MutationObserver(() => {
      for (const el of document.querySelectorAll('.yt-rowscroll')) {
        if (seen.has(el) || !el.querySelector('.yt-row') || el.scrollHeight - el.clientHeight < scrolled) continue;
        seen.add(el);
        // The scroll event of this one move reaches no listener (a menu opened on a row at once would close on it).
        el.addEventListener('scroll', (e) => e.stopImmediatePropagation(), { once: true, capture: true });
        el.scrollTop = scrolled;
      }
    }).observe(document.documentElement, { childList: true, subtree: true });
  }
  const play = new URLSearchParams(window.location.search).get('ytplay');
  if (play && new URLSearchParams(window.location.search).get('watch') === 'mock') setTimeout(() => startPlayMock(play), 700);

  /** What `ytplay=` does: the same calls a click makes, then the reports the player would send. */
  function startPlayMock(what: string): void {
    const night = Array.from({ length: 41 }, (_, i) => video(i, GREY[i] ?? 'yes'));
    const songs = { list: 'songs', playlistId: listId(0) } as const;
    const report = (v: YtVideo, time: number) => useWatchStore.getState().setReport({ started: true, time, duration: v.seconds || 214, title: v.title, channel: v.channel });
    if (what === 'watch') {
      const st = useWatchStore.getState();
      const item = st.saved[0];
      if (!item) return;
      st.play(item);
      st.setTab('listen');
      st.setReport({ started: true, time: 754, duration: 2710, title: item.label, channel: 'Night Garden Radio' });
      return;
    }
    if (what === 'liked') {
      const liked = Array.from({ length: 30 }, (_, i) => video(100 + i, i === 6 ? 'embed' : 'yes', SONGS[(i + 5) % SONGS.length]));
      playFrom(liked, 2, { list: 'liked' });
      report(liked[2]!, 66);
      return;
    }
    if (what === 'search') {
      const found = Array.from({ length: 12 }, (_, i) => video(200 + i, 'yes', SONGS[i % SONGS.length]));
      playFrom(found, 1, { list: 'found', query: 'night' });
      report(found[1]!, 66);
      return;
    }
    if (what === 'ended') {
      playFrom(night, 40, songs);
      report(night[40]!, night[40]!.seconds);
      useWatchStore.getState().setReport({ ended: true });
      useWatchStore.getState().setPaused(true);
      return;
    }
    playFrom(night, 0, songs);
    if (what === 'refused') {
      useWatchStore.getState().setNeedsClick(true);
      return;
    }
    report(night[0]!, 66);
    if (what === 'paused') useWatchStore.getState().setPaused(true);
    if (what === 'skipped') setTimeout(() => useWatchStore.getState().setReport({ error: 101 }), 60);
    if (what === 'five') {
      useWatchStore.getState().stop();
      setNote(FIVE_LINE);
    }
  }
}
