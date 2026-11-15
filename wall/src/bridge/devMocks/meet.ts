import { knob, longOr } from './long';
import { reviewNow } from '../../ui/reviewClock';
import type { MeetingDetails, Person, Reply } from '../../meet/model';
import { mocks } from '../tauri';

const p = (name: string, reply: Reply): Person => ({ name, reply });

/** Invented people and invite words for the Meet layout's mock meetings. Nothing here is real. */
export const MOCK_DETAILS: Record<'known' | 'new' | 'heavy', MeetingDetails> = {
  known: {
    calledBy: 'Casey Rowe',
    people: [p('Casey Rowe', 'organizer'), p('Dana Whitfield', 'yes'), p('Eli Navarro', 'yes'), p('Robin Okafor', 'yes'), p('Tariq Lindgren', 'maybe'), p('Noor Haddad', 'none')],
    peopleMore: 0,
    invite: 'Walk through the three sizing options, then agree who owns each next step. Please read the one-page summary before we start.',
  },
  new: {
    calledBy: 'Jordan Vale',
    people: [p('Jordan Vale', 'organizer'), p('Sasha Brandt', 'yes'), p('Rene Okoye', 'none')],
    peopleMore: 0,
    invite:
      'Thanks for making time. We track late deliveries in spreadsheets today and want one view of them. Could you walk us through how you would start, and what you would need from us? A list of our depots and last month\u2019s report are attached.',
  },
  heavy: {
    calledBy: 'Parker Lund',
    people: [
      p('Parker Lund', 'organizer'),
      p('Mira Castellanos', 'yes'),
      p('Owen Dubois', 'yes'),
      p('Ines Falk', 'yes'),
      p('Kofi Mensah', 'yes'),
      p('Lena Ostrov', 'maybe'),
      p('Hugo Beltran', 'yes'),
      p('Yara Nasser', 'yes'),
      p('Felix Aaberg', 'maybe'),
      p('Sana Qureshi', 'none'),
      p('Tomas Reyes', 'no'),
      p('Ada Lindqvist', 'yes'),
    ],
    peopleMore: 2,
    invite: 'Onboarding delays first, then billing questions, then the renewal timeline and who owns each. Bring the access plan even if it is a draft.',
  },
};

