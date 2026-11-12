import { mocks } from '../tauri';

/** Meet: two accounts and a few meetings around now. Sign-in just flips the state. */
export function registerMeetMocks(): void {
  let second = false;
  const at = (mins: number) => new Date(Math.round((Date.now() + mins * 60_000) / 60_000) * 60_000).toISOString().replace('.000Z', 'Z');
  const accounts = () => [
    { id: 'work', label: 'Work', state: 'ok' },
    { id: 'second', label: 'Second', state: second ? 'ok' : 'signed-out' },
  ];
  mocks.set('wall2_meet_next', () => ({
    accounts: accounts(),
    meetings: [
      { key: '1-0', accountId: 'work', title: 'Design review with the platform team', start: at(-10), end: at(20), canJoin: true },
      { key: '1-1', accountId: 'work', title: 'Weekly planning', start: at(48), end: at(78), canJoin: true },
      { key: '1-2', accountId: 'work', title: 'Lunch with Sam', start: at(150), end: at(210), canJoin: false },
      ...(second ? [{ key: '1-3', accountId: 'second', title: 'Board prep', start: at(320), end: at(380), canJoin: true }] : []),
    ],
  }));
  // The day feed: local midnight to 36 hours after it, past events included.
  mocks.set('wall2_meet_day', () => {
    const midnight = new Date();
    midnight.setHours(0, 0, 0, 0);
    const day = (hour: number, mins: number) => new Date(midnight.getTime() + (hour * 60 + mins) * 60_000).toISOString().replace('.000Z', 'Z');
    return {
      accounts: accounts(),
      events: [
        { key: 'd1-0', accountId: 'work', title: 'Standup', start: day(9, 0), end: day(9, 15), canJoin: true, isLive: false },
        { key: 'd1-1', accountId: 'work', title: 'Design review with the platform team', start: day(10, 30), end: day(11, 30), canJoin: true, isLive: false },
        { key: 'd1-2', accountId: 'work', title: 'Lunch with Sam', start: day(12, 0), end: day(13, 0), canJoin: false, isLive: false },
        { key: 'd1-3', accountId: 'work', title: 'Livestream: weekly build', start: day(15, 0), end: day(16, 0), canJoin: false, isLive: true },
        { key: 'd1-4', accountId: 'work', title: 'Weekly planning', start: day(17, 0), end: day(17, 30), canJoin: true, isLive: false },
        ...(second ? [{ key: 'd1-5', accountId: 'second', title: 'Board prep', start: day(19, 0), end: day(20, 0), canJoin: true, isLive: false }] : []),
        { key: 'd1-6', accountId: 'work', title: 'Planning check-in', start: day(24 + 9, 30), end: day(24 + 10, 0), canJoin: true, isLive: false },
      ],
    };
  });
  mocks.set('wall2_meet_sign_in', async () => {
    await new Promise((r) => setTimeout(r, 1500));
    second = true;
  });
  mocks.set('wall2_meet_cancel_sign_in', () => undefined);
  mocks.set('wall2_meet_sign_out', () => {
    second = false;
  });
  mocks.set('wall2_meet_join', () => undefined);
}
