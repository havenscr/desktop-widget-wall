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
  | 'late'
  // Plain sheep thoughts, some shaded by her mood.
  | 'sheep'
  | 'happy'
  | 'sleepy'
  | 'curious';

export const LINES: Readonly<Record<Topic, readonly string[]>> = {
  focusStart: [
    'Reading along. Quietly.',
    'I will keep the horizon still for you.',
    'Focus mode. I brought a book.',
    'You work, I read. Good system.',
    'Shh. Thinking happening.',
  ],
  focusHalf: [
    'Half way. Still reading.',
    'Half done. The book is getting good.',
    'Middle of the session. Steady.',
    'Half way there. No rush.',
    'This is the long middle part.',
  ],
  focusDone: [
    'Done. That was a good one.',
    'Session over. Stretch something.',
    'Finished. I finished a chapter too.',
    'Focus done. Water might be nice.',
    'That counts. Well done.',
    'Done. The horizon held.',
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
    'Call soon. Water first.',
    'Meeting coming up. Hair check.',
    'A call in a few minutes.',
    'Call soon. I will be quiet.',
    'Almost meeting time.',
  ],
  meetingEnded: [
    'That call is over.',
    'Meeting done. Back to the quiet.',
    'All talked out?',
    'Call finished. Deep breath.',
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
    'More of that, please.',
    'Oh. Hello again.',
    'I like you too.',
    'Wool is soft today.',
    'Good timing. I was bored.',
  ],
  wake: [
    'Morning. I slept well.',
    'Up. Mostly.',
    'Good morning. The sky is new.',
    'Awake. Stretching first.',
  ],
  agentsWorking: [
    'Two agents still at it. I supervise.',
    'The agents are busy. I am not.',
    'Work is happening up there.',
    'I keep an eye on the agents.',
    'Busy lanes today.',
    'They work, I graze. Fair.',
  ],
  musicPlaying: [
    'I like this song.',
    'Good beat for standing.',
    'This one has nice bass.',
    'Music makes the grass taste better.',
    'Tapping a hoof.',
    'Dancing, but inside.',
    'Nice choice.',
    'I know this one. Sort of.',
  ],
  musicStreak: [
    'Long listening session. Nice.',
    'We have been dancing a while.',
    'The music has been going for ages.',
    'Still playing. Still good.',
  ],
  rain: [
    'Rain. Good day to stay inside.',
    'Rain on the wool. Smells nice.',
    'Wet out there. Dry in here.',
    'The rain is doing its thing.',
    'Umbrella weather.',
    'Rain sounds. I like them.',
  ],
  snow: [
    'Snow. I blend right in.',
    'It is snowing. I am a cloud now.',
    'Snow day energy.',
    'Cold and white out there.',
  ],
  clear: [
    'Clear sky. Very blue.',
    'Sunny. Sunglasses on.',
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
    'Cold today. Scarf on.',
    'Brisk. Good wool weather.',
    'Chilly out. Warm in here.',
    'Cold enough for a scarf.',
    'Wear socks.',
  ],
  hot: [
    'Warm out. Too much wool.',
    'Hot day. Shade is good.',
    'Very warm. I am mostly fluff.',
    'Hot one. Drink something.',
  ],
  morning: [
    'Morning. Fresh grass.',
    'Early. The light is soft.',
    'Morning. One thing at a time.',
    'Good morning, desk.',
    'Breakfast would be good.',
    'New day. Clean slate.',
  ],
  midday: [
    'Lunch time, maybe?',
    'Middle of the day already.',
    'Noon. Good time to look up.',
    'Half the day done.',
    'Sun is high. So is morale.',
  ],
  afternoon: [
    'Afternoon. Slow and steady.',
    'That is a lot of tabs.',
    'Afternoon slump. Normal.',
    'A walk might help. Short one.',
    'Tea time, possibly.',
    'Afternoon light is the best light.',
  ],
  evening: [
    'Evening. Nice work today.',
    'Getting dark. The moon is up.',
    'Evening. Time to slow down.',
    'Look, the moon.',
    'Almost done for the day?',
    'Dinner smells, probably.',
  ],
  late: [
    'It is late. Even sheep sleep.',
    'Late night. I am yawning.',
    'The moon is very high now.',
    'Still up? Me too, barely.',
    'Late. Tomorrow is also a day.',
    'Night shift. I am off duty.',
    'Quiet hours.',
    'Bed is a good idea.',
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
    'Do sheep dream of anything?',
    'Small steps. Literally.',
    'I like it here.',
    'One hoof at a time.',
    'Some days are for standing.',
    'I wonder what is past the hills.',
    'Quiet is good.',
    'I am here if you need me.',
    'The lake looks calm.',
    'Ever counted stars? Lots.',
    'Grazing on light.',
  ],
  happy: [
    'Good day so far.',
    'I feel springy.',
    'Today is nice.',
    'Happy sheep noises.',
  ],
  sleepy: [
    'Nap soon, maybe.',
    'Eyes are heavy.',
    'Yawn.',
    'Wool is getting heavy.',
  ],
  curious: [
    'What is that?',
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
  'late',
];

/** Every line, flat (for the tests and the pull request body). */
export function allLines(): string[] {
  return Object.values(LINES).flat();
}