/** Meet: two accounts and a few meetings around now. Sign-in just flips the state. */
export function registerMeetMocks(): void {
  let second = false;
  mocks.set('wall2_meet_open_status', () => 'desktop');
  // Minutes from now (the review's moment in a review still, `?hz=&at=`).
  const iso = (ms: number) => new Date(Math.round(ms / 60_000) * 60_000).toISOString().replace('.000Z', 'Z');
  const at = (mins: number) => {
    const now = reviewNow ? reviewNow() : Date.now();
    return new Date(Math.round((now + mins * 60_000) / 60_000) * 60_000).toISOString().replace('.000Z', 'Z');
  };
  // `?meet=down`: neither account can be read. `?meet=mixed`: Work reads, Second does not answer.
  // `?meet=none`: both read, nothing scheduled. `?meet=busy`: five meetings at once at 1 PM.
  const mode = () => knob('meet') ?? '';
  // `?meet=before|known|new|bare` (the Meet layout): `before` has the next meeting 20 minutes away, `known` and `new` a meeting
  // under way (40 minutes left) with details, `bare` a live meeting with no details, `?mtitle=long` gives the hero meeting a 206 character title. `heavy` is in gallery.ts, with details from here.
  const layout = () => ['before', 'known', 'new', 'bare'].includes(mode());
  const accounts = () =>
    layout()
      ? [
          { id: 'work', label: 'Work', state: 'ok' },
          { id: 'second', label: 'Second', state: 'ok' },
        ]
      : mode() === 'signin-fault'
      ? [
          { id: 'work', label: 'Work', state: 'ok' },
          { id: 'second', label: 'Second', state: 'signed-out' },
        ]
      : mode() === 'down'
      ? [
          { id: 'work', label: 'Work', state: 'unavailable', reason: 'graph-503-UnknownError' },
          { id: 'second', label: 'Second', state: 'signed-out' },
        ]
      : mode() === 'mixed'
        ? [
            { id: 'work', label: 'Work', state: 'ok' },
            { id: 'second', label: 'Second', state: 'unavailable', reason: 'graph-network' },
          ]
        : [
            { id: 'work', label: 'Work', state: 'ok' },
            { id: 'second', label: 'Second', state: second ? 'ok' : 'signed-out' },
          ];
  // The meetings of a layout state: the hero, then lunch 50 minutes after it ends, then two more. With `call=teams`, `call=zoom`, `call=browser`, `camera=1` and `rec=1`
  // (signals.ts) the call states show. `?leave=100` (before) or `?leave=60` (known, new) puts "Leave by" on lunch: the dev leave
  // signal's real start is 30 minutes after its own time.
  const layoutMeetings = () => {
    const m = mode();
    const hero =
      m === 'before'
        ? { key: '1-0', accountId: 'work', title: 'Design review with the platform team', start: at(20), end: at(80), canJoin: true, details: MOCK_DETAILS.known }
        : m === 'new'
          ? { key: '1-0', accountId: 'work', title: 'Intro call with a new client', start: at(-20), end: at(40), canJoin: true, details: MOCK_DETAILS.new }
          : m === 'bare'
            ? { key: '1-0', accountId: 'work', title: 'Catch-up call', start: at(-10), end: at(20), canJoin: true, details: null }
            : { key: '1-0', accountId: 'work', title: 'Design review with the platform team', start: at(-20), end: at(40), canJoin: true, details: MOCK_DETAILS.known };
    // `?mtitle=long`: a 206 character title, for the hero's three lines and its ellipsis.
    if (knob('mtitle') === 'long') hero.title = 'Annual planning offsite for the regional leads: budget, hiring, the product roadmap, customer commitments, risks we carry into next year, the support model and who owns each decision after we leave the room';
    const lunch = Date.parse(hero.end) + 50 * 60_000;
    return [
      hero,
      { key: '1-1', accountId: 'work', title: 'Lunch with Sam', start: iso(lunch), end: iso(lunch + 60 * 60_000), canJoin: false },
      { key: '1-2', accountId: 'work', title: 'Livestream: weekly build', start: iso(lunch + 180 * 60_000), end: iso(lunch + 240 * 60_000), canJoin: false },
      { key: '1-3', accountId: 'work', title: 'Weekly planning', start: iso(lunch + 300 * 60_000), end: iso(lunch + 330 * 60_000), canJoin: true },
    ];
  };
  mocks.set('wall2_meet_next', () => ({
    accounts: accounts(),
    meetings: layout() ? layoutMeetings() : mode() === 'down' || mode() === 'none' ? [] : [
      { key: '1-0', accountId: 'work', title: longOr('Design review with the platform team', 'Quarterly planning and roadmap review with the whole platform team'), start: at(-10), end: at(20), canJoin: true, details: MOCK_DETAILS.known },
      { key: '1-1', accountId: 'work', title: 'Weekly planning', start: at(48), end: at(78), canJoin: true },
      { key: '1-2', accountId: 'work', title: 'Lunch with Sam', start: at(150), end: at(210), canJoin: false },
      ...(second ? [{ key: '1-3', accountId: 'second', title: 'Board prep', start: at(320), end: at(380), canJoin: true }] : []),
    ],
  }));
  // The day feed: local midnight to the end of tomorrow, past events included.
  mocks.set('wall2_meet_day', () => {
    // A review still (`?hz=&at=`) gets its day on the review's date.
    const midnight = new Date(reviewNow ? reviewNow() : Date.now());
    midnight.setHours(0, 0, 0, 0);
    const day = (hour: number, mins: number) => new Date(midnight.getTime() + (hour * 60 + mins) * 60_000).toISOString().replace('.000Z', 'Z');
    return {
      accounts: accounts(),
      events: mode() === 'down' || mode() === 'none' ? [] : layout() ? layoutMeetings().map((e, i) => ({ key: `d1-L${i}`, accountId: e.accountId, title: e.title, start: e.start, end: e.end, canJoin: e.canJoin, canOpen: i < 2 || undefined, isLive: false })) : [
        { key: 'd1-0', accountId: 'work', title: 'Standup', start: day(9, 0), end: day(9, 15), canJoin: true, canOpen: true, isLive: false },
        { key: 'd1-1', accountId: 'work', title: 'Design review with the platform team', start: day(10, 30), end: day(11, 30), canJoin: true, canOpen: true, isLive: false },
        ...(mode() === 'overlap'
          ? []
          : [
              { key: 'd1-2', accountId: 'work', title: 'Lunch with Sam', start: day(12, 0), end: day(13, 0), canJoin: false, isLive: false },
              { key: 'd1-3', accountId: 'work', title: 'Livestream: weekly build', start: day(15, 0), end: day(16, 0), canJoin: false, isLive: true },
            ]),
        { key: 'd1-4', accountId: 'work', title: 'Weekly planning', start: day(17, 0), end: day(17, 30), canJoin: true, canOpen: true, isLive: false },
        ...(second ? [{ key: 'd1-5', accountId: 'second', title: 'Board prep', start: day(19, 0), end: day(20, 0), canJoin: true, isLive: false }] : []),
        // `?meet=busy`: five meetings at the same hour, for the "+N" chip.
        ...(mode() === 'busy'
          ? ['Vendor call', 'Budget review', 'Hiring sync', 'Roadmap chat', 'Office hours'].map((title, i) => ({
              key: `d1-b${i}`,
              accountId: i % 2 ? 'second' : 'work',
              title,
              start: day(13, i * 5),
              end: day(14, 0),
              canJoin: false,
              canOpen: true,
              isLive: false,
            }))
          : []),
        // `?meet=overlap`: three overlapping meetings around 1:30 and an all-day event.
        ...(mode() === 'overlap'
          ? [
              { key: 'd1-o0', accountId: 'work', title: 'Budget sync', start: day(12, 45), end: day(13, 45), canJoin: true, canOpen: true, isLive: false },
              { key: 'd1-o1', accountId: 'work', title: 'Design critique', start: day(13, 0), end: day(14, 0), canJoin: true, canOpen: true, isLive: false },
              { key: 'd1-o2', accountId: 'work', title: 'Vendor demo', start: day(13, 30), end: day(15, 30), canJoin: false, canOpen: true, isLive: false },
              { key: 'd1-o3', accountId: 'work', title: 'Team offsite week', start: day(0, 0), end: day(24, 0), canJoin: false, canOpen: true, isLive: false },
            ]
          : []),
        { key: 'd1-6', accountId: 'work', title: 'Planning check-in', start: day(24 + 9, 30), end: day(24 + 10, 0), canJoin: true, canOpen: true, isLive: false },
        { key: 'd1-7', accountId: 'work', title: 'Quarterly review', start: day(24 + 14, 0), end: day(24 + 15, 0), canJoin: true, canOpen: true, isLive: false },
      ],
    };
  });
  mocks.set('wall2_meet_sign_in', async () => {
    if (mode() === 'signin-fault') throw new Error('token-network-dns');
    await new Promise((r) => setTimeout(r, 1500));
    second = true;
  });
  mocks.set('wall2_meet_cancel_sign_in', () => undefined);
  mocks.set('wall2_meet_sign_out', () => {
    second = false;
  });
  mocks.set('wall2_meet_join', () => undefined);
  // `?checklist=none|four|long`: the first-meeting checklist file (missing, four items, eight long ones; refused is `?checklist=refused`).
  mocks.set('wall2_meet_checklist', () => {
    const k = knob('checklist') ?? 'none';
    if (k === 'four') return { state: 'ok', items: ['Who decides, and by when', 'What they measure today, and where it lives', 'Agree one next step before the hour ends', 'Send a recap within a day'], reason: null };
    if (k === 'long') {
      const long = 'Ask what happens when the numbers disagree between the two systems they use today, and who settles it';
      return { state: 'ok', items: Array.from({ length: 8 }, (_, i) => `${i + 1}. ${long}`.slice(0, 80)), reason: null };
    }
    if (k === 'refused') return { state: 'refused', items: [], reason: 'meet-checklist.txt is over 4 KB' };
    return { state: 'missing', items: [], reason: null };
  });
  mocks.set('wall2_meet_checklist_open', () => undefined);
}
