/**
 * Everything Watt can say, grouped by what it is about. Bundled text only: no model calls, no
 * network. The voice is a kind, dry, slightly odd little friend. Every line is short (under 60
 * characters), plain, and names no real person, product or private detail. `lines.test.ts`
 * holds the list to those rules.
 */
export type Topic =
  // Something just happened (wins over everything else while fresh).
  | 'focusStart'
  | 'focusHalf'
  | 'focusDone'
  | 'agentFinished'
  | 'agentWaiting'
  | 'meetingSoon'
  | 'meetingEnded'
  | 'musicPaused'
  | 'clover'
  | 'pet'
  | 'wake'
  // Being carried and set down (said by `Watt.tsx` on its own rules, never picked by the scheduler).
  | 'held'
  | 'landed'
  | 'dizzy'
  // What is true right now (context, picked over plain thoughts).
  | 'agentsWorking'
  | 'musicPlaying'
  | 'musicStreak'
  | 'rain'
  | 'snow'
  | 'clear'
  | 'cloudy'
  | 'fog'
  | 'cold'
  | 'hot'
  | 'morning'
  | 'midday'
  | 'afternoon'
  | 'evening'
  // Plain sheep thoughts, some shaded by her mood.
  | 'sheep'
  | 'happy'
  | 'sleepy'
  | 'curious';

