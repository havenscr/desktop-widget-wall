// Watt's menu while a calendar meeting is in progress: the meeting has a join link, and the menu still
// works (every trick and Where item on, no refusal line). The unit tests hold the rule for a plain block
// and for a known call; this state holds the drawn menu.
const TYPICAL = encodeURIComponent('2026-11-11T10:24:00-08:00');

export default {
  name: 'watt-menu-meeting',
  gallery: {
    states: [{
      screen: 'work',
      name: 'Watt: menu open during a calendar meeting, nothing refused',
      query: `hz=work&at=${TYPICAL}&clock=review&weather=ok`,
      custom: true,
      actions: 'ctx:.watt-hit',
      expect: 'Come here',
    }],
  },
};
