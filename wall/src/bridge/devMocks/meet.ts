import { knob, longOr } from './long';
import { reviewNow } from '../../ui/reviewClock';
import { mocks } from '../tauri';

/** Meet: two accounts and a few meetings around now. Sign-in just flips the state. */
export function registerMeetMocks(): void {
  let second = false;
  mocks.set('wall2_meet_open_status', () => 'desktop');
  // Minutes from now (the review's moment in a review still, `?hz=&at=`).
  const at = (mins: number) => {
    const now = reviewNow ? reviewNow() : Date.now();
    return new Date(Math.round((now + mins * 60_000) / 60_000) * 60_000).toISOString().replace('.000Z', 'Z');
  };
  // `?meet=down`: neither account can be read. `?meet=mixed`: Work reads, Second does not answer.
  // `?meet=none`: both read, nothing scheduled. `?meet=busy`: five meetings at once at 1 PM.
  const mode = () => knob('meet') ?? '';
  const accounts = () =>
    mode() === 'signin-fault'
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
  mocks.set('wall2_meet_next', () => ({
    accounts: accounts(),
    meetings: mode() === 'down' || mode() === 'none' ? [] : [
      { key: '1-0', accountId: 'work', title: longOr('Design review with the platform team', 'Quarterly planning and roadmap review with the whole platform team'), start: at(-10), end: at(20), canJoin: true },
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
      events: mode() === 'down' || mode() === 'none' ? [] : [
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
    await new Promise((r) => setTimeout(r, mode() === 'signin-fault' ? 100 : 1500));
    if (mode() === 'signin-fault') throw new Error('token-network-dns');
    second = true;
  });
  mocks.set('wall2_meet_cancel_sign_in', () => undefined);
  mocks.set('wall2_meet_sign_out', () => {
    second = false;
  });
  mocks.set('wall2_meet_join', () => undefined);
}