export const LINES: Readonly<Record<Topic, readonly string[]>> = {
  held: ['Oh. We are up high.', 'The wall looks different from here.', 'My legs have opinions about this.', 'I am holding very still.', 'Excellent altitude, honestly.'],
  landed: ['Ground. Good ground.', 'Landed. Wool intact.', 'This spot will do.', 'A fine new view.', 'Back on four feet.'],
  dizzy: ['The horizon is spinning slightly.', 'Two walls. I see two walls.', 'Give me a moment. The sky is sloshing.', 'I am fine. The floor is not.'],
  focusStart: [
    'Reading along. Quietly.',
    'Focus mode. I will be quiet.',
    'You work, I read. Good system.',
    'Shh. Thinking happening.',
    'Settling in for a quiet stretch.',
  ],
  focusHalf: [
    'Half way. Still reading.',
    'Half done. Steady going.',
    'Middle of the session. Steady.',
    'Half way there. No rush.',
    'This is the long middle part.',
  ],
  focusDone: [
    'Done. That was a good one.',
    'Session over. I liked that one.',
    'Finished. Nicely done.',
    'Focus done. The horizon held.',
    'That counts. Well done.',
    'Done. I read a whole page.',
  ],
  agentFinished: [
    'One of the agents finished.',
    'An agent is done. I saw it.',
    'Something finished over there.',
    'One less thing running.',
    'An agent wrapped up. Tidy.',
  ],
  agentWaiting: [
    'Something is waiting for you.',
    'An agent has a question.',
    'Someone up there needs a yes or no.',
    'One thing for you. No hurry.',
    'There is a small ask on Work.',
  ],
  meetingSoon: [
    'A call soon. I will be quiet.',
    'Meeting coming up.',
    'A call in a few minutes.',
    'Call soon. I will sit still.',
    'Almost meeting time.',
  ],
  meetingEnded: [
    'That call is over.',
    'Meeting done. Back to the quiet.',
    'Quiet again after the call.',
    'Call finished. My turn to talk.',
    'Done talking. Good.',
  ],
  musicPaused: [
    'The music stopped.',
    'Quiet again. Also nice.',
    'Intermission.',
    'Song break. I will hum.',
  ],
  clover: [
    'Clover. My favourite.',
    'Found a clover. Do not tell anyone.',
    'Crunchy.',
    'Thank you. Very green.',
  ],
  pet: [
    'Hello.',
    'That was nice.',
    'Hi. I was just standing here.',
    'Oh. Hello again.',
    'I like you too.',
    'Wool is soft today.',
    'Happy sheep noises.',
    'That tickles.',
  ],
  wake: [
    'Morning. I slept well.',
    'Up. Mostly.',
    'Good morning. The sky is new.',
    'Awake. Stretching first.',
  ],
  agentsWorking: [
    'The agents are still at it. I supervise.',
    'The agents are busy. I am not.',
    'Work is happening up there.',
    'I keep an eye on the agents.',
    'Busy lanes today.',
    'They work, I graze. Fair.',
  ],
  musicPlaying: [
    'I like this song.',
    'Good beat for standing.',
    'Music makes the grass taste better.',
    'Tapping a hoof.',
    'Dancing, but inside.',
    'My ears are happy.',
    'The horizon is moving with it.',
    'Swaying a little.',
  ],
  musicStreak: [
    'Long listening session. Nice.',
    'We have been dancing a while.',
    'The music has been going for ages.',
    'Still playing. Still good.',
  ],
  rain: [
    'Rain. The window is all drops.',
    'Rain on the wool.',
    'Wet out there. Dry in here.',
    'The rain is doing its thing.',
    'Grey and wet. Cozy.',
    'Rain. The puddles are filling.',
  ],
  snow: [
    'Snow. I blend right in.',
    'It is snowing. I am a cloud now.',
    'Snow day energy.',
    'Cold and white out there.',
  ],
  clear: [
    'Clear sky. Very blue.',
    'Sunny out.',
    'Nice out today.',
    'The sun is being generous.',
    'Bright day. Good for wool.',
  ],
  cloudy: [
    'Clouds. My cousins.',
    'Grey sky. Cozy.',
    'Cloudy. Nothing to squint at.',
    'Soft light today.',
  ],
  fog: [
    'Foggy. Where did the hills go?',
    'The fog ate the horizon.',
    'Misty out there.',
  ],
  cold: [
    'Cold today. Good thing I am wool.',
    'Brisk. Good wool weather.',
    'Chilly out. Warm in here.',
    'Cold out. I am fluffing up.',
    'My nose is cold.',
  ],
  hot: [
    'Warm out. Too much wool.',
    'Hot day. I am staying in the shade.',
    'Very warm. I am mostly fluff.',
    'Hot one. I am moving slowly.',
  ],
  morning: [
    'Morning. Fresh grass.',
    'Early. The light is soft.',
    'Good morning, desk.',
    'New day. Clean slate.',
    'The morning sky is pale.',
    'I like the early quiet.',
  ],
  midday: [
    'Middle of the day already.',
    'Half the day done.',
    'The sun is high.',
    'Short shadows at noon.',
    'Midday. Very bright.',
  ],
  afternoon: [
    'Afternoon. Slow and steady.',
    'Afternoon light is the best light.',
    'The shadows are getting longer.',
    'A long afternoon. I like those.',
    'The sky is warming up in colour.',
    'Afternoon. I have walked a lot.',
  ],
  evening: [
    'Evening. The light is going.',
    'Evening. Everything is turning blue.',
    'Waiting for the moon.',
    'The sky is going purple.',
    'Evening. The hills look soft.',
    'Getting sleepy. Not yet.',
  ],
  sheep: [
    'I counted myself. One.',
    'Thinking about grass.',
    'Baa. Sorry. Reflex.',
    'I am a small cloud with legs.',
    'Standing is underrated.',
    'The horizon is very far.',
    'Hmm.',
    'Just checking in.',
    'I had a thought. It left.',
    'Wool update: still fluffy.',
    'Everything is fine here.',
    'I walked to the left. Then right.',
    'Nice pixels today.',
    'I am supervising the sky.',
    'I wonder what sheep dream about.',
    'Small steps. Literally.',
    'I like it here.',
    'One hoof at a time.',
    'Some days are for standing.',
    'I wonder what is past the hills.',
    'Quiet is good.',
    'I am here if you need me.',
    'The lake looks calm.',
    'I counted the stars once. Lots.',
    'Grazing on light.',
    'The grass is greener here. I checked.',
    'Practising standing still.',
    'All my pixels are present.',
    'The lake glows a little.',
    'A cloud went by. I waved.',
  ],
  happy: [
    'Good day so far.',
    'I feel springy.',
    'Today is nice.',
    'Content. Very content.',
  ],
  sleepy: [
    'Nap soon, maybe.',
    'Eyes are heavy.',
    'Yawn.',
    'Wool is getting heavy.',
  ],
  curious: [
    'Something caught my eye.',
    'Something is going on.',
    'I am paying attention.',
    'Hmm. Interesting.',
  ],
};

/** Topics that are events: fresh, they win over everything else. */
export const EVENT_TOPICS: readonly Topic[] = [
  'focusDone',
  'agentWaiting',
  'meetingSoon',
  'agentFinished',
  'focusHalf',
  'meetingEnded',
  'focusStart',
  'musicPaused',
  'clover',
  'wake',
];

/** Topics that describe what is true now: picked over plain thoughts. */
export const CONTEXT_TOPICS: readonly Topic[] = [
  'agentsWorking',
  'musicStreak',
  'musicPlaying',
  'rain',
  'snow',
  'clear',
  'cloudy',
  'fog',
  'cold',
  'hot',
  'morning',
  'midday',
  'afternoon',
  'evening',
];

/** Every line, flat (for the tests and the pull request body). */
export function allLines(): string[] {
  return Object.values(LINES).flat();
}
