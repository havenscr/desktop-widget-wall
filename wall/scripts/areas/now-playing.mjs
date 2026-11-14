// Home's Now Playing block (the left of the Sound card): music, the wall's own video, and both at once.
// Everything this area needs lives here; the two big review scripts are not edited for it.

const at = encodeURIComponent('2026-11-11T10:24:00-08:00');
const galleryQuery = (knobs) => `hz=home&at=${at}&clock=review&weather=ok&${knobs}`;
const state = (name, knobs, expect, actions) => ({ screen: 'home', name, query: galleryQuery(knobs), custom: true, ...(expect ? { expect } : {}), ...(actions ? { actions } : {}) });
const WALL = 'watch=mock&wlist=three&wplace=home';
const LIST = 'watch=mock&wlist=many&wplace=home';
const QUIET = 'sonos=quiet';

export default {
  name: 'now-playing',
  gallery: { states: [
    // Music alone: the full block (cover, title, artist, time bar, controls at the foot).
    state('now playing: music with a cover and a time bar', '', ['Now playing', 'Night Drive', 'Neon Coast', '1:05', '3:01', 'Den, 4 speakers']),
    state('now playing: music, no cover address (the speaker glyph)', 'np=noart', ['Night Drive', '1:05', '3:01']),
    state('now playing: a station with no length (no bar)', 'np=station', ['Night Drive', 'Den, 4 speakers', '!3:01']),
    state('now playing: back and next offered', 'np=skip', ['Night Drive', '1:05']),
    state('now playing: back and next refused as a station that cannot skip', 'np=skip,skipfail,station', ['This station cannot skip'], 'button[aria-label="Next track"]'),
    state('now playing: a very long title and artist, two lines and an ellipsis', 'np=long,skip', ['A Song With A Rather Long Title', '1:05']),
    state('now playing: heavy Sonos, long names', 'sonos=heavy&np=skip', ['Now playing', 'Extended Mix']),
    state('now playing: not live, dimmed, the bar stopped', 'sonos=timeout&np=skip', ['Night Drive', 'Sonos did not answer in time']),
    state('now playing: nothing playing', QUIET, ['Nothing playing', 'Suggested for this hour']),
    state('now playing: a Spotify track on a speaker', 'spotifyplay=speaker', ['Now playing', 'Living room']),
    state('now playing: Pause tip', 'np=skip', ['Pause every Sonos speaker'], 'hover:.sound-np .np-rd.big'),
    // The wall's own video alone.
    state('now playing: the wall video', `${QUIET}&${WALL}&wplay=0`, ['On the wall', 'Night drive mix', 'YouTube video', '12:34', '45:10', 'Open Watch']),
    state('now playing: the wall video, paused', `${QUIET}&${WALL}&wplay=0&wstate=paused`, ['On the wall', 'Night drive mix', 'Open Watch']),
    state('now playing: a playlist on the wall with back and next', `${QUIET}&${LIST}&wplay=3`, ['On the wall', 'YouTube playlist, 4 of 24', '12:34', 'Open Watch']),
    state('now playing: a live stream on the wall (no length)', `${QUIET}&${WALL}&wplay=1`, ['On the wall', 'Lofi beats radio, live', 'YouTube live stream', 'Open Watch']),
    state('now playing: a Twitch stream takes only Stop', `${QUIET}&${WALL}&wplay=2`, ['On the wall', 'Twitch stream', 'Open Watch', '!12:34']),
    state('now playing: the wall video waits for a click', `${QUIET}&${WALL}&wplay=0&wstate=refused`, ['On the wall', 'Click the video on Watch to start it', 'Open Watch']),
    // Both at once: two halves.
    state('now playing: both, video above music', `${WALL}&wplay=0`, ['On the wall', 'Night drive mix', '12:34 of 45:10', 'Now playing', 'Night Drive', 'Neon Coast', 'Den, 4 speakers']),
    state('now playing: both, a playlist', `${LIST}&wplay=3`, ['On the wall', 'Playlist, 4 of 24', '12:34 of 45:10', 'Night Drive']),
    state('now playing: both, a Twitch stream', `${WALL}&wplay=2`, ['On the wall', 'Twitch stream', 'Night Drive']),
    state('now playing: both, the video waits for a click', `${WALL}&wplay=0&wstate=refused`, ['On the wall', 'Click the video on Watch', 'Night Drive']),
    state('now playing: both, a station and long names', `${WALL}&wplay=0&np=station,long,skip`, ['On the wall', 'A Song With A Rather Long Title']),
    state('now playing: both, the video paused', `${WALL}&wplay=0&wstate=paused`, ['On the wall', 'Night Drive']),
  ] },
};
