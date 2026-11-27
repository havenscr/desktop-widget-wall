// Labels in full: the long song or video title, the long Watch list names, the Next up title and the
// timeline chip names, each shown whole. Gallery states only; the look is judged from the stills.

const WATCH = 'hz=unwind&at=2026-11-11T22%3A30%3A00-08%3A00&clock=review&weather=ok&watch=mock&wlook=sky';

export default {
  name: 'labels-full',
  gallery: {
    states: [
      {
        screen: 'unwind',
        name: 'labels in full: Watch, the long title and the long list names',
        query: `${WATCH}&wlist=three&wpins=long&wplay=0`,
        custom: true,
        expect: ['Night drive mix for the long way home'],
      },
      {
        screen: 'unwind',
        name: 'labels in full: Watch, the long title at rest',
        query: `${WATCH}&wlist=three&wpins=long&wplay=0&wctl=rest`,
        custom: true,
        expect: ['Night drive mix for the long way home'],
      },
      {
        screen: 'unwind',
        name: 'labels in full: Listen, the long song title',
        query: 'hz=unwind&at=2026-11-11T10%3A24%3A00-08%3A00&clock=review&weather=ok&media=long',
        custom: true,
        expect: ['An Extremely Long Song Title'],
      },
    ],
  },
};
