import type { LiveChannel, LiveChat, LiveMessage, LiveStatus } from '../../onair/ytlive';
import { reviewNow } from '../../ui/reviewClock';
import { mocks } from '../tauri';
import { knob } from './long';

/**
 * Dev only: the YouTube live commands, for `npm run dev` in a plain browser and the gallery. Every name, channel and comment here
 * is invented.
 *
 *   ?yt=none|scheduled|live|stale|quota|busy|empty|signedout|notsetup|refused     (default `none`)
 *     none        the channel is named, no broadcast
 *     scheduled   a broadcast starts in 36 minutes
 *     live        live, 37 watching, twelve comments
 *     stale       live, but YouTube has not answered for 14 minutes
 *     quota       live, today's chat reads are used up
 *     busy        live, long comments and a Super Chat
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

/** The native side stamps `readAt` and `stoppedAt` in Unix seconds; the other times are milliseconds. */
const sec = (ms: number): number => Math.floor(ms / 1000);

const now = (): number => (reviewNow ? reviewNow() : Date.now());

function messages(kind: string, at: number): LiveMessage[] {
  if (kind === 'empty') return [];
  if (kind === 'busy') {
    return LONG_TEXTS.map((text, i) => ({ id: `m${i}`, name: NAMES[i], text, at: at - (LONG_TEXTS.length - i) * 20_000, superChat: i === 1 ? '$5.00' : null }));
  }
  return TEXTS.map((text, i) => ({ id: `m${i}`, name: NAMES[i], text, at: at - (TEXTS.length - i) * 15_000, superChat: i === 5 ? '$2.00' : null }));
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
