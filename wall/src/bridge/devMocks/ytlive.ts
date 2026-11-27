import type { LiveChannel, LiveChat, LiveMessage, LiveStatus } from '../../onair/ytlive';
import { reviewNow } from '../../ui/reviewClock';
import { mocks } from '../tauri';
import { knob } from './long';

/**
 * Dev only: the YouTube live commands, for `npm run dev` in a plain browser and the gallery. Every name, channel and comment here
 * is invented.
 *
 *   ?yt=none|scheduled|live|stale|quota|busy|tall|empty|signedout|notsetup|refused     (default `none`)
 *     none        the channel is named, no broadcast
 *     scheduled   a broadcast starts in 36 minutes
 *     live        live, 37 watching, twelve comments
 *     stale       live, but YouTube has not answered for 14 minutes
 *     quota       live, today's chat reads are used up
 *     busy        live, long comments and a Super Chat
     tall        live, the newest comment is taller than the list
 *     empty       live, no comments yet
 *     signedout   no YouTube sign-in
 *     notsetup    no channel named
 *     refused     live, YouTube would not let the wall read the chat
 */
const MIN = 60_000;
const SAMPLE_CHANNEL = 'Sample Studio';

const NAMES = ['Rowan', 'Ada K.', 'Mirko', 'Tess', 'Juno', 'Bo', 'Priya', 'Lars', 'Ines', 'Kai', 'Noor', 'Theo'];
const TEXTS = [
  'Hello from the back row',
  'Can you show the filter again?',
  'That was quick',
  'Sound is good here',
  'Which version is this?',
  'Thanks for the walkthrough',
  'Love the layout',
  'Question about the second step',
  'Is there a recording?',
  'Could you zoom in a little?',
  'Great pace today',
  'Waving from another time zone',
];

const LONG_TEXTS = [
  'Could you walk through the whole setup again from the empty workspace to the finished report, naming every setting on the way and why it matters for the people who watch later?',
  'Short one',
  'I have a question about how the second step handles a column that arrives as text instead of a date, and what the fallback does when the first row is empty',
  'Thanks',
];

/** Inline pictures, so no test or gallery needs the network. */
const PALETTE = ['#e07a5f', '#3d85c6', '#81b29a', '#f2cc8f', '#9a7fd1', '#4fb0c6'];
const face = (i: number): string => {
  const bg = PALETTE[i % PALETTE.length];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="${bg}"/><circle cx="32" cy="25" r="11" fill="#fff" fill-opacity=".85"/><path d="M10 64a22 22 0 0 1 44 0z" fill="#fff" fill-opacity=".85"/></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
};
/** A picture that cannot be decoded, to show the letter tile after a failed load. */
const BROKEN = 'data:image/png;base64,AAAA';
/** Row 2 has no picture and row 3 fails to load; the rest have one. */
const avatarFor = (i: number): string | null => (i === 2 ? null : i === 3 ? BROKEN : face(i));

/** The native side stamps `readAt` and `stoppedAt` in Unix seconds; the other times are milliseconds. */
const sec = (ms: number): number => Math.floor(ms / 1000);

const now = (): number => (reviewNow ? reviewNow() : Date.now());

function messages(kind: string, at: number): LiveMessage[] {
  if (kind === 'empty') return [];
  if (kind === 'longlink') {
    const rows = [
      { name: '@SampleViewerWithAVeryLongHandleName2026', text: 'https://www.example.com/r/sample/comments/abc123/a_very_long_unbroken_link_that_goes_on_and_on_and_on_with_no_spaces_at_all_for_a_while' },
      { name: '@ShortOne', text: 'Thanks' },
    ];
    return rows.map((r, i) => ({ id: `m${i}`, ...r, at: at - (rows.length - i) * 20_000, superChat: null, avatar: face(i) }));
  }
  if (kind === 'tall') {
    // The newest comment is taller than the list: the list scrolls and fades at the top.
    const long = 'This is a very long sample comment that keeps going so that it is taller than the whole comments list. '.repeat(9).trim();
    const rows = [
      { name: 'Rowan', text: 'Hello from the back row', superChat: null },
      { name: 'Tess', text: 'Sound is good here', superChat: null },
      { name: '@TallSampleViewer', text: long, superChat: '$10.00' },
    ];
    return rows.map((r, i) => ({ id: `m${i}`, ...r, at: at - (rows.length - i) * 20_000, avatar: face(i) }));
  }
  if (kind === 'busy') {
    return LONG_TEXTS.map((text, i) => ({ id: `m${i}`, name: NAMES[i], text, at: at - (LONG_TEXTS.length - i) * 20_000, superChat: i === 1 ? '$5.00' : null, avatar: avatarFor(i) }));
  }
  return TEXTS.map((text, i) => ({ id: `m${i}`, name: NAMES[i], text, at: at - (TEXTS.length - i) * 15_000, superChat: i === 5 ? '$2.00' : null, avatar: avatarFor(i) }));
}

export function registerYtLiveMocks(): void {
  // A channel named in this page (the Save in the card) counts as named from then on.
  let named = false;
  mocks.set('wall2_ytlive_channel', (): LiveChannel => {
    const k = knob('yt') ?? 'none';
    return !named && (k === 'notsetup' || k === 'signedout') ? { set: false, title: null } : { set: true, title: SAMPLE_CHANNEL };
  });
  mocks.set('wall2_ytlive_set_channel', async (args) => {
    const text = String(args?.text ?? '').trim();
    await new Promise((r) => setTimeout(r, knob('ytcheck') === '1' ? 60_000 : 250));
    if (!/^(@[\w.-]{3,30}|UC[\w-]{22}|(https?:\/\/)?(www\.)?youtube\.com\/(@[\w.-]+|channel\/UC[\w-]{22}))$/.test(text)) throw 'invalid';
    if (text.toLowerCase().includes('nobody')) throw 'not found';
    named = true;
    return { set: true, title: SAMPLE_CHANNEL } satisfies LiveChannel;
  });
  mocks.set('wall2_ytlive_forget_channel', () => null);
  mocks.set('wall2_ytlive_status', (): LiveStatus => {
    const k = knob('yt') ?? 'none';
    const t = now();
    const base: LiveStatus = { state: 'none', startedAt: null, scheduledAt: null, viewers: null, chat: false, readAt: sec(t - 4000), stale: false, word: null, statusLeft: 1100, chatLeft: 3900 };
    if (k === 'notsetup') return named ? base : { ...base, state: 'not-set-up' };
    if (k === 'signedout') return { ...base, state: 'signed-out' };
    if (k === 'scheduled') return { ...base, state: 'scheduled', scheduledAt: t + 36 * MIN };
    if (k === 'none') return base;
    const live: LiveStatus = { ...base, state: 'live', startedAt: t - 22 * MIN, viewers: 37, chat: k !== 'refused' };
    if (k === 'stale') return { ...live, readAt: sec(t - 14 * MIN), stale: true, word: 'busy' };
    return live;
  });
  mocks.set('wall2_ytlive_chat', (): LiveChat => {
    const k = knob('yt') ?? 'none';
    const t = now();
    const ok: LiveChat = { state: 'ok', messages: messages(k, t), readAt: sec(t - 4000), stale: false, stoppedAt: null, word: null };
    if (k === 'stale') return { ...ok, readAt: sec(t - 14 * MIN), stale: true };
    if (k === 'quota') return { ...ok, state: 'quota', stoppedAt: sec(t - 43 * MIN), word: 'quota' };
    if (k === 'refused') return { state: 'off', messages: [], readAt: null, stale: false, stoppedAt: null, word: 'refused' };
    return ok;
  });
}
