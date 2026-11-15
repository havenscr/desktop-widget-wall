# Ridgeline

Ridgeline is the next front end for Widget Wall. It was called "Wall 2" while it
was built, and some file, folder and code names (`wall/`, `wall2_*.rs`, the window
label `wall2`, the app identifier) keep that name on purpose. It lives beside the
existing app (`src/`, untouched) and is built with Vite, React and TypeScript
(strict). It runs in a plain browser for development and inside Tauri as a second
app, "Ridgeline". So far: a scaled stage, the live horizon, a left rail with
Work, Home and Unwind and below them Meet, On air, Zen, Tools and (in the app) a fullscreen button, a clock, the Work tab basics (weather, music, focus timer), a task
card, a network tile and mood buttons on Home, the Unwind tab with Watt the sheep, a sound ripple
on the horizon, the Zen place with Dream, a small Tauri bridge and tests. Home has its moods, a Rooms row, Sonos controls and a network tile.

## Requirements

Node 22 or newer and npm. Nothing else is needed for the web side. The Tauri
build also needs Rust and the Windows toolchain; CI does that on a Windows
runner, so you rarely need it locally.

## Spotify

Spotify support uses the Web API and a local `spotify.json` file in the same app config
folder as `feeds.json`. Sign in at the Spotify developer dashboard, create an app with
any name and description, add the redirect URI exactly
`http://127.0.0.1:8898/callback`, choose the Web API, and save. Copy the Client ID into:

```json
{ "clientId": "0123456789abcdef0123456789abcdef", "redirectPort": 8898 }
```

The port is optional and defaults to 8898. Press Sign in on the wall's Spotify card. Starting playback from the wall needs Spotify Premium. The integration
has not been verified against the live Spotify service.

### Saving songs (the heart on the player row)

The sign-in asks for one more permission, `user-library-modify` (the scope Spotify's reference lists
for saving and removing library items, [Save Items to Library](https://developer.spotify.com/documentation/web-api/reference/save-library-items)
and [Remove Items from Library](https://developer.spotify.com/documentation/web-api/reference/remove-library-items);
the older Save Tracks page names the same scope). Nothing else was added to `SCOPE`: reading whether a song is saved needs
`user-library-read`, which the sign-in already had.

A sign-in made before this permission existed does not hold it, so saving is off until the owner signs in
once more (Tools, Spotify, Sign out, Sign in). Until then the heart is dim, and a click opens a note with an
Open Tools button. After the new sign-in the heart works with no restart. The Rust side keeps the `scope`
list of the last token answer in memory (the code exchange replaces it; a refresh answer replaces it only
when it names one), and `wall2_spotify_status` carries one more field, `canSave`, with three values: `yes`
(the list is known and holds the permission), `no` (it is known and does not) and `unknown`. After a restart only
a refresh token is stored, so the value is `unknown` until the first token refresh answers (and for good if no
answer ever names the scopes). Only `no` dims the heart and offers the note; on `unknown` the heart looks and
works as usual and a click tries the save. The heart reads the status again after its first read, which has
forced a refresh if one was due.

Two commands, both limited to the `wall2` window, with the module's fixed words:

- `wall2_spotify_saved(id)` answers whether the track is in Liked Songs (`GET /me/library/contains`).
- `wall2_spotify_save(id, on)` saves or removes it (`PUT` or `DELETE /me/library`). A 403 means a missing
  permission only when Spotify's own wording says so (the error object's message "Insufficient client scope",
  compared without regard to case, from a body of at most 4 KB) or when the kept list is known and lacks the
  permission: the answer is then `needs sign in` and `canSave` becomes `no`. Any other 403 answers `refused`
  and leaves the list alone. A 401 refreshes the token and tries the save once more.

Both take a Spotify track id, exactly 22 letters or digits, checked before anything is sent; the track URI is
built from it in Rust. Spotify's February 2026 changes removed the per-type `/me/tracks` calls in favour of the
library calls above, which take a `uris` query (at most 40; the wall sends one).

Whether the playing song is saved is read once per song, never on a timer. A click shows the change at once and
puts it back, with the line "Could not save this song" in a small note beside the heart that closes after four
seconds, if Spotify refuses. The first read's answer is kept as the baseline while a click is out, so a refused
write goes back to what Spotify said whichever answers first; one click operation (the status read included)
runs per song at a time, and an answer for a song no longer shown changes nothing on screen. A song with no id (a podcast episode,
a local file) and nothing playing have no heart. Dev mock: `spotifyheart=saved|unsaved|readfail|savefail|nopermission|unknown|unknownlacks|episode`.

Status treats a stored refresh token as signed in. If Spotify has expired that grant,
the status changes only after the first library or playback call tries to refresh it.
The panel must render every Spotify name as plain text, including playlist names from
other people in search, and must never render those names as markup.
Library items include bounded subtitles, counts and cover images selected near 300 and
64 pixels. Track lists use 50 items per page and stop at page 39. Queue reads return at
most 10 upcoming tracks. Playback reads return no value when Spotify has no active
session. The seek command (`wall2_spotify_seek`) takes a position in milliseconds, at most 24 hours, and returns the module's fixed words on failure. The YouTube Music action opens the fixed `https://music.youtube.com/` address.
Track-producing reads send `market=from_token`. A track is unplayable only when
`is_playable` is present and false, it is restricted or local, or the item is not a
track; a missing `is_playable` means playable. An unplayable row reaches the web view
with `playable: false` and `id: null`. Profile, devices and playback state answers are
capped at 64 KB. Liked, recent, search, queue, playlist and album pages, album metadata,
and the playlists and albums lists are capped at 512 KB. The signed-in profile is cached
in memory until sign in or sign out so search and playlist paging reuse it safely.
When a play request includes a context, that context and its optional offset take
precedence over the top-level kind and id; the top-level values remain validated.

## YouTube

The wall signs in to YouTube so that it can read the owner's own playlists and liked videos.
The sign-in and its row in Tools came first; the library came next (see "The library" below).
Nothing plays yet: playback is a later change. It needs a Google Cloud OAuth client of the
"Desktop app" type, made in your own Google Cloud project.

- **Scope.** Only `https://www.googleapis.com/auth/youtube.readonly` (view the account). The
  wall cannot change, post or delete anything. A grant that comes back without that scope,
  or without a refresh token, is revoked at once and the sign-in ends as `denied`.
- **Setting the client.** Tools, Accounts, YouTube, Set up: paste the client id and the client
  secret and press Save. Rust checks both (the id as `<digits>-<name>.apps.googleusercontent.com`,
  the secret as 20 to 64 letters, digits, `_` or `-`) and keeps them together in Windows
  Credential Manager (`WidgetWall2/youtube/client/0`). Neither value is ever sent back to the
  page, written to a file or logged. The form refuses while signed in: sign out first.
- **File route.** Instead of the form, a `youtube.json` in the app config folder (beside
  `spotify.json` and `feeds.json`) is read, never written. It is either
  `{ "clientId": "...", "clientSecret": "..." }` or Google's own downloaded file (the
  `installed` shape; a `web` client is refused). Only the two named fields are read: any other
  field, endpoints included, is ignored, because the endpoints are fixed in Rust. A client
  saved through the form wins; the file is read only when none is saved. `youtube.json` and
  `client_secret*.json` are in `.gitignore`.
- **Sign-in.** Sign in opens the system browser on Google's page (PKCE, S256, a random state)
  and listens for the answer on `127.0.0.1` at a random free port, path `/callback`, for at
  most five minutes; Cancel ends it. The listener is closed as soon as the code arrives. The
  browser tab then says "Signed in. You can close this tab." While the app is in Google's
  "Testing" state the refresh token dies in seven days, so publish it as "In production"; as an
  app only the owner uses it stays unverified, and Google shows its warning page at each
  sign-in.
- **Where the tokens live.** The refresh token in Credential Manager
  (`WidgetWall2/youtube/refresh/<n>`), the access token in memory only. Only `invalid_grant`
  deletes the stored token (and only if it is still the one that was tried); a refused client
  (`invalid_client`) deletes nothing and the row reads "Setup broken".
- **Sign-out.** Revokes the grant at Google (five seconds), then always clears the stored
  token, the one in memory and the note; the client stays, so Sign in works again at once.
- **Status.** `wall2_youtube_status` answers only `{ setup, signedIn, reason, searchesLeft }`
  with `reason` one of `not set up`, `sign in again`, `setup broken` or `failed`;
  `searchesLeft` is the search budget of the day (about 100, see "The library"), a number only while
  signed in and empty otherwise.
- **Links.** The row carries the two links YouTube API Services asks for, YouTube Terms and
  Google Privacy Policy. The page sends only the kind word (`youtube-terms`, `google-privacy`)
  to `wall2_open_link`; the addresses are fixed in Rust.
- **The log `wall2-youtube.log`** (app log folder, 64 KB cap) holds lines of four fields:
  an event (`sign-in-start`, `sign-in-ok`, `sign-in-failed`, `sign-out`, `revoke-failed`,
  `refresh-ok`, `refresh-refused`, `refresh-failed`, `client-saved`, `client-forgotten`,
  `read-ok`, `read-failed`, `search-ok`, `search-failed`), a
  reason (`none`, `busy`, `down`, `failed`, `sign-in-again`, `setup-broken`, `denied`,
  `cancelled`, `timed-out`, `quota`, `quota-all`, `not-found`, `invalid`), an HTTP status and
  milliseconds. Never an id, page token, token, client value, title, channel or search words.
- **The library** (`wall2_youtube.rs`, the YouTube side of the music card). Four commands, each
  opening with the window check and running its read on a blocking thread:
  `wall2_youtube_playlists(page_token?, fresh?)`, `wall2_youtube_items(playlist_id, page_token?,
  fresh?)`, `wall2_youtube_liked(page_token?, fresh?)` and `wall2_youtube_search(query)`. They read
  YouTube's Data API v3 with the bearer token (`playlists.list mine=true`; `playlistItems.list`
  then `videos.list` for the page's ids; `videos.list myRating=like`; `search.list type=video
  videoCategoryId=<Music> videoEmbeddable=true maxResults=25` then `videos.list`; the Music category
  from one `videoCategories.list` a run, falling back to 10). Endpoints are constants
  (`https://www.googleapis.com/youtube/v3/` plus one of five names), every query value is
  URL-encoded, every call carries a `fields=` mask (titles, the channel's name, one length, the
  embed, privacy and region flags; never a description), the agent follows no redirect and gives up
  after 6 seconds, and a 401 forces one refresh and one retry. Pages are 50. Answers are shaped
  records and nothing else: `{ items, next }` with a playlist `{ id, title, count, thumb }` or a
  video `{ id, title, channel, seconds, thumb, playable }`, `playable` one of `yes`, `embed` (not
  embeddable), `private`, `removed` (deleted, or missing from the `videos.list` answer) and
  `region` (blocked in the constant region `US`). Everything from Google is checked before use: a
  video id is 11 of `A-Za-z0-9_-`, a playlist id 2 to 64, a page token 1 to 128 (the page checks the
  same patterns before it calls), a playlist item counts only when its kind is `youtube#video`,
  lengths come from `PT#H#M#S` only and stop at 7 days, titles lose control and bidirectional
  characters and stop at 200 (channels at 100), and a body over 512 KB (16 KB for an error) is
  `down`, never a partial parse. A video's picture is built by Rust from its checked id as
  `https://i.ytimg.com/vi/<id>/mqdefault.jpg`; a playlist's is taken from its snippet only when it
  is exactly that host and path shape (https, no port, no user, a checked id), then rebuilt the same
  way; otherwise `null`. No Google address crosses to the page, which draws a picture only from
  `https://i.ytimg.com/vi/` (a development build also draws the mocks' own `data:image/svg+xml`
  motifs), without a referrer, lazily, with a neutral tile as the fallback.
- **Errors, cache and the search budget.** Errors are fixed words taken from the status and the
  first error reason only: `not set up`, `sign in again`, `setup broken`, `busy` (429, or a 403
  `rateLimitExceeded`), `quota` (a 403 `quotaExceeded` on search), `quota-all` (the same elsewhere),
  `not found`, `invalid` and `down`. The cache is Rust memory only: playlists and a playlist's pages
  1 hour, liked 10 minutes, video details 24 hours by id, search answers 24 hours by the trimmed,
  lower-cased words; at most 200 lists, 5000 video details and 100 searches (the oldest goes first);
  `fresh` skips the cache for that one list (a search is never re-run by it); the page reads at most
  40 pages of one list (it then says "Showing the first 2,000"). Sign-out, a new client and a
  forgotten client clear every cache and the search count; a refused grant and every new sign-in clear the
  caches too (the day's count stays: it belongs to the client's quota, not to the account), and a read that
  started before a clear writes nothing back. Paging holds natively: a first page is always allowed, a later
  page only with the token the previous page of that list handed out, and at most 40 pages of one list;
  anything else answers `invalid`. Rust counts `search.list` calls since the
  last midnight Pacific (a pure function from Unix seconds, with the US rule: daylight time from 2:00 on
  the second Sunday of March to 2:00 on the first Sunday of November, no extra crate); the status carries
  `searchesLeft` (100 minus the count) while signed in, a 403 `quotaExceeded` on search sets the count
  to 100 until midnight, and search words are trimmed, 1 to 100 characters, with no control or
  bidirectional character, and never logged. The day's budget is reserved before the call, atomically (two calls
  starting at 99 spend one), and given back only when no request left the machine; the same words already in
  flight share one call; a search whose details read failed keeps its answer for ten minutes, so a retry reads
  the details only and spends no second search.
- **In the card** (`wall/src/unwind/ytmusic/`). Set up and signed in, the YouTube side is the library:
  one row with the tabs Playlists and Liked and the search field, and under it the playlists as 16:9
  tiles (four columns at rest, five tall) or the liked videos or a search answer as rows. A tile opens
  its videos (Back and Escape return; Refresh reads that playlist from YouTube again and the line
  under it says when it was read). Search runs on Enter only, never on typing; the same words again
  make no call, the same words in flight share one call, and an older answer never replaces a newer one. Nothing
  is read while the page is hidden or after the side is gone; what is loaded stays across the tall view (Refresh
  re-reads). Retry repeats the read that failed (the first page or the next page). Each list of rows takes
  keyboard focus, so the arrow keys, Page Up, Page Down, Home and End scroll it. Under 20 searches left the field says how many; at none it is disabled and says so,
  while Playlists and Liked keep working. A row that will not play outside YouTube is greyed and its
  length column says "Only on YouTube", "Private" or "Removed". Rows are plain: not buttons, no click,
  no pointer cursor; each has a hover card. Not set up, signed out, a dead sign-in or a refused setup
  keep today's remote with one line and one button under it. Nothing plays and nothing pretends to:
  playback is the next change. `?youtube=in&ytlib=full|few|empty|slow|down|busy|again|gone|low|spent|long`
  picks the library's state (development mock only), and `?ytsearch=<words>` runs a search on open.
- **No test talks to Google.** Every path runs against fake `Http` and `Creds` traits; the real
  sign-in, Google's warning page and whether its token exchange needs the secret are checked by
  hand.

## Run, test, build (web)

All commands run from the repository root (or `cd wall` and drop `--prefix wall`).

```bash
npm --prefix wall ci            # install exact dependencies
npm --prefix wall run dev       # dev server at http://localhost:1421
npm --prefix wall run typecheck # tsc --noEmit, strict
npm --prefix wall test          # vitest run (jsdom)
npm --prefix wall run build     # type check, then vite build into wall/dist
npm --prefix wall run preview   # serve wall/dist
```

In a browser there is no Tauri. `src/bridge/tauri.ts` then answers `invoke`
from a mock table (`mocks`); fill it from tests or dev code. An unknown command
rejects with a clear error. Inside Tauri, `invoke` calls the real command.

## Home moods

Home follows the concept's `f_home` on the frame's zones (`screens/Home.tsx`,
`styles/home.css`): the left third (headline, day curve, weather and house, below) under the clock in the left wing; in the centre the
concept's smaller mood cards in one row, the Rooms row's place and the Sound block (see
"Sound on Home"); Around the house with the network card in the right wing. The Rooms
row (`home/Rooms.tsx`) and the House line render nothing until the home app reads them
(PRs 24 and 25): no placeholder card.

- **Left third** (`home/LeftWing.tsx`, `sunLine.ts`, `dayCurve.ts`, `SunCurve.tsx`, `OutsideRow.tsx`,
  `HouseLine.tsx`; rules under "Home left third" in `styles/home.css`): everything starts 23 px under the
  date (wall y 200, 458 px wide from x 136) and ends above y 440. In order: the headline, the day as a
  low curve, one row for the weather outside, and the house row with its room dots. All of it redraws once
  a minute; nothing animates.
  - **Headline** (`sunHeadline`): from the horizon's own sun (`ribbon/sun.ts`), to the nearest minute. By day
    the daylight left; within 90 minutes before sunset "Sunset in N min" in amber; before sunrise the
    sunrise time; after sunset tomorrow's sunrise. A date with only a sunrise or only a sunset says that
    one time; a date with neither has no headline.
  - **Curve** (`dayCurve.ts` for the maths, `SunCurve.tsx` for the drawing): x is the time of day, midnight
    to midnight (458 px for 24 h); above the base line from sunrise to sunset, a dip below it at night. Only
    the two crossings and the sun's x are data; the hump's height (56 px) and the dip (13 px) are a drawing.
    The part of the day already travelled is at full strength, the rest at 38 percent; a disc on the hump
    by day, a ring on the dip at night. The two time labels sit 12 px outside their crossings; on a long day
    a label drops its glyph, then its AM or PM, so it always fits between its crossing and the box's edge.
    Hover card: both times and the day's length. Text alternative: "Sunrise 7:13 AM, sunset 4:33 PM, the sun is
    past its highest point". A date with no sunrise or no sunset draws no curve.
  - **Outside row** (`OutsideRow.tsx`): "50° outside, partly cloudy" and the day's high and low, from
    `useWeather()` (nothing is added under `weather/`). The hover card says when the reading was taken and,
    for the second source, which one. A reading more than a normal refresh old is dimmed and says "updated N
    min ago" in place of the high and low; with no usable reading the row is the one dim line the Unwind date
    line uses ("weather unavailable", its hover card says why); while the first read is out the row is left out.
  - **House row** (`HouseLine.tsx`): "68° inside. Lights on in two rooms." and a dot per room, as before. It
    stays hidden while the home app's desk routes are absent; not live, it is dimmed and says "as of" at the
    right end of the dots row. The dots stay on one line: when the rooms do not all fit, the lit ones come
    first and the rest are counted as "+N more" (the hover card names them).
  - Review script rules, gallery states and deliberate breaks live in `scripts/areas/left-third.mjs`.
- **Columns** are fixed (`.home-wing` 1, `.home-centre` 2, `.home-right` 3), so a zone
  that renders nothing never shifts the others.
- **Mood cards** (`home/Moods.tsx`, `home/MoodArt.tsx`): one card per mood the home
  app defines, in its order (today Day, Evening and Late Night). Each card has painted
  art drawn as one SVG (Day a sun, Evening a striped sunset, Late Night a moon and
  stars; Movie and Goodnight are drawn too for when they exist, and any other mood gets
  a lamp glow) and the concept's line under the name where it has one. Nothing fakes a
  mood the home app lacks. The last mood tapped carries an "On now" tag and a cyan ring.
  The cards are 150 px tall in one row; up to six share its width, and with more than
  six each keeps a sixth and the row scrolls sideways (the mouse wheel scrolls it), so
  the Sound block keeps its room. When the home app sends a schedule (`nextAtMs` on a
  mood; it does not yet), a mood due within the hour says "In N min". With Sonos not
  set up, not reachable or loading the cards grow to 300 px into the room it leaves.

The Home tab shows one card per mood the home app already defines
(at most 12). Tapping
one sets the lights through the home app. Nothing is ever applied by itself: the
list loads when the tab opens and every 10 minutes while visible, and only a tap
changes the lights. A tapped card shows a spinner, then a check for 2 seconds; a
failure shows a short amber message on the Moods line for 5 seconds. The last mood
tapped is kept per device (`wall2-last-mood` in local storage). The last good list is
kept too (`wall2-moods-cache`), so the cards stay, with a quiet amber "Home app not
reachable" on the Moods line, when the home app is briefly away; with no list ever
read, that line is all the row shows. When the home app answers with no moods, one
compact card says "No moods set up in the home app yet". "On now" marks the last mood
tapped on this wall; a mood set from a phone or a routine shows only once the home feed
carries the active mood.

The commands are `wall2_moods` and `wall2_apply_mood` in
`src-tauri/src/wall2_home.rs`. They read `homeBaseUrl` from `feeds.json` like the
network tile and call two home app routes: `GET /api/moods` (the keys of `moods`
are the ids) and `POST /api/moods/<id>/apply` with no body. Ids must match
`^[A-Za-z][A-Za-z0-9]{0,31}$` and are checked before any request. Errors are
short and never hold the address: 409 reads "Moods are not set up in the home app
yet", 404 "Unknown mood", anything else "Could not set the mood". The requests
use the same 8 second timeout, 1 MB cap and no redirects as the other feeds. With
no `homeBaseUrl` the row says "Not set up"; with no moods it shows the one compact card.

### Sound on Home

`home/Sound.tsx`, `home/NowBlock.tsx`, `home/wallVideo.ts`, `home/useSonos.ts`, `home/soundModel.ts`,
`src-tauri/src/wall2_sonos.rs` (its reads and the cover fetch: `wall2_sonos_read.rs`; its log: `wall2_sonos_log.rs`).
The owner's Sonos service on the home box, read every 30 seconds while the wall is
visible. Nothing on the wall plays or changes volume without a click, and one deliberate
click is one write: the second click of a double click and the repeats of a held key are
ignored, and each control stays latched for 800 ms after its write settles.

- **Quick play**: five buttons, in this order: Morning, Day, Evening, Late Night, Workday.
  Each is the music routine whose name carries that word as a whole word ("Workday" never
  reads as Day; "late night" may be one word or two; case is ignored). The button's label
  is exactly the word, whatever the routine is called; the tooltip has the routine's own
  name, favourite and volume. A word with no matching routine has no button, and when two
  routines carry the same word the first by name (case-insensitive, then by key) wins, and a routine used by an earlier tile is skipped. Every other routine
  sits under **More**, with the ungroup all control; the group all control is not offered
  anywhere on the page (the Rust command and its loud-volume confirm are unchanged). The
  service has no way to play a favourite directly, so More lists routines only. The one of
  the five that fits the hour is tagged "Suggested" (from the tiles only; morning 5 to 9 AM, Workday then Day
  on weekdays to 5 PM, Day then Workday at weekends, evening to 9 PM, late night after).
- **Unforced plays**: a click triggers the routine without `force`, so its own skip
  conditions apply. Only a JSON `skipped: true` answer is a skip (a list of left-alone
  speakers means the routine ran); the service gives no reason, so a skip says "Skipped:
  this routine's own conditions say not now" beside the heading with a **Play anyway** button (tooltip "ignores this routine's own
  conditions") that sends the forced call; it stays on offer for a minute.
- **Started**: the service does not say which routine is playing, so "On now" is never
  claimed. The routine last started from this wall says "started N min ago" only while
  what plays is evidently what it started: the first read with music records its group;
  nothing playing, "Sonos Off", another group, or no group to tell by clears it for
  good; it never lasts past an hour (`wall2-sonos-last-play` in local storage).
- **Where**: three places, in this order: Office, All Speakers, Common Areas (title case,
  like the buttons around them). They are the service's group presets whose names start
  with those words; the label drops anything in parentheses ("Office (Work)" reads
  "Office"), and other presets are not shown. The three buttons share the row's width
  equally, up to the "Sonos Off" button, with their icon and label centred; the one in use
  keeps its look and its share and shows the same label as the others. The preset whose
  grouping matches the speakers' groups now is marked (Rust compares them).
- **Loading**: Home's centre draws at its final sizes from the first paint: the mood row at
  the height it has with Sound present, and a Sound skeleton of the real block's height
  (quiet shapes, no spinner, no text). The tall-mood layout is chosen only once Sonos has
  said "not set up", has failed, or has been silent for 2.5 seconds, and that change is
  one slow fade (600 ms height, instant under reduced motion); Sound arriving late after
  the fallback fades back the same way.
- **Volume**: one slider for the current group (the group with the most speakers
  playing music; a speaker on line-in carries the PC's sound and is left out). It moves
  each speaker by the same step from its own level (clamped); a speaker with no level
  reading is left out, the label and tooltip count only the ones that move, and the
  result says "3 of 4 speakers changed". It sends one change when
  the pointer lets go or the arrow keys settle (400 ms). It holds the pointer while
  dragging, so a release outside the window still finishes it; a cancelled pointer, a
  window blur or the slider turning off mid-drag puts it back. **Speakers** opens every
  speaker with its state and its own slider; a speaker on line-in says "PC audio" and
  offers "PC volume" (the Windows volume control) instead of a Sonos slider.
- **Asks first** in a bar over the card, naming what it would do: any volume above 40
  (whatever the last read said the speaker was at); a routine above 40 or at a volume it
  does not name; a preset that would leave a speaker above 40 or at an
  unknown level ("Studio is at 100. Apply anyway?"), unless the preset itself sets that
  speaker to 40 or less (a line-in group, the PC's own sound, does not count).
- **Play and pause**: "Sonos Off" pauses every speaker while music plays; with nothing
  playing the button names the suggestion ("Play Evening") and is off when no routine fits
  the hour. The service has no resume command, so there is no Play after a pause. Back and
  next on the music appear only when the sound service says it has them (see "Now Playing").
  **Sleep** offers 30, 60 or 90 minutes (5 minute fade); the soonest running timer shows
  its minutes left and cancels on a click.
- **Now Playing** (`home/NowBlock.tsx`, the rules in `styles/home.css`): the left of the
  card, one box of 390 by 226 at the default card (its rows give it its height; every layout
  is a layer that fills it, so a change of layout never moves the card), with three
  layouts and the quiet block. They cross-fade over 200 ms (none under reduced motion).
  - **Music alone**: a 136 px cover (the speaker glyph tile when there is no cover), the
    kicker "Now playing", the title on up to two lines, the artist, a time row with a 6 px
    bar when the track has a length (the position counts on each second from the read that
    carried it, never past the end, and stops while the read is not live; the one-second
    clock runs only while that bar is on screen; a station has no length and no bar, and
    the where line sits right under the artist), and the control row at the
    foot: back and next (40 px, only when the service has them), pause (44 px, cyan), then
    the where line. A Spotify track on a house speaker uses the same layout with its own
    cover and times. A TV or line-in room is not music: the quiet words stay.
  - **The wall's own video alone** (`home/wallVideo.ts` reads the Watch store and acts
    through its own actions and `playerLink`; no second player is mounted): the same block
    with a cyan tile, "On the wall", the title, "YouTube video", "YouTube live stream",
    "YouTube playlist, 4 of 24" or "Twitch stream", the time row when the player reports a
    length, and pause or play, stop and "Open Watch" (to the Unwind place's Watch tab);
    back and next only for a playlist the player reports with more than one item. A Twitch
    item takes only Stop and Open Watch. While autoplay was refused the line reads "Click
    the video on Watch to start it" and there is no pause. A video that has ended is no
    longer shown. The Watch frame lives in the stage layer mounted for every place, so it
    keeps playing and keeps answering `playerLink.send` while Home shows (proved in
    `home/wallVideo.test.tsx`). A pause or play pressed while the frame is still loading is
    sent once the frame loads (`PlayerFrame.tsx` tells a newly loaded frame the store's paused
    state). If a back or next message is not taken (no loaded frame), both buttons stop with
    the hover "Open Watch to control this" until another item is on (by identity, also the same
    title replayed), the player reports (it has started, or the frame has loaded and answers),
    or Home is shown again.
  - **Both at once**: two halves with a hairline, the video above the music; each half has
    a 92 px picture, kicker, one-line title, two small lines and its buttons at the right
    (pause and stop for the video, pause for the music). The split view has no time bar
    and no back or next.
  - **Cover art**: the page never loads a cover itself. Rust fetches it (`wall2_sonos_art`,
    which takes no address from the page): the `albumArtURI` the last good read held for the
    playing speaker, only when it is `http` to a literal private IPv4 address on port 1400
    (a speaker's own address) or `https` to `i.scdn.co` or `mzstatic.com` (or a name under
    them), rebuilt from checked parts (no user info, fragment, backslash or non-ASCII),
    never following a redirect, with a 3 second limit for everything, at most 400 KB, a
    status of 200 only, and bytes that begin as a JPEG, PNG or WebP (whatever type was
    declared). One fetch per distinct address (the last result, a failure too, is kept in
    memory only; a failed address is tried once more when asked for 30 seconds or more after
    the failure, never a third time, and an address that is not allowed never). The summary
    carries a short opaque key for the cover (a hash of the address, never the address), and
    the page fetches again when that key changes, whatever the title is; the previous cover
    stays while a new one is on its way for at most 2 seconds, and a track with no cover shows
    the glyph at once. Every failure answers nothing and writes one fixed word to the Sonos
    log (`failed art refused|too-big|not-image|timed-out|no-answer|bad-answer`), never the
    address. Without a cover the glyph tile shows.
  - **Back and next for Sonos**: `GET /api/capabilities` is one more optional read beside the
    others; `{ "skip": true }` (exactly) makes the summary's `canSkip` true, anything else
    (a 404, a failure) leaves it false and the two buttons are not drawn. The commands
    (`wall2_sonos_skip`, direction exactly `next` or `previous`) are refused unless the last
    read said `canSkip`, is under two minutes old and music plays; they send `POST
    /api/action/next` or `/api/action/previous` with `{}`; only a JSON answer whose `ok` is exactly `true` is
    done (any other successful answer is "Sonos could not do that"), and a 4xx with
    `{ "error": "cannot-skip" }` shows "This station cannot skip", `nothing-playing` shows
    "Nothing is playing". The page reads the summary again after it. The two buttons show busy while the
    write runs and through the 800 ms latch after it (a second click inside it sends nothing).
    Pause still pauses every speaker.
  - Dev mocks: `?np=` takes `station` (no length), `noart`, `skip` (back and next), `skipfail`
    (a skip refused as a station that cannot skip), `long` (long title and artist) and `tv`
    (the studio plays a TV input);
    the wall's video comes from the Watch mocks (`?watch=mock&wlist=three|many&wplay=<n>&wplace=home`,
    `wstate=refused` for the click wait). Review script: `scripts/areas/now-playing.mjs`
    (gallery states, and fit rules with a deliberate break for each).
- Every action shows a brief result beside the heading ("Playing Evening", "Could not
  reach Sonos", "Some speakers did not change", which reads again at once). A read that
  failed twice in a row, or one over two minutes old, dims the card, says what happened
  and turns every control off. Every read, from the 30 second cadence or by hand, is the
  first of a pair: when it fails the page reads once more 5 seconds later (one at a time,
  never while the wall is hidden, dropped when it is closed), and until that second read
  ends the card shows what it showed (a healthy card as it is, a dimmed one with its line
  and kind). Only the second read's failure changes what is shown (two different kinds in
  a row: the second), and any good read clears the line at once, so a dimmed card
  recovers within 5 seconds of the service answering. The amber line names the kind of
  failure, then the age of the last good read: "Sonos did not answer in time. Last good
  read 1 min ago" (the 4 second limit passed), "Sonos cannot be reached. Last good read
  1 min ago" (no connection, or it was reset) or "Sonos sent an answer the wall could not
  read. Last good read 1 min ago" (a status other than success, or a body that was
  unreadable, too large or not JSON). Under a minute the age reads "less than a minute
  ago"; with no good read yet the line is the first sentence alone. A card that is only
  old, with no failed read (for example just after the wall was hidden for hours), says
  "Checking Sonos. Last good read 3 h ago" and names a kind only after a read has failed.
  With no reading at all, the line and the card's body use the same first sentence
  ("Sonos cannot be reached. Checks again every 30 seconds."). The Tools drawer's
  Sound row says the same first sentence. The 30 second cadence, the two minute rule and
  the lock on writes are unchanged. Never reached shows one compact card; no
  `sonosBaseUrl` shows one line saying what to add. With the moods out as well, the
  centre shows one status card instead (`home/CentreStatus.tsx`, `home/centreSources.ts`):
  each source and its state in plain words, the age of its last good read, the key to
  add when not set up, and **Check again** for both.

Rust (`wall2_sonos`, every command answers the `wall2` window only): reads `GET
/api/status`, `/api/speakers` and `/api/routines` (all needed), `/api/groups`,
`/api/group-presets`, `/api/scenes`, `/api/sleep-timers` and `/api/capabilities` (each may fail alone), side by
side, with a 4 second timeout, no redirects and a 1 MB cap per answer. An answer with
more than 500 entries in a map or list is refused as malformed, and collecting stops at
each cap. The summary is bounded (24 speakers, 24 groups, 12 presets, 48 routines, 12
scenes, 6 timers, the soonest first, one that ended over a minute ago gone; an end time
may be an ISO time, a number or a number in a string), names are cleaned to one line of
at most 60 characters, a speaker whose name would not survive the round trip is left
out, and only enabled music routines and the pause, group and ungroup controls are kept
(TV volume profiles set volumes of their own and are left out; a music routine carrying
any other volume key has no known volume). Writes, each built in Rust and checked
against the last good read (at most two minutes old; a key, preset, speaker, group or
timer id not in it is refused), go out on an agent that never reuses a pooled
connection, so the client never re-sends one: `POST /api/trigger/<routine key>`
(unforced; its answer becomes "started" or "skipped" with one of three fixed reasons,
never the service's text), `POST /api/trigger/<key>?force=true` only with `force: true`
for the key whose last unforced call was skipped within a minute, `POST
/api/group-presets/<id>/apply`, `POST /api/action/volume` `{room, volume}` per speaker
(a group's per-speaker writes in parallel, line-in, offline and unknown-level speakers
left out; 0 to 100, clamped), `POST /api/action/pause-all`, `POST /api/sleep-timer`
`{minutes, fadeMinutes: 5}` (30, 60 or 90 only), `DELETE /api/sleep-timer/<id>` and the skip
described under "Now Playing". The track's `duration` and `position` (finite numbers, 0 to
86,400 seconds; a zero or missing length gives no time at all, a position past the length is
clamped to it) travel in `nowPlaying` with a flag for a cover address that may be fetched.
Each "asks first" case above answers `needs-confirm` without `confirm: true`. Errors are
fixed strings ("Could not reach Sonos", "Sonos could not do that", "Sonos status is out
of date", "Some speakers did not change"); a failed summary read answers one fixed word
for its kind instead: `timed-out`, `no-answer` or `bad-answer` (the page words them as
above). Writes keep their fixed strings and nothing else is logged. Dev mocks
(`bridge/devMocks/sonos.ts`) take `?sonos=off|down|sparse|heavy|quiet`, `?where=office|all|common|none`
(the place in use), and `?sonos=timeout|dropped|garbled` (a good first read, then a failed
read and a failed second try of that kind: the dimmed card with its line) or
`?sonos=pending` (the same, but the second try never answers: one failed read waiting,
nothing shown). A dev review frame (`?hz=&at=`) shortens the 5 second wait to a quarter of
a second, so these states show at once in the gallery and the fit check; the real timers
are proven by the unit tests;
`?moods=five|many|none|off|down` sets the mood cards.

**The Sonos log.** `wall2-sonos.log` and `wall2-sonos.log.1` in the app's log folder hold
one line per failed read and one per successful read that took over 2 seconds:
`<failed|slow> <read> <kind> <HTTP status or 0> <milliseconds>`, for example
`failed status timed-out 0 4003` or `slow status none 200 2310`. The read is one of
`status`, `speakers`, `routines`, `groups`, `presets`, `scenes`, `timers` or `lists` (an
answer with too many entries); the kind is `timed-out`, `no-answer`, `bad-answer` or
`none`. Every failed read is written, the optional ones too, so the file shows whether
everything failed at once or only the needed reads did. The file is opened for append and a
start never truncates it. At 64 KB it moves to `wall2-sonos.log.1` (replacing an older
one) and a new file starts, so the two together never pass about 128 KB and the newest
lines are always in `wall2-sonos.log`. A file that cannot be opened, moved or written
loses its lines and never blocks a read. Only fixed words and numbers are ever written: no
room, speaker, routine or track name, no address, no answer text. It exists to tell a slow
answer from no answer: lines with `timed-out` and a time near 4000 mean the service
answered too slowly; `no-answer` with a small time means nothing was listening. If the
amber line shows again, send both files.

### Around the house (Home, right wing)

`home/Chores.tsx` and `home/useChores.ts`: the next open tasks tagged `home` (a
tag, not a list; five rows in view, see "Home round two") from `wall2_tasks_summary({ tag: "home" })`, with "N more can wait"
for the rest. The pill shows the time for a task due later today at a set time, else
its estimate, in a fixed 62 px column; the row's tags sit before it (see "Tags on task rows"). Ticking the circle shows "Done." with the title struck through, an Undo
button and a thin bar for five seconds (`tasks/pendingTick.ts`); only then (or when the
place changes) is the chore saved with `wall2_task_done`, hidden after 2 seconds and the
list read again. Undo puts the row back and saves nothing. A failed save brings the row
back with "Could not complete." and Retry. Read on show and every 2 minutes while visible.
Each read takes a generation number (as in `tasks/useTasks.ts`), and only a read that
started after a tick's save settled may bring that row back, so an older read landing
late cannot restore a finished chore. A failed read after a good one keeps the rows,
dimmed with the count, and puts a quiet amber "Task app not reachable" by the heading.
With every shown chore ticked it says "Loading the next ones" until the refresh lands
("Could not load the next ones" if it fails). "Not set up", "Task app not reachable"
and "Nothing waiting around the house" are one line each. The tick's tap area is the
button itself, 52 by 44, inside its own row; titles stay on one line with an ellipsis.
Clicking a chore's title (not its tick) opens it in the task app with
`wall2_open_task` (see "Task card").

**Fit check** (not run by CI, it needs a Chromium binary):
`node scripts/home-fit-check.mjs /path/to/chrome [shot.png]` (or `CHROME=... npm run
fit:home`) builds a development bundle, opens Home at 16:36 in headless Chromium, gives
every chore a long title and checks that the right wing stays inside the 490 px band,
that titles stay on one line, that three alert rows show and that no two tick hit areas
overlap. It prints what it measured and exits 1 on any failure. `npm run fit-check`
checks the Home centre too: the mood row and every part of the Sound card inside the
band with Sound at its fullest (many moods, many speakers, long names, a sleep timer),
typical, sparse, not reachable and not set up, the one status card when both sources are
out, and the Speakers and More pop-outs open.

## Run and build inside Tauri

`src-tauri/tauri.wall2.conf.json` is a second Tauri config. It overrides only
the product name ("Ridgeline"), identifier, version, the `build` block
(dev URL `http://localhost:1421`, build commands, `frontendDist` at
`wall/dist`), one window (label `wall2`) and the `bundle` icons and installer
settings described below. Everything else comes from `src-tauri/tauri.conf.json`.

**Window.** The window is labelled `wall2` and gets its own narrow capability,
`src-tauri/capabilities/wall2.json` (`core:default` only; the old `default`
capability is not loaded). This limits core and plugin permissions only; the
app's own commands stay callable from Ridgeline until a later change adds a command
list in `build.rs`. It is borderless, not resizable, not always on top
and not in the taskbar; the tray icon shows it ("Show Window" or a left click)
and quits it, and its tray menu has no "Toggle Fullscreen". At startup Rust
sizes it to the monitor that is exactly 2560 by 720 physical pixels, else the
monitor with the smallest height, else the primary monitor. When a monitor is
added or removed it moves back onto an exact 2560 by 720 monitor if one is
present. If none is, it stays where it is, and the stored target is cleared so
a DPI change cannot push the window back to coordinates that are now off
screen; it re-places itself when the strip returns.

**Placement and its log.** `src-tauri/src/wall2_window.rs` lists monitors with
Win32 and places the window with `SetWindowPos` on its handle: move onto the
monitor, set the full rectangle, read it back, retry up to 3 times. A window
subclass (Ridgeline only) re-applies the target after every `WM_DPICHANGED`, since
a display scale change while crossing monitors can otherwise undo the move. At
startup it places hidden, shows, places again, then re-checks at about 250 ms,
1 s and 3 s. Every step is written to `wall2-placement.log` (truncated at each
launch, about 256 KB at most): Windows build, DPI awareness, each monitor
(name, position, size, work area, DPI, scale, primary), the chosen target and
why, the window rectangle, client size, DPI, scale and visibility after each
step, DPI changes, and Moved, Resized and ScaleFactorChanged events for the
first 30 seconds. It holds no user, host or token data. To find it, paste this
into the Explorer address bar:

```
%LOCALAPPDATA%\com.havens-consulting.widget-wall2\logs
```

```bash
npm ci                  # root install, provides the Tauri CLI
npm --prefix wall ci    # dev:wall2 starts Vite from wall/, so install it first
npm run dev:wall2       # tauri dev with the second config
npm run build:wall2     # tauri build with the second config (installers)
```

`build:wall2` runs `npm --prefix wall ci && npm --prefix wall run build` first.
The old app is unchanged: `npm run tauri build` still builds "Widget Wall".

**Installer files.** `build:wall2` writes `Ridgeline_<version>_x64-setup.exe` (NSIS)
and `Ridgeline_<version>_x64_en-US.msi` under `src-tauri/target/release/bundle/nsis/`
and `.../msi/`, next to `widget-wall-desktop.exe` (the executable keeps the crate's
name). CI uploads all three as the artifact `widget-wall-2-windows`; the artifact
name did not change with the product name.

**Icon.** The icon set is in `src-tauri/icons-ridgeline/` (`icon.svg` is the
source; `make_icons.py` redraws the PNGs and `icon.ico` from it, see its header).
`tauri.wall2.conf.json` points `bundle.icon` at it. The window icon and the tray
icon are the first frame of the first `.ico` in that list, taken as one bitmap
that Windows scales for every size it needs, so `icon.ico` stores its 32 px frame
first (then 16, 24, 48, 64 and 256); a 16 px first frame, which is what Tauri's
own icon command writes, would be stretched and blurry. The executable's own
icon is the same file, and Windows picks the best frame for each size there. The old app's `src-tauri/icons/` is not used by this build.

**Name, identifier and your data.** Renaming changes the name only. The app
identifier (`com.havens-consulting.widget-wall2`) is unchanged, and Tauri keys the
config folder (`feeds.json`, `meet.json`, the keys file), the local data folder
(web view storage, so saved settings and local storage), the cache and the logs
folder by the identifier, not by the product name. The Credential Manager entries
for Spotify and Microsoft sign-ins are named `WidgetWall2/<service>/...` by the
code, not by the product name. None of them move.

**Installing over an existing "Widget Wall 2".** The bundler derives the install
folder, the Installed apps entry and the Start menu and desktop shortcuts from the
product name, and the default MSI upgrade code from `<productName>.exe.app.x64`.
So a plain rename would install a second app beside the first. Two settings
prevent that:

- `bundle.windows.wix.upgradeCode` is set to the code the old name produced
  (`45c8f91e-8224-55fe-92ae-75e0e555cffa`), so the new MSI upgrades an old MSI
  install of Widget Wall 2.
- `bundle.windows.nsis.installerHooks` loads `src-tauri/ridgeline-installer-hooks.nsh`.
  Before installing, it finds an old setup.exe install through the old name's own
  registry keys and runs only that install's `uninstall.exe`, silently and in update
  mode (which skips deleting app data). Once the old uninstall entry is gone, it
  also removes the old Start menu and desktop shortcuts and the old install-folder
  key, which update mode leaves behind. Nothing is done if the old install is not
  there. The app itself creates no sign-in (Run) entry; the hook only moves an
  existing Run entry that pointed exactly at the old exe to the new name.

Only like for like replaces the old install: the new setup.exe replaces an old
setup.exe install, and the new MSI replaces an old MSI install. An MSI followed by
the setup.exe (or the reverse) leaves two entries; then remove the old one in
Installed apps.

If the old install cannot be removed (the uninstall fails, or its Installed apps
entry is still there afterwards), the installer shows one message and installs
Ridgeline beside it. It never aborts, and the installer itself removes nothing in
that case (the old uninstaller may already have partly run before it failed). Remove Widget Wall 2 afterwards in Windows Settings, Installed apps.

The silent old uninstall closes every running `widget-wall-desktop.exe` of the
current user, which includes the first app ("Widget Wall"), since both use that
file name; start it again afterwards.

After the first install, Installed apps should show one entry, "Ridgeline". If it
also shows "Widget Wall 2", uninstall that entry and leave the "delete the
application data" box unticked. A pin on the taskbar cannot be moved from the
installer: unpin the old icon if you had pinned it, and pin Ridgeline.

## Where things are

- Design surface: `wall/src/stage/fitScale.ts` holds `STAGE_WIDTH` (2560),
  `STAGE_HEIGHT` (720) and the pure `fitScale(windowWidth, windowHeight)`. The
  scale is `min(width / 2560, height / 720)`, exactly 1 at 2560 by 720.
  `wall/src/stage/Stage.tsx` applies it with a CSS transform and recomputes on
  resize. Lay out everything in design pixels inside the stage.
- Horizon: `wall/src/horizon/`. See "The horizon" below.
- Tokens and fonts: `wall/src/styles/tokens.css`, fonts and their licences in
  `wall/src/assets/fonts/`.
- Rail and places: `wall/src/rail/Rail.tsx`, store in `wall/src/state/places.ts`.
- Clock: `wall/src/clock/` (takes an injectable `now`).
- Tests sit next to the code as `*.test.ts(x)`.

## The horizon

A painted west view from across a lake: Olympic mountains, a small Seattle
skyline, the lake in front. It is drawn on one canvas by `HorizonCanvas.tsx`.

- **Renderer.** `renderer.ts` is the original hand-tuned drawing code ported to
  TypeScript. The maths and every constant are unchanged, so treat it as art, not
  as code to tidy. `draw(ctx, HorizonDrawOptions)` documents every option.
  The terrain (public elevation profiles) is one panorama, `terrain/pano.json`, from
  azimuth 128 (Rainier, to the south) round to 300 (the Olympics, to the west). The
  older single views `terrain/west.json` and `terrain/south.json` are imported only by
  `pano.parity.test.ts` (through `registerTerrain`), so they are not bundled; that test
  checks the panorama draws within 0.5 percent of the stage height of them for 99
  percent of the skyline (the worst sample is 4.1 px, on a cliff on Unwind).
- **Public API.** `index.ts` exports `drawHorizon(ctx, options)`, `HorizonOptions`,
  `sun`, `when`, `CAMERAS` and `blendCamera`.
- **Cameras.** `cameras.ts` holds one framing per place (`work`, `home`,
  `unwind`). Changing place glides the camera there over 1.6 seconds with a cubic
  ease (`blendCamera(from, to, t)`); the glide starts from wherever the camera is,
  so interrupting it is smooth.
- **Morning view.** On Home, from 5:00 AM up to 11:30 AM local time, the camera swings
  south to Mount Rainier (`HOME_MORNING` in `cameras.ts`: azimuth 132 at the left edge,
  42 px per degree, terrain exaggerated 1.9, horizon at y 582 like Home's west view,
  snow line 0.86 against 0.84 on the west presets, and no ripple). Every camera looks at
  the same panorama, so the turn is a camera move, never a fade. The first turn from a
  west camera to Rainier each local day (used up once it passes half-way, so tapping away
  sooner keeps it; kept in memory, so a restart may play it again)
  is the cinematic move (`cinematicCamera`): 4.6 s, every number on a sine ease
  `0.5 - 0.5 cos(pi k)`, plus a pull-back (`ppd - 10 sin(pi k)`) and a lower horizon
  (`hy + 14 sin(pi k)`), so it widens mid-turn and then pushes in on the mountain. It is
  clamped to the panorama (`az0` at least 128.3, right edge at most 299.8). Later turns
  that morning and the 11:30 AM turn back use the plain glide: any move of more than
  40 degrees (`SWING_DEGREES`) takes `SWING_SECONDS` (3.2 s, cubic ease) instead of 1.6.
  The length comes from the move's logical ends (the camera it was heading to and the new
  one), so a turn back that interrupts another move part-way still takes the full 3.2 s.
  Seattle slides out to the right on the way round and back in on the way back. The clouds
  turn too: `HorizonCanvas` passes the renderer `cloudShift = (221.5 - az0) * ppd * 0.35`
  (`cloudShiftFor`), so they slide the same way as the land at about a third of its speed
  and wrap round the stage; on the Work camera the shift is 0 and the clouds sit as before. The rest
  of the day Home keeps the west view. `homeCameraFor(date)`
  holds the rule and `cameraFor(place, ms)` applies it to Home only; Work and Unwind never
  change. `HorizonCanvas` looks again once a minute, so 5:00 AM and 11:30 AM take effect
  while Home is open.
- **One canvas, no cross-fade.** Every camera is on the one panorama, so every change of
  view, entering Home in the morning and 11:30 AM passing included, is a camera move on a
  single canvas. The ripple has a camera gate (`stepEchoGate` in `echo.ts`): a move to a
  camera with `ea` 0 (Rainier) ramps it out over its first 0.6 s, it stays off while Rainier is
  the view and while the turn away runs, and it ramps back in over 0.6 s once that turn
  settles. So the filled echo never crosses Rainier and never pops. Reduced motion and the review still
  switch instantly.
- **Real time.** The sun, sky and city lights come from `Date.now()`, passed in
  as the `now` prop of `HorizonCanvas` (inject one in tests). The hour is never
  taken from the place. The music ripple (`echo`) and the moon are
  passed in as options; see "Audio, ripple and moon" below.
- **Frame loop.** About 30 frames a second on `requestAnimationFrame`, none while
  `document.hidden` (`pacing.ts`). The backing store is stage scale times
  `devicePixelRatio`.
- **Sky layers** (`sky.ts`). A screen that puts a picture in the sky (Watch) holds a claim
  with `useSkyClaim(id, claim)`: `front` (an element), `boxes` (stage rectangles its picture
  covers), `clear` (stage rectangles of cards the moon keeps clear of) and `noMoon`. A card
  claims its own drawn box with `useSkyKeepClear(id, element)` (read again when its size
  changes). An element no longer in the page is no host: the main canvas then draws the whole
  picture that frame, and `useSkyClaim` replaces the claim without it as soon as it leaves the
  page. While a claim gives an element, `HorizonCanvas` mounts a second canvas
  in it (`.horizon-front`, fixed to the stage so it covers it whatever the element's box, taking
  no pointer) and each frame draws the sky on the main canvas (`draw` with `part: 'sky'`: the
  sky, stars, moon, sun and clouds) and the ground on the front one (`part: 'ground'`: the
  ranges and their lines, the ripple, the city, the shore, the haze at the horizon, the lake
  with its lights and reflection, the grid and the grain, on transparency). The two parts make
  exactly the whole picture's canvas calls (a test), so outside the picture nothing changes.
  Two page layers sit between the canvases: the place veil (`.veil`), which the front canvas
  lays on its own pixels (`veil.ts`, 'source-atop', stops checked against frame.css), and the
  rail, which the front canvas would cover: it is cut at the main area's left edge
  (`MAIN_LEFT`) and the main canvas takes the ground left of it, copied from the front one.
  The front canvas follows the same frame loop, resize and camera glide, rests with the main
  one and draws nothing while the page is hidden. With no claim there is one canvas and the
  calls are the golden ones (a test, and gallery stills of Work, Home, Meet and Unwind compared
  pixel for pixel). The pixel proof in `npm run fit-check` draws Unwind at night, at dusk and at
  noon on one canvas and with the front layer claimed by an empty host in the main area, nothing
  between the two, and compares the screenshots pixel for pixel over the whole stage: 0 pixels
  may differ. Per frame with the layer on nothing is allocated for it (one options object, its
  `part` set before each draw; the sky part makes no rim gradient or glitter) and the veil's
  strength is read only when the front canvas comes and through a place change's transition.
  Dev builds only: `?sky=front` mounts the front canvas everywhere, `?sky=flat` never,
  `?sky=empty` claims it with an empty host (the pixel proof), `?skymoon=x,y,r` puts the moon
  at one place only (fit-check breaks and cost measurement).
- **Reduced motion.** With `prefers-reduced-motion: reduce` the horizon is drawn
  once a minute and cameras switch without the glide.
- **Review hook (dev server only).** Open
  `http://localhost:1421/?hz=<place>&at=<ISO time>`. The clock freezes at that
  time, the camera jumps to the place and one still frame is drawn with
  animation time 0. `hz` is `work`, `home` or `unwind`. Give the time an offset,
  since a time without one is read in local time:
  - `?hz=home&at=2026-11-11T16:30:00Z` (UTC)
  - `?hz=home&at=2026-11-11T16:30:00%2B01:00` (a positive offset needs `%2B`; a
    bare `+` is also accepted, but `%2B` is the safe spelling. A negative offset
    such as `-08:00` needs nothing.)
  - `?hz=home` follows the morning rule for that time, read in the browser's local
    time zone (not the offset in the URL): `at=2026-11-11T07:12:00-08:00` shows
    Rainier on a Pacific-time machine and the west view on a UTC one. No fade.

  To match the original demo pixel for pixel, run the demo at the same hour and
  camera with its echo ripple off (the moon is on for `unwind`, which the review
  frame draws) and the same animation time, 0.

## The frame and the day ribbon

Every place sits on the concept's one grid (`wall/src/styles/frame.css`,
`wall/src/screens/Frame.tsx`). `Screens.tsx` only picks the place; each place has
its own component and stylesheet (`Work.tsx` with `work.css`, `Home.tsx` with
`home.css`, `Meet.tsx` with `meet.css`, `Unwind.tsx` with `unwind.css`), so a layout
change touches only that place's files. The shared glass panel, type and button classes
(`.panel`, `.k`, `.btn` and so on) still sit at the top of `work.css`.

- **Shell**: inset 20, columns `88px 1fr`, gap 16 (rail, then main).
- **Main**: rows `490px 54px 104px`, gap 16. The top band (`.top`, stage y 20 to
  510) holds the clock and the place's panels, placed inside it. The empty band (y 526
  to 580) shows the horizon and Watt. The ribbon sits at y 596 to 700, over the lake.
  Unwind and Zen use `.main.tall` (one row, no ribbon); Unwind keeps its Tomorrow block
  instead. The clock and ribbon are one tree for every place, so they stay mounted when
  the place changes.
- **Zones**: `.zones` holds the concept's top band columns (`470px 1290px 596px`, the
  in-call `620px 1140px 596px` as `.zones.call`, Unwind's `470px 1fr 540px` as
  `.zones.wide`). Places move into them in their own parity pull requests.
- **Shared numbers**: `screens/frameLayout.ts` holds the shell, row and zone values;
  `frameLayout.test.ts` reads `frame.css` as text and checks it uses the same ones. The
  top band has no padding, so the clock sits at the main area's corner (stage x 124,
  y 20) and the zones end exactly at its right edge (2416).
- **Veil**: one element over the horizon (`App.tsx`), dark behind the panels and 0.3
  of that from the band down. Work and Meet 0.52, Home 0.36, Unwind 0.1. It eases
  between places (no ease when motion is reduced).

The day ribbon (`wall/src/ribbon/`, `styles/ribbon.css`) is on Work, Home and Meet:

- **Hours**: 6 AM to 12 AM, `RX(h) = 72 + (h - 6) * 128` in a ribbon 2416 px wide, a
  tick every hour and a label every two hours. A label within 70 px of the needle hides.
- **Sun**: sunrise and sunset in amber, rounded to the minute, hidden within 90 px of the
  needle. `sun.ts` bisects the horizon renderer's `sun()` for an altitude of -0.833
  degrees (cached per day). For 2026-11-11 that is 7:09 AM and 4:37 PM, matching the
  almanac (the concept's "4:40" was a rounded label). The sky gradient behind the hours
  puts the concept's colour stops on the real sunrise and sunset.
- **Row icons**: the calendar icon and the row 2 icon carry a tooltip naming their row
  ("Today's calendar"; "Agent activity and tasks due today" on Work and Meet, "Home
  tasks due today" on Home). A row says it is empty, in quiet text beside its icon, only
  when that is known: "No meetings today" after a good calendar read with nothing today
  ("Calendar not available" when the read lists accounts and none could be read),
  "Nothing scheduled at home" after a good task read with nothing due, and "No agent
  activity yet" when the helper answered (fresh) with no span today and the task read was
  good with nothing due. Before a read, after a failed read, or when Meet, the task app or
  the helper is not set up, the row shows nothing.
- **Row 1**: today's calendar from `wall2_meet_day`, read when the ribbon shows and
  every 5 minutes while visible, clipped to 6 AM to 12 AM. On Work and Meet the row is the
  calm strip (below); what follows is Home's row. A chip is `past` once it
  has ended, `now` while the needle is inside it, and pink when the event is a
  livestream (`isLive`). Events that overlap in time (one that ends exactly when the next
  begins does not) form a group, and no chip is ever drawn over another: a group of one keeps
  the full row; two or three overlapping stack in lanes of reduced height (two lanes keep a
  13 px title, three are thin bars with the title in the hover); each event takes the first
  lane free at its start. When more than three overlap at once the group keeps two lanes and
  the rest go into one full-height "+N" chip (hover lists them; a click opens a small list to
  pick one to open in Outlook; a chip under it joins the list). All-day events (midnight to
  midnight, or a day or longer) fold into one "1 all day" chip at the start of the row (hover
  lists them, a click opens one in Outlook), so timed events keep the full lane. A chip
  narrower than 44 px shows no title (it keeps its
  hover card and an accessible name); its title is written beside it in the chip's own type
  when the row has room before the next chip (`chipLayout` in `ribbon/model.ts`). Hover on a chip shows its title, time and account;
  a chip whose event Rust holds a web link for (`canOpen`) is a button that opens the
  event in Outlook (`wall2_open_event`, see "Opening an event in Outlook" under Meet).
  Calendar chips are rounded and carry words; the agent bars below are thin and wordless.
  Meet "Not set up" leaves the row empty with no text; any other failed read keeps the
  last good list.
- **After 9 PM** local time the agent bars and the focus bar draw at 40 percent (`.rib.late`).
- **Focus bar** (Work and Meet): today's focus sessions up to now, from the focus store.
  Each start, pause, reset and finish updates `localStorage` key `wall2-focus-day`
  (`{ sessions: [{ start, end }] }`, epoch ms). A running session is saved with its
  planned end, so one that ends while the app is closed is still right; pausing or
  resetting moves the end back. Each write keeps only today's sessions, and the ribbon
  only draws today's, so the bar clears at midnight.
- **Row 2**: its icon (bolt on Work and Meet, house on Home) and a cyan diamond with a
  short title and the time ("Send the proposal, 3:00") for each of the next three tasks
  due at a time today, at that hour. The tasks come from `wall2_tasks_summary`: Work and
  Meet pass `notTag: "home"`, Home passes `tag: "home"`. They are read when the ribbon
  shows and every 2 minutes while visible. All-day and undated tasks get no mark. Not set
  up or a failed read shows no marks. A mark is a button that opens its task in the task
  app (`wall2_open_task`); hover shows the title and due time. Agent bars come with the
  lanes (see Agents), the house schedule with the rooms.
- **Needle**: a white pill with the time, moved on each whole minute while visible.
  Before 6 AM it stays at the left end and still shows the real time. Hover on it counts
  down to the next meeting today ("Next meeting in 1 h 36 m: Weekly planning"), names the
  one in progress when none follows, or says "No more meetings today" after a good read.
- **Hover cards** (`ui/HoverTip.tsx`): the wall's one tooltip, `tip(content)` on any control.
  One small card at a time, drawn inside the stage above what it explains (below when there
  is no room), never over it, with a pixel tail pointing at it; after a 250 ms rest of the
  pointer, gone at once when it leaves, on a press and on any scroll; keyboard focus shows it
  too, but not the focus that follows a click. Its look is Watt's speech bubble shape (square
  corners, a 2 px ring, the pixel tail) in the wall's dark with his lavender as the ring:
  titles 18 px Oxanium, detail 16 px, hints 14 px in cyan, so it reads on the strip at 100
  percent (nothing in a tooltip or in Watt's menu is under 16 px). A card goes when its anchor moves
  more than 4 px, and the focus a menu gives back after a choice opens none. Reduced motion drops
  its fade. Lavender filled bubbles stay Watt's own voice. A shown card is redrawn every 15 seconds (the needle's countdown
  stays right) and closes when its anchor leaves the page. A pinned card (the "+N" chip's
  list) takes the pointer and closes on a click elsewhere or Escape.
- **The calm strip** (Work and Meet; Home's strip is unchanged), still 104 px:
  - *Calendar*: a meeting alone keeps its chip. A run of meetings that overlap in time
    folds into one chip from the run's start to its end, "3 at 1:30" (how many, and the
    latest start in the run) and then as many titles as fit; the count is never cut (the
    chip is at least as wide as its count). Hover lists each meeting with its times; a click
    opens the Day drawer scrolled to that hour. All-day events are a thin bar over the row
    ("All day · Team offsite week"), with the all-day hover and click; the row's chips then
    sit 24 px tall under it (`calmLayout` in `ribbon/model.ts`).
  - *Agents*: a thin activity bar from 6 AM to now in 12 minute cells, each coloured by the
    most sessions working at once in it against the limit (mint 1, cyan 2, violet 3, amber at
    the limit, red over it; over the limit the cell is also 10 px tall instead of 6 and
    hatched, so it never rests on colour alone), with an amber underline where one waited on
    the owner; a cell where nobody worked (only a wait or a review span) is grey. With no known
    limit (an older helper sends none, or a zero) the cells keep their plain cyan look and say
    nothing about a limit. Each cell's hover says how many worked at once then and the limit;
    the row's own hover (the icon) carries a one line key to the colours and the amber
    underline. See "How many work at once" below. One line after the needle: "12 sessions: 2 need
    you, 5 working" ("need you" in amber), or with none waiting "3 sessions: 2 working (1
    through helpers), 1 idle". A chat whose own turn ended while its helpers continue counts as
    working. Review and other idle sessions count as idle. With under 360 px right of the needle it
    sits right-aligned before it. A click on the line or a cell opens Agents today. A stale
    answer is dimmed, its cells end at the last good answer, and the line adds "as of" that
    time. Task marks keep their labels off the bar and the line (diamond only, label in the
    hover). The cells are not controls (no role); the line is the keyboard path.
  - *Handle* (`ribbon/DayLip.tsx`): the strip's whole top edge. One button, 26 px tall and
    the strip's width less 24 px at each end, from 17 px above the strip (the empty gap over
    it) to 9 px inside it, so it ends above the hour and sun labels and the all-day bar; the
    needle's time pill draws over it. At rest: a hairline along the edge and one chevron (at
    the centre, or stepped aside in 40 px steps clear of the labels and the needle's pill).
    Once the pointer has rested in the band for 180 ms a full-width lip lights with the
    chevron and "Open the day" (crossing the edge on the way to a card never flashes it;
    leaving cancels at once; keyboard focus and the open state need no wait); a click anywhere
    on it opens the Day drawer. At rest the band never takes the pointer from anything that
    acts on a click (an agent card, a folded chip, a key, the buddy standing on the edge):
    while the pointer is over such a thing in the band the lip lets it through (`data-pass`)
    and does not light; only the chevron stays a target there. With the drawer open the same
    handle sits on the drawer's top edge (above the scrim, inside the drawer's layer) and
    reads "Close the day". Named "Open the day" or "Close the day"; Enter and Space work.
    Keyboard focus follows the drawer's own rule: into the drawer on open, back to the
    strip's handle on close (the drawer's lip carries `in-drawer`, the strip's does not).
- **Day drawer** (`ribbon/DayDrawer.tsx`): 532 px over the lower part of Work (main area y
  148 to 680), never over the rail or the clock. Left, an agenda from 8 AM to 6 PM (wider
  when a meeting starts earlier or ends later; it scrolls inside), overlapping meetings side
  by side, the now line; a meeting opens in Outlook, with Join (`wall2_meet_join`) where the
  calendar has a join link and the meeting has not ended (Enter or Space on a meeting opens it
  too). Right, one row per open session,
  those waiting on the owner first, then working (including work through helpers), then the
  rest: number, title (372 px, one line, the full title in the hover), the state once as a pill
  (working, helpers working, waiting on you, failed in rose, in review, idle), one quiet line,
  its day as a bar (420 px) and the time
  worked (runs, finished or not; waits and review spans not counted). The quiet line is built
  only from what the helper sends for an open session, joined with a middle dot: its line
  (unless that is only a state word such as "running"), else "Next: " and its next step; how
  long it has waited on the owner; its helpers ("3 helpers, 2 working"); its pull request
  ("PR 553, checks passing"). With none of these it is blank. The header counts what the
  pills say ("10 sessions, 1 need you, 4 working, 1 failed, 4 idle"). A row opens the session
  in OmniGent. "Agents today" in its header opens the panel. Escape, the handle on its top
  edge, Close or a click outside closes it.
  Behind the open drawer (`ribbon/DrawerScrim.tsx`) the page is dimmed (20 percent) and blurred
  slightly (4 px) by one stage-wide shield, and made `inert` (no hover, click or keyboard focus),
  also anything that mounts while it is open. A press anywhere outside closes it (any button) and
  the shield stays up for about a double click, so the rest of that click never reaches what was
  under the pointer. Window listeners that react to a press or Escape (the Tools drawer, the key
  picker, Watt's menu and his click noticing) do nothing while it is up (`overlayOwnsPointer`).
  Focus goes into the drawer and back to the handle on close. The leave banner and the recording
  chip stay above the shield, readable but not clickable. The blur is off under reduced
  transparency and where `backdrop-filter` is missing (the dim is then 30 percent); it was
  measured only in software rendering, not on a graphics card, and is one line to remove.
  The Agents today panel uses the same shield.
- **Agents today** (`ribbon/AgentsToday.tsx`, `ribbon/days.ts`): a panel over the horizon
  (1420 px wide, its bottom just above the strip, rows scroll inside past about eight). One
  row per session: number, title (cut, the full title on hover), stage coloured spans
  (`--st-*`), pull request marks ("PR 552") and an end word, then the time worked; a row
  opens its session. Rows are only ever sessions from the helper's `sessionsList` (parents and
  standalone sessions) or from a saved record (which holds only those, see "Saved records"
  under Agents); an id found only in the live day log or the names map (a child, a side chat)
  never becomes a row. Today reads the live summary: waits are amber and only there, stage
  colours come from today's saved record when the helper has one (a session it does not know
  draws its runs cyan); the totals read "12 h 20 m of agent work across 8 sessions, 2 h 18 m
  waiting on you". The day picker (Today, Yesterday, and arrows through the recorded days,
  disabled at the ends, each naming its date on hover) reads the saved record: no wait spans
  and no wait total on a past day (hidden, never zero). End words: merged
  (`pr.state` merged), carried over (the session's last span has no end on that day),
  pull request open or closed, finished; today also waiting on you, in review, working,
  helpers working, idle. A past day's hours run midnight to midnight in the record's own zone (`tz`). States:
  skeleton rows while loading; hidden button when the helper is not set up; a stale today
  with "As of" its time, never as live; a past read that fails keeps the last good one with
  "As of"; a day list or today's record that cannot be refreshed keeps the last good one with
  a quiet "saved days as of" or "stage colours as of" (the live summary stays live); with a
  good list held a reopen refreshes it in the background; an older helper whose day list
  answers 404 hides the picker and Today still works; an empty day says so. A refused open
  says "Could not open that session". Under the heading, **Busy at once**: the time at 1, at
  2, at 3, at 4 and over 4 sessions working at once, each with its colour swatch, and "Over
  your limit of 4 for 1 h 48 m today" (or "Never over your limit of 4"); the first row,
  "Sessions busy at once", draws the same as stepped bars on the panel's hour axis with a
  dashed line at the limit. With no known limit neither is drawn. On a past day the saved
  record cannot tell running from waiting, so the line reads "Open at once" ("Up to 2 open at
  once, from the saved record"): it counts every session with a recorded span and never says
  "over your limit", and the limit line is left out; its bars and swatches use plain steps
  (never the amber at-the-limit or the red hatched over-the-limit look). A past day's rows have no quiet line (the
  record has none of those fields): the title takes the room (520 px) and the track is 514 px.
- **How many work at once** (`ribbon/busy.ts`; one rule for the header's slot meter, the
  strip's cells and the panel's Busy at once line): a session counts while it is working, a
  `run` span in the helper's live day log (waits and review spans do not count), clipped to
  the day (a span that began before midnight counts from midnight; the spans are built
  straight from the log, not from the strip's layout), and only when it is a parent or
  standalone session the wall knows today (a card, or a session in today's saved record, read
  at once when the day log first shows a run of a session that is not on a card, and once per
  such id after that, never on a timer). A finished run counts for the time it ran; an open
  run is open only while its session's card says working: its own turn runs, or its own turn is
  idle while a background agent, background command or child session still runs. Waiting and
  failed sessions do not count. An idle-own-turn run is capped at 12 hours; an active own turn is not.
  When the card stops working with the run still open (or the session closes), the run is
  kept and ENDED where the session stopped, never dropped, so past work stays in the strip's
  cells, the Busy at once sums, the header's Today line and the panel and drawer rows, while
  the count for now stays the cards that say working. The end is, in order: the helper's own
  idle or waiting seconds counted back from its answer; else the last time this wall saw the
  card working (kept per session id for the day in local storage, ids and times only, so a
  reload keeps it); else the latest stamp the day log gives for that session; else the run's
  own start (a session the wall never saw working counts no time, not invented time). A child or a side chat never counts on its own, so a
  session and its helpers count once; two spans of one session at the same time count once. A
  cell takes the most at once inside its 12 minutes. The meter shows the count now: the
  server's own `busy` count when the helper sends one, then the older `working` count (by construction it equals the log's
  open runs of working cards), else the log's count, else `used`. The limit is the helper's
  `slots.limit`; a missing, zero or negative one is unknown: the meter shows the honest count
  ("N working"), and no pips, steps, limit line, "over" tag or count colours are drawn. A
  saved past day has stage spans only, no runs and no waits, so there a session counts while
  it has a recorded stage span, and the panel says so. Colours by step: 1 mint, 2 cyan, 3
  violet (any count from 3 up to one under the limit), at the limit amber, over it red and
  hatched (`--busy-*` in `styles/ribbon.css`).
- **Saved record commands** (`src-tauri/src/wall2_omni.rs`, the section at the end), both
  gated to the wall window, https only, read through the 64 KB cap, errors `not-configured`,
  `invalid-config`, `failed`, nothing logged:
  - `wall2_omni_days` reads `GET /wall/v1/days` and returns `[{ date, sessions }]`, at most
    400, any entry whose date is not a real calendar date dropped. A 404 (an older helper)
    is `absent`; any other failure is `failed`.
  - `wall2_omni_day(date)` refuses anything but a real `YYYY-MM-DD` date (`invalid-date`)
    before any request, reads `GET /wall/v1/day?date=`, and returns `{ date, tz, sessions:
    [{ id, title, spans: [{ stage, start, end }], pr: { number, state } | null }] }` or null
    for a 404. Ids follow the session id rule, titles at most 60 characters, stages
    `plan|build|review|pr|live`, stamps RFC 3339 and at most 30 characters, at most 200
    sessions and 200 spans each, pull request states `open|closed|merged`; anything else is
    dropped. A record of another date fails. Each read keeps that date's session ids (the
    last eight dates read), so answers landing out of order never authorise the wrong day;
    the day list never clears them.
  - `wall2_focus_day_session(id, date)` opens a session from the saved record of `date` and
    brings OmniGent forward as `wall2_focus_omnigent` does: the date must be a real date and
    the id must be in the last read of that date's record. The page still never supplies a
    URL.
- **Dev**: the calendar comes from `src/bridge/devMocks/meet.ts` (`?meet=overlap`: three
  meetings overlapping at 1:30 and an all-day event); the saved record from
  `src/bridge/devMocks/days.ts` (`?days=typical`, `empty`, `one`, `heavy`, `down`,
  `absent`). A review still
  (`?hz=<place>&at=<ISO time>`, dev builds only) opens on that place, freezes the clock
  and ribbon at that time, puts the meet and task mocks' days on the review's date, and
  `src/ribbon/devMock.ts` adds the concept's two focus sessions if none are saved for
  that day.

## The Work tab

`wall/src/screens/Work.tsx` lays Work out on the concept's zones (`f_work`): left
wing 470, centre 1290, right wing 596 design pixels, 30 apart, over the whole top
band. The clock and date stay the frame's (`Frame.tsx`); the left wing starts under
the date line. One weather read (`useWeather`) feeds both the line after the date and
the centre card; the date line takes it through the frame's `ClockSlot` portal.

- **Left wing** (`wall/src/work/LeftWing.tsx`), top to bottom:
  - the weather after the date: icon, temperature and a short condition ("58°,
    clearing"), `WeatherLine` in `weather/WeatherCard.tsx`, empty until a reading and
    hidden while the reading is stale (the line has no room for its age);
  - **Next**: the first meeting that has not ended, from `wall2_meet_next`
    (`work/useNextMeeting.ts`: read on mount and every 5 minutes while visible, the
    time ticks every 30 seconds), written as "12:00, in 1 h 36 m", "now, 12 m
    left", "tomorrow 9:30" or "Friday 9:30" (`work/next.ts`; whole hours read "1 h"). Hidden
    when Meet is not set up, when the first read fails, and when there is no meeting.
    When the feed marks the list `stale` or a refresh fails, the last list stays,
    dimmed, with no countdown (only the time: "12:00", or "10:00 to 10:36" once it has
    started) and a quiet "as of H:MM" (the last complete read; "may be out of date" if
    there has been none);
  - **Focus** (`FocusMini` in `focus/FocusTimer.tsx`), hidden while the centre shows the
    Focus card (no agent sessions; `useCentreShowsFocus`), when Next's title may take a
    second line instead: a 60 pixel ring with the
    minutes left, the task label (or "Ready to focus"), and one round button: start,
    pause or resume. Tapping the ring while no session runs opens a sheet with 25, 50,
    Custom and "Start N min"; a session started elsewhere closes the sheet;
  - **Now playing** (`MusicMini` in `music/MusicBar.tsx`): art, title, artist and
    Previous, Play or Pause, Next (always shown, all disabled when nothing plays; a long
    title is cut and carries its full text on hover), from the same app-wide poll as the
    music bar;
  - **Machines** (`wall/src/machines/`, owner vote A, "whisper bars"): a header row
    (CPU, GPU, RAM, TEMP) and two thin rows, PC and LLM (the second machine's name is the
    one constant `BOX_LABEL` in `machines/model.ts`), each with a temperature, from
    `wall2_machines` every 2 seconds while visible (one read at a time, nothing while
    hidden; a read that takes over 5 seconds counts as failed, only the read holding the
    busy flag clears it, and the answer of a superseded read is dropped). Grey by
    default. A number turns amber only after it stays over its limit
    for 30 seconds (RAM over 90, CPU or GPU over 95, either temperature over 90 degrees). The PC's temperature is the graphics card's, read
    through NVML in Rust (no processor temperature: that needs a kernel driver, which the
    repository forbids); no NVIDIA card or a failed read shows a dash and keeps the column;
    a dip back under starts the 30 seconds again, and a gap of more than 6 seconds
    between reads (hidden, slow) does too. Stale box numbers never count toward the
    hold. With no box numbers (null) the LLM row stays, dimmed, and says "no reading", so
    it is clear the row exists; it fills in when the helper answers. It is dimmed when
    `boxStale`. A column with no reading (often the box's GPU) shows a faint empty track
    and no number. Nothing shows when the command fails.
  - Round buttons in the wing (Focus and the three music buttons) share one 44 pixel look, with a round focus ring and no touch padding.
  - Next, Focus and Now playing stack from the top with even air (12 px, 22 px without
    Next); the machines sit on the band's foot. With no meeting to show the rows close up
    under the date and the machines grow (larger numbers and taller rows) into the room
    that leaves.
- **Centre** (`wall/src/agents/CentreSlot.tsx`, the one place that decides what it
  shows): the agent lanes while the helper answers (see "Agent lanes" under "Agents").
  Otherwise the full focus timer (640 px) and the weather card (now, today's range, the
  next six hours) fill it, so it is never an empty card. Each card starts right under its
  heading and fills its box: the focus ring takes the height between the heading and one
  row of 40 px controls at the foot (Start, Pause or Resume, Reset, and the 25, 50,
  Custom picker), the task's name wraps to two lines before an ellipsis, and the hour
  tiles stretch to the card's foot. When the helper cannot show, a quiet header row sits
  above the cards where the lanes' header goes: "Agents  not set up" when `feeds.json`
  has no helper address, or "Agents  not reachable" (amber) with a "Try again" link that
  reads once at once, when it has one but no answer has come yet. The zero-lane state
  shows the same cards, tighter. Before the first weather reading, or when the first
  fetch fails, the focus card takes the whole width with the weather status as one line
  inside it.
- **Fit check** (`wall/scripts/fit-check.mjs`, `npm --prefix wall run fit-check` with
  `WALL_CHROME` set to a Chromium or chrome-headless-shell binary): builds a development
  bundle, opens Work with the longest mock strings (`?long=1`) in a 2560 by 720 viewport
  and fails if a wing, the centre or anything checked inside it scrolls, sticks out of its
  container or the viewport on any side, or if the page itself scrolls. The centre is
  checked with three lanes with long titles, one lane, no lane, and the fill
  (`?agents=3`, `1`, `0`, `off`). `-- --overflow=left|right|top|bottom|page` breaks the
  layout on purpose and must fail; `-- --self-test` runs every such case and passes only
  if each one failed with the FAIL line for the side it broke. jsdom has no layout, so the unit tests cannot check this; CI does
  not run it either.
- **Review script areas** (`wall/scripts/areas/`): new gallery states and fit-check
  variants, measurements, rules and deliberate breaks live in one area file. Both scripts
  discover the files in sorted order and reject duplicate state names, measurement keys,
  rule keys and break names. Use `-- --area=<name>` with either script to run only one area.
  See `wall/scripts/areas/README.md` for the complete interface and examples.
- **Browser time limit** (`wall/scripts/lib/chrome-run.mjs`): the one-shot browser runs of the fit check, `fit:home`
  and `echo-calm` stop after 45 s (90 s for `fit:home`, 240 s for `echo-calm`), kill only the browser they started (its own process group while it runs; afterwards, on Linux, any child left in that group, by its own pid), remove its temporary folder and try again, three tries in all; `WALL_CHROME_LIMIT_MS` replaces the limit of every one of them, those two included. The
  gallery restarts its browser once for a state that timed out and retries the states that were waiting on it. `npm --prefix wall run chrome-run-test` proves it (Linux; set `WALL_CHROME` to add a real page).
- **State gallery** (`wall/scripts/gallery.mjs`, `npm --prefix wall run gallery` with
  `WALL_CHROME` set to a Chromium binary): renders every screen (Work, Home, Unwind, Meet,
  Zen, Dream and the morning Home camera) in sparse, typical, heavy and broken data states and
  at four times of day, at 2560 by 720, in real time. Writes PNG stills, `index.html` (grouped
  by screen, with each state's name and URL) and `manifest.json` into `wall/.gallery/`
  (ignored by git). Exits non-zero if a state fails to render or throws a page error.
  `-- --list` prints the states; `-- --only=<text>` renders the states whose screen or name
  contains the text. States come from URL knobs in the development mocks: the older `?hz=`,
  `?at=`, `?agents=`, `?long=1`, `?audio=demo`, and the newer ones in
  `src/bridge/devMocks/gallery.ts` (`screen`, `tasks`, `meet`, `home`, `net`, `moods`, `media`,
  `box`, `pc`, `usage`, `weather`, `focus`, `clock`). None of it is in a production build.
- **Right wing**: Due today, a small scrolling list (see "Task card" below), then the key deck: Always
  here and Now (see "The key deck").

- **Focus timer** (`wall/src/focus/`). A ring with the minutes left in the
  middle (the full card in the centre, the small row in the left wing). Choose 25, 50 or custom (5 to 120 minutes, steps of 5). Start, pause,
  resume, reset. The state is stored in `localStorage` key `wall2-focus` as an
  end time, so a restart resumes and a timer that ended while the app was closed
  shows as finished. The state lives in an app-level store (`store.ts`) with its
  own end timer, so the timer finishes and releases Do Not Disturb on any screen
  and while hidden (a soft glow on the ring, no modal, no chime yet). Do Not
  Disturb follows the old app's rule (`dnd.ts`): read the state at start; if it
  is already on, leave it alone; otherwise turn it on and remember that focus did
  it (key `wall2-focus-dnd`); turn it off on pause, reset, finish and app start
  only if focus turned it on. Calls run one at a time through a queue.
- **Weather** (`wall/src/weather/`). Read natively: the web view never calls a weather
  service (its security policy no longer lists one). The command `wall2_weather(latitude,
  longitude, source)` (window `wall2` only; `source` is `open-meteo` or `nws`; the place must
  be finite and in range) lives in `src-tauri/src/wall2_weather.rs` on the shared HTTP agent and
  returns the reply text, or fails with `dns`, `connect`, `tls`, `timeout`, `read`, `input` or
  `http <status>`. The page parses it. Open-Meteo is the first source (same request as the old
  app: Fahrenheit, mph, `timezone=auto`). When it answers 429 or cannot be reached, the United
  States National Weather Service (`api.weather.gov`, no key, `points` once and cached, then the
  hourly forecast and the 12 hour forecast; the app and the public repository named in `User-Agent`)
  is asked: its short forecast words map to a weather code through one table (`NWS_TABLE` in
  `model.ts`, a test per row; haze and smoke read as fog, a wintry mix as sleet, frost as clear),
  "now" is the first hour, today's high is the 12 hour forecast's daytime period of today and the
  low its night period. Once today's daytime period has passed (the forecast starts at "Tonight") the
  high is the larger of the temperature now and the highest reading the wall has seen today (kept
  in memory with its date; after a restart in the evening that is the temperature now). Outside
  the United States it answers 404 and the first failure stays. A reading says which source it came
  from (`source`): the Tools Sources row and the Unwind date line's hover name the Weather Service
  when it is the one. Current temperature, condition with an icon, today's high and low, next six
  hours. Refreshes every 15 minutes while visible (one minute while there is no reading), and once
  when the page returns after 15 minutes or more. After a 429 Open-Meteo is left alone for 15
  minutes, then 30, then 60 at most (only a scheduled try that meets a 429 advances the wait; a success
  resets it; the Tools drawer's Retry tries at once and never lengthens a wait that is running),
  and the words say so ("Open-Meteo is refusing this address for now (too many requests). Next
  try at 3:15 PM."). On failure the last reading stays and shows its age in small text. The reason
  for a failed read with no reading is printed under "Weather unavailable" on the Work cards (16 px)
  and kept on hover elsewhere. The code to label and icon map is one pure function, `describeWeather`
  in `codes.ts`.

  **The weather log.** `wall2-weather.log` and `wall2-weather.log.1` in the app's log folder (same
  rotation as the Sonos log: append, 64 KB, one older file, shared code in `wall2_sonos_log.rs`) hold
  one line per failed try and one per recovery: `<UTC time> <open-meteo|nws> failed <kind> <status>
  [<reason>]` or `<UTC time> <source> recovered`. For an HTTP failure the first 120 characters of the
  reply's `reason` text are kept (Open-Meteo says which limit: minute, hour or day), as ASCII letters and
  single spaces only: every digit, sign and punctuation mark is dropped, so a place can never pass as
  numbers. The place is never logged.
- **Music** (`wall/src/music/`). One app-wide poll (`store.ts`) shared by Work's now
  playing row, the full music bar and the Unwind view: it polls `get_now_playing` every 2 seconds
  while visible (never while hidden); each call gives up after 5 seconds so a hung
  call cannot stall the loop, and a late answer is dropped. Art only from `album_art_base64` with an
  allowed mime (png, jpeg, webp, gif); `art_unchanged` keeps the current art. Each poll
  sends `artFor`, the `art_key` of the art it holds (empty when it holds none), and Rust
  skips the art only while that key matches the track, so a cover is never lost to a
  reload or a dropped answer; a track that came without art is asked again every 10
  seconds (players often add the cover late). A cover that arrived but was refused (a
  type outside the list, bad base64, or an image that fails to decode) is remembered by
  its `art_key` and never asked for again. Without `artFor` (the first wall) Rust
  keeps its shared last-sent key as before.
  Previous, play or pause, next call `media_previous`, `media_play_pause`,
  `media_next`; failures are swallowed. Stopped or unknown shows a quiet
  "Nothing playing".

  **Which session the player follows (Wall 2).** Windows names one media session "current", but
  that one can have ended while it still says it plays (a video at its end, a player that stopped
  sending updates) while another app plays. `get_now_playing` for the `wall2` window reads every
  session and `wall2_media.rs` picks: the current session when it plays and has not ended; else
  any other session that plays and has not ended, the most recently updated first; else the
  current session; else none. Which listed session is Windows' current one is decided by identity
  (the `windows` crate compares session objects by COM identity; when the manager hands out another
  wrapper the app id decides, and with several sessions of one app their title, timeline and status).
  Each listed session has a key, its app id and its place among the sessions with that id in list order
  (`Example.Browser#0`, `Example.Browser#1`: two tabs of one browser are two sessions), sent as
  `session_key`. A session has ended when it says playing, its end is known, and
  either its position plus the time since its last update is past the end by more than 3 seconds,
  or its position stayed within 1 second of the end on two reads at least 3 seconds apart (kept
  per session key, forgotten when its last observation is over 10 seconds old, such as after the page
  was hidden). An ended session that is shown anyway is reported paused with `ended: true`, so the
  player reads "Last played" with the play button, never a full bar with pause. The first wall
  (window `main`) still gets Windows' current session unchanged. The media commands take the
  shown session's key and app id (`sessionKey` and `sourceId`, sent by `sendMediaCommand` in
  `music/store.ts`, captured when a click starts) and, from the `wall2` window only, act on the session
  with that key, else the first with that id, else on the current one. The Up next rows skip the way the
  player row's Next does: Spotify's own command when Spotify reports a player, else the media key to the
  session captured when the click began. In `Player.tsx` the session is the
  wall's own Watch video when its title is what Watch plays or last stopped and its id is the web
  view (`msedgewebview2`) or not a known player (`isKnownPlayer`). The log `wall2-media.log`
  (same rotation) holds one line when the set of sessions or the choice changes: `<UTC time>
  rule=<current-playing|other-playing|current-shown|none> chosen=<key> sessions=<key>:<status>;...`
  (keys cut to 80 characters, `:ended` for a session that plays but ended, `:current` for Windows'
  choice; no titles, no artists). Review knob `?media=ended` shows an ended session.
- **Settings** (`wall/src/settings/`). `localStorage` key `wall2-settings`, JSON
  with optional `latitude` and `longitude` (defaults 47.68, -122.21), `zenDimHour` (whole
  hour 18 to 23, default 22) and `zenDimWaitMin` (whole minutes 1 to 60, default 10). No settings
  screen yet; Zen shows the two Zen values as a quiet line in the evening.
- **Browser dev.** `npm run dev` registers mocks for the commands Work calls
  (`src/bridge/devMocks/`, dev server only); in a review still (`?hz=&at=`) the
  meeting and task mocks follow the review's time. Review knobs: `?meet=none` (no
  meetings), `?box=none` (no box numbers), `?net=alarms` (the network feed with only
  its alarm count). The weather command is mocked (`devMocks/weather.ts`); review knobs
  `?weather=ok|stale|down|cold|dns|refused|second` (see `devMocks/gallery.ts`).

## Audio, ripple and moon

- **Audio** (`wall/src/audio/`). At app start inside Tauri, `capture.ts` asks Rust for the
  default loopback device, starts capture and listens to the `audio-levels` event (never
  `window.__TAURI__`). `store.ts` keeps smoothed `bass`, `mid`, `high` (0 to 1) and
  `playing`, which is true while sound arrived in the last 0.35 seconds; levels fall away
  once it is not. Silence is decided by the clock, never by counting events. The push is
  turned off with `set_audio_push(false)` while the page is hidden and on again when it
  shows. If the first start fails it stays silent and retries once after 30 seconds; if no
  event arrives for 5 seconds while visible it restarts capture once (once per app run, by design).
  It also keeps the newest 32 `bands`, normalised 0 to 1 from the event's 0 to 255 bytes
  (`audioBands()`, a fixed array written in place), and feeds them to the beat detector on
  each frame's source time (`sourceTime.ts`). The event carries no capture time, and frames
  that queue behind a stalled web view arrive in a burst: a frame less than 16 ms after the
  previous one is stamped 33 ms after it; otherwise it takes its arrival time (or, while still
  ahead after a burst, the previous stamp plus the real interval, capped at 33 ms, so time never
  runs backwards); a frame more than 200 ms ahead of the clock is dropped. Silence is still
  judged on arrival times.
- **The dance** (`audio/dance.ts`, `danceHistory()`, `danceKick()`). The smoothed band level stays
  nearly flat on finished music, so the lines do not follow it alone. A second history in step
  with the first (one row per row) holds line heights shaped from the raw bands: per band a
  smoothed level (0.06 s up, 0.35 s down), a fast follower (0.025 s up, 0.2 s down) and a slow
  average (1.2 s); a transient is the fast follower over the slow one by more than 0.03; half the
  mean transient of all bands is taken off each (so a bar where everything rises adds little);
  that is divided by a running peak of the largest such transient (falls with a 4 s time constant,
  never under 0.07), so quiet music still reaches the top on its hits. Height is
  `soft(level * 0.32 + hit * 1.35, 1.8)` with `soft(x, L) = L * tanh(x / L)`, where `level` is the
  band lifted off `BAND_FLOOR` and scaled to 1.3 as above. The kick is the largest raw transient
  among the six lowest bands against its own running peak, raised to 1.5, zero under 0.04, then a
  follower (0.02 s up, 0.26 s down): one number, 0 to 1. The settle and lift rules
  (`musicDriving`, `BAND_FLOOR`, `REST_RESUME`) still read the raw bands. Silence, a pause
  (`pauseDanceHistory`), a hidden page and a whole ring of silence clear the shaped state, so no
  stale peak or follower is left for the first hit after. `sampleDance(u, age)` reads it with the
  same place and row mapping as `sampleBands` and a smoothstep between neighbouring bands. The
  echo's sampler reads it on every camera, so Work and Home's small ripple follows the hits too.
- **Beats** (`beat.ts`, read with `audioBeats()`). The detector sums the power of bands 0 to 11
  (about 20 to 245 Hz) into one level in dB. An onset is a rising frame at least 9 dB above the
  median level of the last second; it counts as a beat only if the next two frames stay 4 dB
  above that median (a kick holds up while it decays, a noisy frame drops straight back). Beats
  are about 340 ms apart, with two frames of slack (274 ms: onsets sit on the 33 ms frame grid,
  and arrival times jitter, so a steady 170 BPM kick keeps every beat), and never more than three
  in any second (the calm limit): a beat that would be the fourth in a second is refused. Both
  rules hold on both clocks: onsets in source time, and the frame that confirms a beat on the
  arrival clock (source time can run up to 200 ms ahead after a stall, so rules kept in source
  time alone once gave four beats in a real second). Beats are timestamped at the onset, and the history starts afresh after a
  0.5 s gap in events. It exposes `count`, `lastBeatAt`, `lag` (onset to confirmation, about
  66 ms), `beats()` and `bass` (the mean of bands 0 to 5). Bands 0 to 5 alone are not enough: at
  48 kHz they all read the same 47 Hz FFT bin, which swings by 10 dB from frame to frame on
  noise. Tested on a port of the Rust band maths at 44.1 and 48 kHz: a 120 BPM synthetic kick gives a
  beat per kick 0.5 s apart (within 35 ms; the 9 dB margin may miss one kick under a noise
  bed); two fixed pink noise seeds per level give none. In longer simulated runs of pure pink
  noise (54 minutes per rate) it fired 0 times at 44.1 kHz and 3 times at 48 kHz, so expect a
  rare stray glow on noise-like audio.
- **Browser dev.** Silent by default. In a development build (`npm run dev`) add `?audio=demo`
  to the URL for gentle fake levels: 32 bands shaped like the concept demo's spectrum (a kick
  at 105 BPM in bands 0 to 11, three slow melody bumps in the middle bands, a hat on the
  off-beat), so the grid pulse and the Unwind echo show in a browser. With a review URL
  (`?hz=unwind&at=...&audio=demo`) the camera and sky stay frozen but the frame loop runs, so
  the echo and the pulse can be captured. A production bundle ignores the query.
- **Ripple** (`echo.ts`). The echo lines of the range, drawn by the renderer's `echo` option.
  - **Line settings** (`linesSettings.ts`, local storage key `wall2-lines`, validated on read; a
    broken or unknown field falls back to its default). One setting for the lines everywhere music
    plays, read by the frame with `lineSettings()` (no render per frame). With every value at its
    default the wall draws exactly what it drew before.
    - Type: Mountains (default), Bars, Ribbon, Sparks or Skyline.
    - How lively, 0 to 100 (usual 50), x = (v - 50) / 50: the line amplitude times 2^(0.8x), the
      dance hit times 2^x, the dance limit times 2^(0.75x) (`setDanceParams` in `audio/dance.ts`).
    - Smoothness, 0 to 100 (usual 50), y = (v - 50) / 50: both dance releases times 4^y; the new
      types' fall gravity 520 / (2^y)^2 px/s2.
    - Height, 20 to 220 px (usual 104): a soft cap `H * tanh(v / H)` on how far a hit throws a
      line. The new types always go through it; on Mountains it caps the sampled height at
      `H / amp` and is off while that is within 0.02 of the dance limit (the usual setting).
    - Colours: From the look (the playing cover's tint, default), Floor light, Sunset, Ice or Mint,
      for every type.
    - Reflection on (default) or off. At rest: Ridge and levels (default) or Flat (resting opacity
      0.6; the new types lie down to one calm line on the horizon).
    - Presets: Calm 22, 72, 60 px; Dancing 50, 50, 104 px (the usual); Wild 88, 28, 180 px.
  - **New line types** (`lineTypes.ts`, a port of the lines playground the owner chose). They read
    the dance history by age (0 is now) with a short hold (the largest of now, 0.8 times 0.1 s ago
    and 0.6 times 0.2 s ago) and a gain of 1.7, are drawn after the picture above the horizon only,
    across the full width in every look (no picture box is cut out), at the live opacity the camera
    gives the lines (calm on Work and Home). Where they are drawn: with a video behind the mountains
    (Whole sky, and The sun once it plays) the type is drawn on the front canvas
    with the land, in front of the picture's lower part, with the same weight and reflection as
    elsewhere; with a video in front (Feathered, Drive-in, Hologram, and The sun while it waits for a click) it is
    drawn on the main canvas, and the screen, its frame and the hologram's pane stand above that
    canvas, so the part that passes behind them is hidden; on Listen and everywhere else with no
    picture it is drawn on the main canvas as before. A plain above-the-horizon clip is the only clip. While one plays
    the ridgelines are not drawn; when the music stops the resting look fades in. Bars: 64 columns
    18 px wide with a floating marker. Ribbon: one line, two trails, a faint fill and a glow wider
    on the kick. Sparks: 64 dots thrown up and falling under gravity, two trail dots along the
    throw. Skyline: 32 blocks of 12 px floors. State and colour gradients are made once (again only
    when the palette, the centre or the canvas changes). Dev knobs (`bridge/devMocks/lines.ts`):
    `lines=<type>`, `lively`, `smooth`, `lheight`, `lcol`, `lrest`, `lrefl=0`, `ltab=listen`;
    `lineprobe=front|behind` (with `lover=1` or `ltarget=main` for the two breaks) is the fit check's
    stacking probe: of the type's pixels inside the picture's box, none may have its canvas above a
    picture in front of the land, and for a picture behind the land all must (across 24 of 32
    columns of its width), and nothing may rise past the Height setting plus 48 px.
    The probe reads which layer is above which; it cannot see a mask or a blend. In Feathered (its
    edges and lower part are masked) and Hologram (the pane is blended over a dark plate) lines that
    pass behind the picture can show faintly through it, as the Mountains type already does there;
    the rule still reports them as covered.
  - Work and Home (3 lines): while music drives them, opacity `ea` times a smoothed loudness (bass
    weighted), `n`, `amp`, `cx` from the camera (`en`, `eamp`, `ecx`), `hs` 900.
  - Unwind (11 lines, the visualizer): while music drives them, opacity `ea` (0.9) raised to full,
    with no loudness scaling, and the lines follow the real bands (`sample`, below). The playing
    look matches the concept: the lines are tinted bright teal through the centre shifting to pink
    at the far right (the renderer's `tint` option, blended over the palette's rim colour), 1.5 px
    wide instead of 1.4, and the newest line fades in at the front instead of popping in. Work and
    Home keep the palette's colour.
  - **Rest.** Whenever music is not driving the lines they settle into a still resting look
    instead of vanishing. `musicDriving` decides, with hysteresis so the lines never pump on a
    quiet intro, a gap between tracks or a single blip: a pause, stop or the volume off settles them
    at once; while driving, every band under the floor (`BAND_FLOOR`) for 1.5 s settles them, and
    that quiet settle then holds at least 4 s (`REST_DWELL_S`); from rest they lift only once the
    loudest band has stayed at or over `REST_RESUME` (the floor plus 0.05, 0.35: band levels are
    absolute, with no auto gain, so soft music or a low volume sits only a little over the floor)
    for a third of a second. This holds on
    every camera with a ripple. `stepEchoMotion` runs
    `rest` from 0 to 1 over 2.5 s (and back over 1.5 s when music returns) and eases the drift
    phase to a stop exactly on the resting phase (line j at `(j + 0.5) / n`), starting from the
    playing speed, so the lines slow down and land rather than freeze. The renderer eases each line
    from `rest` (ease out, the far lines a touch later), blending its shape, opacity and width;
    at rest the spectrum is not read at all and the lines hold perfectly still. The resting look is
    one setting, `REST_LOOK`, with the resting opacity (default `ridgelevels`, the owner's pick on
    the demo page, at 0.28 on Unwind, `REST_OPACITY_VISUALIZER`, and 0.22 on Work and Home,
    `REST_OPACITY`, blended by `visualizerWeight`): `ridgelevels` (the top line follows the ridge
    with the soft glow of the `ridge` look; every other line is a straight level cut off by the
    mountain at 0.9 of its peak times `(k + 1) / (n - 1)`; opacity shares 2.2 for the ridge line
    and 0.75 for the levels; fills kept; a line drifting between the top two blends its level,
    share and glow into the ridge's by its place, so it never jumps, and at rest the places are
    whole), `contours` (each line a smaller copy of the range's outline, evenly spaced
    from the foot to the ridge), `levels` (flat, slightly bowed level lines inside the mountain,
    the top one on the ridge), `haze` (softened outlines of farther ranges rising behind the main
    one, each fainter; no fills) and `ridge` (one glowing line on the ridge, two faint lines under
    it; no fills). Without `rest` (or at 0) and `drift` the renderer draws exactly as before
    (golden call log test); the rest frame has a golden log of its own.
  - **The dance on the camera** (`dance` and `swell` on the echo, `echoOptions`). `dance` is
    `visualizerWeight` (0 on Work and Home, 1 on Unwind), `swell` the kick. With both absent or 0
    the renderer draws exactly as before (golden call log test). With them: the line's base height
    is multiplied by `1 + 0.2 * swell * dance * (1 - 0.45 * a)` (`a` is the line's place from the
    front), and the displacement mask blends, by `dance`, from `min(1, cr / (cmax * 0.5))` to
    `min(1, 0.2 + cr / (cmax * 0.5)) * (0.25 + 0.75 * edge)`, where `edge` is 1 within 62 percent
    of the half span from the echo's centre and eases to 0 at the half span, so the ripple reaches
    the foot of the range and thins toward the echo's edges. The amplitude passed is
    `eamp * (1 + 0.7 * dance)` (`DANCE_AMP`). Opacity and colour are not touched: only the shape
    dances.
  - **Lake reflection** (`reflection.ts`, `REFLECT`, on). After the frame is drawn on a camera with
    `dance` above 0 and lines on screen, the band 190 design pixels above the horizon line is
    copied to one scratch canvas (made once, resized only when the canvas size changes), faded by a
    vertical gradient (clear at the top, solid at the horizon) and drawn flipped under the line at
    0.62 of its height, 3 design pixels below it, additively, at `0.8 * dance * gate` opacity, with
    an explicit transform (`setTransform`, restored after). Not drawn on Work and Home, with no
    lines (an idle display, Rainier in the morning) or while Zen is open.
  - `sample`: while any line still follows the music (`rest` under 1), `HorizonCanvas` hands the
    renderer a sampler (`createEchoSampler`): each line reads the shaped heights (`sampleDance`) at
    its own age (the 7 seconds spread across the lines). Without `sample` the renderer uses its made-up `spec()`.
  - **Glides.** A camera glide blends the line count (`en`, 11 on Unwind, 3 on Work and Home).
    `HorizonCanvas` keeps a drawn count that follows it at no more than 4 counts a second
    (`stepLineCount`; the glide's eased peak moves `en` at about 15) and lands on it exactly. The
    renderer draws a fractional count as the two whole sets either side, crossfaded by the
    fraction, each on its own levels, so no line appears, vanishes or jumps level during a glide,
    at rest, mid-settle or mid-lift, and each line fades over a quarter of a second or more. Under
    reduced motion the count switches with the place's cross-dissolve.
  - Never on the morning Rainier camera. On a turn toward it the echo fades out within about half
    a second of the turn starting (the camera gate: its opacity only falls from the first frame of
    the turn and is exactly 0 by 0.6 s), and it stays off, through any turn back, until the camera
    has settled on a place whose echo is on; then it fades in over 0.6 s. Under reduced motion and
    in the review still every place with a ripple shows its lines at rest.
  - When the display is idle or off (`useIdle`: no input for 4 minutes, screens off, locked)
    the echo fades out over a second and is then not drawn, and the band history stops; both
    start afresh on return. A hidden page returns with the lines at rest.
- **Echo calm check** (`npm run echo-calm`, by hand; CI does not run it). Builds
  `scripts/echo-calm/` (the real renderer, echo and audio store) into one HTML file and draws 600
  frames of the Unwind camera in headless Chromium with the echo and without it, for the
  `?audio=demo` levels, for every band pumping fully on and off 6 times a second, and for the
  settle (`mode=settle`: the demo levels for 10 s, then silence, stepped as the canvas steps
  them). It takes what the echo adds to the picture's mean relative luminance over every pixel
  and fails if that moves by 1 percent of the picture's mean, up or down, more than a limit's
  number of times in any second, or if any echo line moves more than a limit's number of design
  pixels between two frames; the limits are per input (`LIMITS` in the script). They were three
  swings a second before the dance; the lines now follow every hit, so each sits a little over
  what the chosen look measures (demo 62 swings, at most 6 in a second, 52.4 px; every band
  pumping 194, 12, 23.5 px; settle 33, 6, 52.4 px; before the dance 11, 1, 22.3 px; 12, 1, 14.1 px;
  7, 1, 19.8 px). For the settle also if any frame after the music stops changes it by more than
  2 percent, or any frame from 3.5 s after changes it by more than 0.05 percent (unchanged). Set
  `WALL_CHROME` to a Chromium binary.
- **Grid pulse** (`pulse.ts`). While `playing`, `HorizonCanvas` passes `grid` to the renderer.
  Each beat starts a soft glow band at the horizon that rolls across the lake grid to the bottom
  edge in 1.2 s (depth `p` 0 to 1 on the grid's own `pow(p, 2.1)` spacing, eased out over its
  life so it leaves the horizon briskly; drawn additively after the lake's fog, growing with
  depth), fading in over its first 12 percent and out over its last 30; it starts already as
  old as the detector's lag, so it lines up with the kick. Peak opacity 0.42 at full strength. The grid lines
  brighten from 0.3 up to 0.55 opacity with `0.65 * kick + 0.35 * bass`, where the kick part
  eases up to 1 over 80 ms on a beat (never a jump) and falls away over about 0.3 s, and the
  bass part is smoothed over about 0.6 s so frame-to-frame jitter never flickers the lines.
  With never more than three beats in a second the lines rise at most three times a second. Both scale by the camera's `gp`: 0.5 on Work, Home and the
  morning Rainier view (subtle, and seen through the ribbon's glass), 1 on Unwind. Four fixed
  band slots, reused every frame. No grid when silent, under reduced motion or in the review
  still; without `grid` the renderer makes exactly the canvas calls it made before (a golden
  call log test).
- **Moon.** The Unwind camera draws the moon, radius 44, at the first of three places
  (`MOON_PLACES`) whose disc is 40 px or more from every picture box and every card's keep-clear
  box that a screen claims (`moonFor` in `sky.ts`): (1890, 260) right of Listen's player, the
  place it always had; (760, 352) low under the player's left half, right of Up next, for a
  layout whose right side a wide card takes (43 px under the player at its tallest, with nothing
  playing, and just above the ranges, where they are lowest); (1450, 150) high in the middle of the sky. Each is
  wholly above the Unwind ridgeline and clear of the clock (a test). With none clear, or a claim
  that says `noMoon`, there is no moon, and its light on the lake goes with it. On Listen the
  Spotify card (`SpotifyCard.tsx`) and the player (`Player.tsx`) claim their drawn boxes, so the
  moon sits at (760, 352) there, whatever the player shows; on Watch the list card and the left block do. The same claims
  always give the same place, so it changes only when a box does, and it is simply drawn at its
  new place on the next frame (a resting still frame is drawn again once for each change; a claim
  made again with the same boxes changes nothing). It shows once the glide to Unwind has finished (it goes as
  soon as a glide away starts); no other place does. The review still `?hz=unwind` draws it, since that camera jumps straight there. The drawn
  moon is published on the canvas as `data-moon` for the fit check.

## Unwind and Watt

`wall/src/screens/Unwind.tsx` lays the place out as the concept's `f_unwind`: the tall
frame (no ribbon) in the wide zones `470px 1fr 540px`. The parts are in `wall/src/unwind/`.

- **Left wing.** The frame's clock, then "Wednesday night, 49° and clear" (`DateLine.tsx`:
  the day part, morning, afternoon, evening or night, with the reading from the weather
  hook; before 5 AM the night still belongs to the day before; without a reading under an
  hour old the weather part is left out). At the bottom, Tomorrow (`Tomorrow.tsx`): "First
  thing: AE sync at 9:00", the first event on the calendar day feed (`wall2_meet_day`)
  tomorrow by local calendar date (between midnight and 5 AM, the day that has just
  begun, from now), or nothing when there is none or Meet is not set up. After a failed
  refresh it adds "as of 9:40 PM" (the last good read) and hides once that read is more
  than 30 minutes old. Under it the status line (`StatusLine.tsx`, "Work is put away. 2
  agents still running. No agent needs you.", from the focus timer once it has loaded and
  the helper summary `wall2_omni_summary` every minute while visible; the agent and
  needs-you sentences are left out without the helper or when it reports stale data).
  The parts that carry an action are chips with a tooltip: "N agents still running" is a
  quiet chip that switches to Work, and "N things need you" (or "One thing needs you") an
  amber chip that opens the first waiting chat with `wall2_open_session` (the summary's
  first your-move session, else the first lane that waits; when links are not available it
  switches to Work instead). Each chip is 32 px tall. "Work is put away.", "Focus is still
  on." and "No agent needs you." (the line only knows about agents) stay plain text. When
  the calendar cannot be read (no account answers, or the cached read is over 30 minutes
  old) the Tomorrow spot says "Calendar not available"; when weather is missing the date
  line ends with "weather unavailable" in dim text. The Room chips mark the mood that is on
  now (the shared last mood, for three hours), give each a tooltip (with the home feed's
  description when it sends one), and sit in a fixed grid of three columns and two rows; past six moods the sixth cell is a "More" chip and the mood that is on takes the place of an ordinary one (never an extra chip). The volume
  slider shows its number on hover and while dragging. Hide screen is an icon alone (36 px, quiet) in the lower right
  corner of Unwind; under the pointer or keyboard focus it grows to the left (anchored at its right edge, so the icon
  stays put) into a pill that reads its name, in place of a tooltip ("Hide screen", "Hiding", "Cancel hide", also its
  accessible name); a double click sends once; "Could not watch input" shows beside it for five seconds.
  The wind down ring (PR 10) goes between the date line and Tomorrow.
- **Centre.** The toggles (`Tabs.tsx`, under the date line): Listen is this view (its toggle controls the player
  panel); Watch switches the centre to video (see "Watch" below). There is no Dream toggle: Zen dims by itself. The player (`Player.tsx`): 224 px art, the source
  app in pink capitals (the player's name, see below), a 64 px title, the artist, and under them one row of the buttons, a 360 px position with times
  (advanced locally twice a second between polls while playing and visible, never past
  the duration), then previous, play or pause and next with the playing app's volume
  (`Volume.tsx`). `get_now_playing` sends the media session's own app id as
  `source_app_id` (a Windows AppUserModelId such as
  `SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify`, or a process name such as
  `Spotify.exe`). `music/players.ts` maps known players from that id to a display name
  ("Spotify", "Edge", "Chrome", "Firefox", "Apple Music", "Media Player" and others) and
  to the process names of their audio sessions. A packaged id is a known player only when
  its package family name is one of that player's exact family names (the store Spotify
  is `SpotifyAB.SpotifyMusic`); a process id only when its file name, lower-cased with
  `.exe` dropped and nothing else stripped, is one of its process names. An unknown player
  shows its own cleaned app name (the package name when the id ends in the bare word
  `App`; never "App", and never a name that reads as a known player's, so
  `Evil.Spotify_x!App` shows "Evil.Spotify") and never gets a known player's process: a
  process id gets only the session with exactly its own file name, a packaged one none.
  The slider shows only when `get_audio_sessions` has such a session; otherwise the row
  closes up. `Music.UI.exe` is Groove Music's own executable, so that process id names
  Groove; the ZuneMusic package names Media Player. A remembered cover on the idle view
  that fails to decode falls back to the placeholder tile. The session
  is tied to the source it was found for, so after a source change the slider hides until
  the new app's session is read and a move never reaches the previous app. Moves are
  clamped to 0 to 1 and sent with `set_audio_session_volume` at most every 100 ms, always
  ending on the last value (also on unmount); a move pending when the session goes away is
  dropped.
- **Nothing playing.** The player keeps its footprint: the last track this wall saw
  playing (`lastPlayed.ts` follows the shared now playing store; title, artist and source
  are kept in `wall2-last-played`, the art in memory only) with "Play again" when a media
  session exists, or "Open Spotify to play again" as plain text when none does, or before
  anything has played, "Nothing playing" with a calm line over the transport. Never a
  large empty tile.
- **Listen, as the owner chose it (7A, 8B, 6A, 9A, 10B).** Unwind is music on this computer
  and never controls the house: the house-wide lights row is gone, and **Unwind never
  controls any room other than the office**. Listen and Watch are
  toggles under the date line, not a pill over the centre. The cover (the real art from
  now playing; a neutral tile only when there is none) and the title sit at the top of the
  centre, and previous, play, next, the position with its times and the volume sit in one
  row right under the title, so everything ends above y 300 and the dancing lines stay
  clear. The lines take the cover's colours (`music/coverTint.ts`: three colours, left,
  centre and right, read once per cover on a 24 px canvas, held between 55 and 80 percent
  lightness so a black or white cover still shows; `useCoverTintFollow.ts` hands them to
  the horizon's `tint` through `echoOptions`, cross-fading over 2 seconds, at once with
  reduced motion; the default teal and pink when no cover is known).
- **Up next** (`unwind/spotify/UpNext.tsx`), in the left wing under the toggles: the next
  three tracks of the Spotify queue (`wall2_spotify_queue`, every 20 seconds while shown and
  on every track change) with 48 px covers, the title and the artist; hover gives the album
  and length. A click only skips: the n-th row sends n skips (never more than the queue holds), through Spotify's
  own Next when Spotify reports a player, else through the media key to the session the player showed
  when the click began, and only when Spotify is the player, else it sends nothing and says
  "Open its list to play it". Every skip of one click goes the same way. It never plays a list, so it never replaces the queue. Hidden with YouTube
  Music chosen, with Spotify not set up, and when nothing is queued; signed out it reads
  "Sign in to Spotify in Tools to see what is next" (a click opens Tools).
- **The Spotify card** (`unwind/spotify/SpotifyCard.tsx`), the upper right (stage x 1740 to
  2540, y 24 to 486). On top, the switch Spotify or YouTube Music ("Which player the wall
  follows", kept per display in `wall2-unwind-source`). Spotify: a search field (on Enter,
  or 400 ms after the last key, two characters at least; only the newest search may change the
  list, and a failed one keeps the last good results under a note with Retry), then the tabs
  Search, Playlists, Albums, Liked and Recent in a pill. Playlists and Albums are a grid of large
  cover tiles, five across, the name and the song count under each (`imageUrl`; a neutral tile
  with a music note when there is none or it fails to load, never a colour gradient). Resting on
  a tile rings it and opens its details card (the shared tip, pinned): the kind with its owner
  or artist said once, the song count when the bridge gives it, and Play, Shuffle and Songs.
  Liked and Recent are songs, as rows. A click on a tile opens its songs
  (`wall2_spotify_tracks`, 50 at a time as the list scrolls; Back or Escape returns, Play and
  Shuffle play it whole, the song now playing is marked by track id or by title and artist, a
  song that cannot be played is dimmed with the reason in its tooltip, and the total length
  shows once every song is read); a click on a song plays from it in its list. A click on a song
  in Liked, Recent or Search plays it. Lists scroll inside the card with the wheel and
  never grow it. States: not set up, signed out (both point to Tools, where Spotify signs
  in), not answering (with Retry), busy (the list stays, "Spotify is busy, try in a
  minute"), no device after a play ("Open Spotify on this PC first, then try again"), an
  empty library. YouTube Music chosen: what Windows says is playing, previous, play and
  next through Windows, and "Open YouTube Music" (`wall2_open_link`). Signed in to YouTube, this side is the library instead (see "YouTube" above).
  At the right end of the top row, where the hint "Which player the wall follows" used to
  stand on the Spotify side (the hint stays on the YouTube Music side until the library shows, and where Spotify cannot
  be browsed), sit the "Play on" chip and one round button (below).
- **The tall view and "Play on"** (`SpotifyCard.tsx`, `PlayOn.tsx`, `PlayerRow.tsx`,
  `TallViews.tsx`, `Tile.tsx`). The round button at the card's top right (or a click on the
  empty part of its top row) opens the card into the right third of the wall: 833 by 624 at
  wall 1707, 24, ending at y 648 so Screens off and the office lights slot stay free. The
  page behind stays live (no scrim); the sky keeps clear of the bigger box through the same
  keep-clear claim, so the moon does not move. Opening takes 240 ms and closing 400 ms (none
  under reduced motion); the state is not stored, so the wall starts closed. It closes on the
  same button, on Escape (the "Play on" list first, then a playlist's Back, then the view; focus
  returns to the button), on a press anywhere outside it (that press is swallowed together with the
  mouse events that follow it, until its own click has gone by or the press is cancelled or ends
  (the pointer going up lets go just after the click would have come; so do the card being taken away and
  the page being hidden), however long it is held, so it does not also press what lies under it; a tile's details card counts as
  inside), and by itself 15 seconds after the pointer has left it and the keyboard focus is outside
  it too (opened by keyboard it stays while the focus is inside; opened with neither there, the 15
  seconds start at once), never while the pointer or the focus, the search field included, is on it. Inside: the tab row
  (Playlists, Albums, Liked, Recent, Up next; left and right move along it) and the search field
  in one row, with the field as the search (results in groups: songs, then at most three albums
  and three playlists; emptying it returns to the library); two full rows of covers, more
  scrolling (the arrow keys walk the tiles by the rendered column count, the edges stay, Down from a
  column a short last row lacks reaches its last tile, the focused tile scrolls into view); a playlist or album opened as its cover, kind, name, count, Play and Shuffle on the
  left and its songs on the right; Up next (what plays now and what follows, at most ten, from
  `wall2_spotify_queue`; a click skips ahead with Spotify's own next command, once per row, on the player
  Spotify reports); and the player row (cover, title, artist, previous, play or pause, next, and a time
  bar). While Spotify reports a player (this PC, a phone, a speaker) the three buttons act on it through
  `wall2_spotify_previous`, `_pause`, `_resume` and `_next` (the player Spotify says is active, no device
  named; they need only `user-modify-playback-state`, which the sign-in already asks for), whichever program
  is Windows' media session, and the state is read again after each press. Windows' media keys serve only
  when Spotify reports no player and the Windows session is Spotify on this PC; otherwise the buttons are
  marked unavailable with the reason. The time bar can be dragged, or moved five seconds with the arrow
  keys (a held key sends at most one seek per 300 ms and the final position on release), and seeks through
  `wall2_spotify_seek`; the local clock reads the state again when the song's length is reached.
  The heart at the right end of the row is Save to Liked (see "Saving songs" under Spotify above). Every list shows loading words (never blank) on its first read, and keeps what is on screen while it reads again, then its empty or error words. A playlist the owner does not make or co-edit cannot have its songs listed (Spotify's rule), so
  opening one says "Spotify shows the songs only for playlists you made. To see these, copy it into a playlist
  of your own in Spotify. Play and Shuffle still work." with no Retry (it could never help); in the tall view a
  dim second line adds "While it plays, Up next shows what is coming." where "Up next" is a button that opens
  that tab. A song in a search answer shows its length at the row's right edge (`durationMs`, sent only for search songs). On the YouTube Music side
  the tall view holds today's content in the larger box.
  "Play on" is a chip showing where the music plays (the owner's pick, else the active Spotify
  player, else "This PC"; "This PC" also while the wall starts Spotify), and a click opens the
  list of the owner's Spotify players from `wall2_spotify_devices` (name and kind, a tick on the one
  in use, "This PC" first with "Spotify is closed. The wall starts it." when no computer is awake, and
  the note that a phone or speaker shows only while its Spotify is awake). Choosing one while music
  plays moves it with `wall2_spotify_transfer`; with nothing playing it only makes that player the
  target of the next Play, which then sends its `deviceId` (the play command honours a chosen phone
  or speaker as well as a computer). A chosen player that is no longer listed (asleep) or does not allow
  control is never swapped for another: Rust answers `device gone` or `restricted` and plays nothing, the
  card says "That player is not awake. Choose where to play." (or that it does not allow control) and
  clears the pick; the list is read again when the chooser opens and before a Play that names a player
  (a computer in the list that is gone is refused like any other player; only the pick "This PC", which has no player id, is started by Play); after a failed read the old rows stay
  marked "Could not refresh, these may be out of date." and not as live. Music on a player that does not
  allow control shows that player's name with a lock on the chip, and the words in its tip. Device names
  are shown as text only. While Spotify
  starts the card shows a calm status line (the Spotify mark, "Starting Spotify on this PC", what plays
  once ready, a thin line that fills once).
- **The office lights slot.** Where 7A drew the quiet row at the foot (right edge 70 px
  from the stage's right edge, top 662, 34 px tall, 420 px wide at most) Unwind keeps one
  empty box, `data-slot="office-lights"`, with no content, border or pointer, for an
  office-only lights control the owner is still choosing. The fit check fails when
  anything that draws enters it. The Room card (`RoomCard.tsx`) is no longer on Unwind;
  the file stays because Zen reads its mood mark.
- **Right wing on Watch.** The Watch list card (see "Watch" below).

Watt (`wall/src/buddy/`) is the electric sheep on the horizon band of every place that has
one: Work, Home, Meet (hidden during a call, once the in-call pull request detects one) and
Unwind. Not on Zen (Dream draws its own sleeping Watt). `App.tsx` mounts it once, over the
horizon canvas and the veil and under the panels; its styles are `buddy/watt.css`.

- Walk table (`WALKS` in `buddy/model.ts`, left edge range and sprite pixel size): Work and
  Meet 880 to 1090 at 4 px, Home 1506 to 1726 at 5 px, Unwind 430 to 470 at 6 px (the body
  between about x 430 and 580, the concept's spot in `f_unwind`, below the wind down block and
  left of the transport row). That is where he stands until he is set down somewhere else.
  The feet stand on the camera's `hy` (582 on Work, Home and Meet, 505 on Unwind).
- Ground (`buddy/ground.ts`): where he may be set down, as spans of his left edge, measured
  with every control and line of text of the place. Work and Meet 140 to 2420, Home 140 to
  2400 (the whole band between the top row and the ribbon); Unwind on Listen 140 to 494 (left
  of the transport row) and 1416 to 1870 (between the row and the Room card); Unwind on Watch
  140 to 1020 (the video takes the rest). While the leave banner shows in the band above the
  ribbon (Home and Meet, x 624 to 1914), his ground there goes round it: Home 140 to 516 and 1932
  to 2400, Meet 140 to 536 and 1930 to 2420; he fades over to the nearest free spot and his stored
  spot is kept for when it goes. His spot on each place is kept in his stored record
  (`spots`), and he wanders around it: up to 105 px either side on Work and Meet, 110 on Home,
  60 on Unwind, centred on the spot and kept in its span. `model.test.ts` builds the rail, zone
  and ribbon rectangles from `screens/frameLayout.ts` (plus Unwind's transport row,
  `UNWIND_ROW`, and the Watch tab's video) and checks that no span (every pose, prop, notes,
  z's, the mark, the clover and every line's bubble) reaches one at 2560 by 720. On Unwind's
  narrow left stretch a long line can fit on neither side of him at some spots; there it waits
  unseen rather than cover him. When Unwind's tab changes and his spot is not on the new
  ground, he fades over to it (his stored spot is kept for the other tab).
- Pace: it stands 20 to 40 seconds at each stop, then walks slowly (14 px a second) to the
  next; it starts standing in the middle of the range.
- The idle life on his stands (not under reduced motion): a blink (one 120 ms frame with his
  eyes shut every 3 to 7 seconds), grazing at one stop (the head lowered, nibbling, for six
  seconds), and settling in on the longest stop (40 s: he sits after six seconds and stands up
  three seconds before he walks on). So, blink aside, one idle behaviour every two to two and a
  half minutes: one graze and one settle in each loop of his wander (about 4.5 minutes on
  Unwind, 5 on Work, Meet and Home). `model.test.ts` holds that cadence.
- The frame loop draws only while something moves on every frame (a walk, a carry, a fall, a
  reaction, a fade, music notes, sleeping z's, the dusk firefly, the beat). While he stands it
  sleeps on one timer until the next planned change (`restFor` in `petFrame.ts`, `carryRestFor`
  in `carry.ts`: the end of a stand, a blink, a graze nibble, sitting down or standing up, the
  pointer notice ending), paints that change once and sleeps again, so a standing Watt requests
  no animation frames at all. A pointer near him wakes him for one step. A hidden page schedules
  nothing; its return picks up.
- It is up only while the horizon's camera is settled on its place. `horizon/signal.ts` is a
  small read-only signal the horizon publishes (the camera it is on or heading to, and whether
  it is moving); Watt hides whenever the camera moves or points somewhere other than the camera
  Watt expects for its place and hour. So a place change, a quick reversal, the 5:00 AM
  cinematic turn to Rainier and the 11:30 AM swing back all fade it out where it stands, and it
  fades in at the new spot once the camera has settled. It never walks across the screen.
- It sleeps in the middle of its range with drifting z's between 9:30 PM and 6:30 AM local
  time (fading out and back in at both changes), and shows little notes beside its head while
  music plays (awake only). Night and Home's camera are worked out once a minute. The frame
  loop reuses its records, pauses while hidden, and does not run on Zen or in a call. Under
  reduced motion (and in a dev review still) it is a still pose in the middle of the range
  with nothing drifting, and it jumps on a place change. The idle and sleep pixel maps in
  `sprites.ts` are the concept's own; the other poses and the props are drawn to match.

Watt is also a small pet ("he"), calm and silent (no sound at all):

- **Speech bubbles** (`buddy/chatter.ts`, `buddy/lines.ts`): one short bundled line at a time,
  no model calls and no network. At most one every six minutes by default (three when set to
  Chatty, none when Off), never in a call or a meeting in progress, never in the first minute of
  a focus session, never while the display is idle, never asleep, never the same line twice in a
  row. A fresh event (focus done, an agent finished or waiting, a call soon or just ended, music
  stopping, a clover) wins; otherwise what is true now (agents, music, weather, time of day) wins
  over plain sheep thoughts. A showing bubble goes the moment any quiet time starts. His lines
  observe himself, the sky and the wall; none gives advice, nags or asks anything of the owner. The
  bubble is his own lavender with his dark face colour for the text; its box is sized from
  measured Oxanium widths (`petFrame.ts`), placed beside him within the band, and
  `model.test.ts` checks every line.
- **Reactions** (`buddy/petFrame.ts`): a hop when a focus session completes or an agent
  finishes; he looks up toward the agent cards and shows an amber mark while something waits
  (click it: it opens the waiting session through `wall2_open_session` when the helper gives a
  link; elsewhere it goes to Work, and on Work with no link it only tells, as the agent cards
  above already show what waits; its tooltip names what waits); he looks at the clock five
  minutes before a meeting; he bobs (a soft squash) on the beat at most once every 1.2 seconds.
- **Motion** (`petFrame.ts` `shape`, `lieDown`, `noticeClick`; `carry.ts`): every move has its
  in-between frames at pixel-art counts (poses step at about 10 a second, positions move
  smoothly), with squash and stretch that keeps his volume (`sx` wider when `squash` is
  flatter). The hop: a crouch, a stretch, about 5 sprite pixels up with the legs tucked, a
  squash with dust, a settle. The spin: a crouch, then a true turn (side, front, the other side,
  back, side) a little off the ground. The happy hop: two stiff-legged bounces, the second with a
  turn, hearts as he lands. Every lift is capped by the room under the walk's ceiling. The nap:
  he turns round, sits, lies down and breathes slowly with z's; he gets up with a yawn and a
  stretch.
- **The pointer on him** (`Watt.tsx`, `buddy/carry.ts`). Hovering opens nothing: the cursor is a
  grab hand and the wall's tooltip reads "Click to pet. Drag to carry. Right-click for his menu."
  (never the browser's own; a press takes it down).
  - **Click pets.** A press and release with under 6 px of movement and under half a second is a
    pet: hearts and a wiggle, and a spoken reply only outside every quiet time, at least 20
    seconds after any bubble and at most once a minute (a second click within three seconds adds
    nothing). It never opens the menu. Petting him while he naps gets him up instead of a wiggle.
    Keyboard: he is one tab stop; Enter or Space pets.
  - **Right-click opens his menu** (`buddy/Menu.tsx`; `contextmenu` on him, and only on him; the
    browser's own menu is prevented by a listener on his element, which runs before the page's
    other handlers, and WebView2 shows no menu when the event is prevented). The ContextMenu key,
    Shift+F10 or the letter M opens it too and moves focus to its first item; Up, Down, Home and
    End move between items. It is his own speech bubble above him (lavender, square corners, a 2
    px dark ring, its tail pointing down at him; `placeMenu` keeps it in the main area and never
    over him; it may sit over the cards above him while it is open, as a pop-up does): his name,
    his mood in one word, days together, a line about today, then Tricks (Hop, Spin, Nap), Where
    (Come here, Stay here) and Together (Read with me), each with a small pixel icon, and a quiet
    footer for how chatty he is (Off, Some, Chatty) and what he wears (those unlocked and the
    next one, "Star in 2 days"). Every item is 38 px tall (the footer's 34 px) with the wall's
    tooltip. Choosing something he does closes it (focus returns to him when it was in the
    menu), and he answers after the move, never under the menu; the footer's choices keep it
    open. It also closes on Escape, a click or right-click outside it, a right-click on him
    again, a place change, keyboard focus moving on past it and when he goes away. While it is
    open he stands still and looks up at it. His click area is his body and head, not the
    sprite's empty corners.
  - **Pick him up and set him down.** Press on him and move 6 px or more (mouse, pen or touch;
    pointer capture, so nothing under him sees the pointer) and he is lifted by the wool on his
    back: one surprised frame (ears up), a stretch as the wool takes his weight, the tuft he is
    held by drawn above his back, then a dangle that swings like a pendulum (a damped spring
    driven by the pointer's speed, so it carries past upright when the pointer stops). He turns
    to face the way he is carried once the pointer has moved steadily for 0.15 seconds, his legs
    pedal faster the faster he goes, and a shadow on the ground shows where he will land. He is
    drawn above the cards and kept on the screen. Letting go drops him straight down under
    gravity onto the ground line at the nearest free spot of the place's ground (drifting
    sideways over a quarter second only when the spot below is not free), stretched as he
    falls; he lands with a deep squash and dust, a rebound, and a shake of his wool, stands a
    moment, sits, and after a few seconds wanders around his new spot. The spot is kept per
    place (`spots` in his stored record; Unwind keeps one per tab, `unwind` for Listen and
    `unwindWatch` for Watch) until he is set down elsewhere or called to the middle. Under reduced motion he is simply there. A carry is never a pet. Pointer cancel, a
    lost capture, the window losing focus, the page hiding, a call starting or the display going
    idle put him down from where he is (no fall when the page is hidden, and no landing line); a
    place change sets him down at once on the new place's ground at his x. Letting go within 24
    px of a clover feeds it to him. Shaking him (three fast direction changes inside a second)
    gives swirly eyes for three seconds after landing. While carried the amber mark and the
    clover are hidden. He says at most one "held" line (a "fast" one when he is carried quickly,
    none once shaken), one "landed" line only once he is down and his wool is shaken out, and a
    "dizzy" line at most once a minute, all obeying every quiet time and the chattiness setting;
    carry lines come at most every 20 seconds across carries. His held line shows only over open
    ground: carried over a control, a line of text or a card of the wall it is hidden, so it never
    covers information (his body stays above everything, to show where he will land).
  - **He notices the pointer.** Within about 260 px, and not busy (reading in focus, walking, a
    clover on the ground, asleep, a reaction running, his menu open), he turns to face a pointer
    that moved in the last 6 seconds, with his ears up (the "alert" pose); after 6 still seconds
    he loses interest. Not under reduced motion.
  - **While the wall records** (`isQuietForRecording()` in `signals/store.ts`) he sits quietly where
    he is: no wander and no idle life, no line of his own, no click noticing, no hop or look he
    starts himself, no notes or beat; the owner can still pet him, open his menu and carry him.
  - **At the drive-in** (`buddy/audience.ts`): while a show is on (the video playing or paused in the drive-in look, with its stage in sight on Unwind's Watch tab: a video playing out of sight is parked and is not a show), he walks to a seat just left of the screen rectangle the selector gives (`driveInAudience`): his seated sprite (108 px, props put away) keeps at least 30 px from the screen's left edge and at least 22 px from the nearest control at his height on either side, and the seat is the rightmost point that does (the screen at x 1244 and nothing of the left block at his height give a left edge of 1106). The controls are measured from the layout boxes (a faded control still takes its place) once for the screen and layout, and again only when the window resizes or something appears in or goes from the page; the answer, a seat or none, is kept. The seat has its own ground (`seatGround`); `WATCH_GROUND`, which bounds his wander, stays at x 1020. With no seat within 300 px of the screen he does not walk: he sits down where he stands, turned to it. Reduced motion: simply there. He sits with one sign of life every 20 to 40 seconds (a blink, an ear, a head dip) and looks round once on a pause; no bubble, no click notice, no headphones; the show keeps him up past bedtime, and his frame loop rests on one timer. He may stand up to 24 px into the tower's left foot and stay (the chosen picture has him 19 px in). Nothing depends on the controls under the left block: there are none.
  - While the drive-in's marquee waits (loading, a refused autoplay's click, a Twitch start hint) there is no show: he does not walk to the seat; a show he is already at keeps him seated through a wait inside it (the next item of a playlist), and a video that ended sends him home. When a show ends he walks back to his Watch spot. Order, first match wins (`showRole`, one table in `audience.test.ts`): no show, a video that ended or has not started (off); a call, reading with him (both send him back); the wall recording (he sits where he is, no walk); his menu open (he stays put while it is open); a nap he was sent to (he finishes it lying where he is, then goes to the show if it is still on); the owner's hand in this show (set down, picked up, Come here, Stay: he watches from where he was put); then watching. The leave banner acts through his ground, and on Unwind it takes none; bedtime does not apply while a show is on. The owner's hand is tied to one show (`ShowTrack`): it survives a call, reading and recording inside that show and is cleared when the selector leaves it (the video stops or ends, the owner leaves the tab or Unwind), so the next show starts free.
  - The fit check holds his seat 30 px clear of the screen, 22 px clear of every control at his height (every `.w-ctl`, the list, the Now block, the banner), within 40 px of the seat the rule gives (a left edge of 1106 with the screen at 1244 and nothing of the block at his height), on the ground line, and no more than 24 px into the tower's painted parts at his height; its self-test breaks (`watt-seat`, `watt-spot`, `watt-seat1106`, `watt-tower`, `watt-ground`) each fail for their own reason. The gallery's `drag:` step sets him down during a show.
  - **He notices clicks.** One passive `pointerdown` listener on the window (capture, so it sees
    clicks a control stops; it never prevents or stops anything, and does a few comparisons and
    starts a reaction; no polling, no timer while idle). A click anywhere on the wall that is not
    on him or anything of his turns him toward it: within 320 px of his head, ears up, a squash
    then a flick of his wool and a 1.6 second look (up at it when it was above him); to 1000 px,
    ears up and a 1.1 second look; farther, one ear frame and a 0.7 second glance. A burst of
    clicks is one reaction (nothing for 1.5 seconds after one). He never moves for it. One near
    reaction in three may get a line ("Ooh. A click."), at most once every three minutes and only
    through the usual quiet and chattiness rules, never over another bubble. Never while he is
    carried, falling or walking back, in a trick or a nap, reading, with his menu open, asleep,
    away, in a call or a meeting, while the wall records or while the page is hidden
    (`noticeBlocked` in `Watt.tsx` holds the list). Under reduced motion he only turns.
  - **Happy hop and a milestone.** Three clicks within 4 seconds (the second and third add nothing
    to the pet count) give one happy hop, at most once every 20 seconds. The tenth pet of a day
    gives a one-off sparkle and a "milestone" line.
- **Tricks and commands in his menu.** "Hop" and "Spin" are small reactions; "Nap" lies him down
  asleep for a minute or until he is petted, with its own line; "Come here" sends him back to the
  middle of the place and forgets his spot there (he trots at three times his pace when it is on
  the same stretch of ground and near, and fades over when it is not, as across Unwind's
  transport row); "Stay here" is a switch that keeps him sitting where he was last set down (or
  where he stands) until it is switched off, the place changes or the day ends. Stay is kept in
  the stored record (`stay`: place, x, local date) and checked whole on read (a known place, an x
  on the stage, today's date; anything else is dropped). The tricks are refused quietly, not
  hidden: in a call or a meeting, in the first minute of focus, while he sleeps at night and while
  he is away, the items are marked off, the menu says why in a line, and their tooltip and
  accessible description say why too. "Read with me, 25 min" starts the existing focus timer
  through the focus store at its default length (no new timer logic) and is off while a session
  runs. Tricks add a line from the "tricks", "nap" or "stay" group once he has done them, on the
  same quiet and chattiness rules, at most every 20 seconds.
- **A firefly at dusk.** Between sunset (`ribbon/sun.ts`) and his bedtime (9:30 PM) one small
  firefly drifts in a slow loop near him and blinks softly (never brighter than his wool); he
  turns to watch it. Not under reduced motion, never in a call.
- **A little life**: he reads a tiny book during focus, wears headphones on Unwind while music
  plays, sunglasses at a clear midday, an umbrella in rain, a scarf when it is cold, a nightcap
  asleep; he looks up at the moon in the evening, yawns and stretches when he wakes at 6:30,
  and naps where he stands while the display is idle. His mood (content, happy, sleepy,
  curious) only changes which lines and idle poses he picks; it never goes below content. Twice
  a day a clover grows on his walk; he eats it when he reaches it, or click it to give it to
  him. Cosmetics (bow, star, cape) unlock with days together.
- **What he wears and where** (`buddy/sprites.ts`, drawn by `PropSvg` over the sheep, so every
  piece flips with him). The headphones are one big cup on his ear with the band over the top of
  his head, placed from his ear pixel (`EAR`); they are worn on every pose seen from the side, and
  not on the spin and the front view (`NO_HEADPHONES`), where a cup on one ear cannot be drawn.
  The star is a five-point patch on his wool, drawn on every pose and never dropped (it does not
  rise above him, so the rise limit `PROP_RISE_MAX` never applies to it, and it is on him while his
  menu is open and he looks up). Its place is a table, `STAR_AT`, one entry per pose: (5, 3) when
  he stands, one row higher on the shorter bodies (sleeping, lying, landing, hopping), and left of
  the face on the front and back views, which show no flank. A unit test checks, for every pose,
  that all 14 of its pixels are on wool and not under the headphones, scarf, sunglasses, nightcap
  or book. The little plus that glitters after a happy click (`SPARKLE`) is a separate sprite.
  With the headphones on, the cup and the band are drawn over the bow and the bow sits further
  back on his head (`BOW_WITH_HEADPHONES`: three pixels back, five back and one down on the raised
  head), so all of it shows; alone it is where it always was. The review states and rules for all of
  this are one area file, `scripts/areas/watt-wear.mjs` (the `Watt wears` gallery states, the
  `watt wear` fit-check rules and their `watt-star`, `watt-star-menu`, `watt-cup` and `watt-bow` breaks).
- **Stored locally** (`localStorage` key `wall2.watt`, `buddy/pet.ts`): how chatty he is, the
  cosmetic, days together, today's counts, his Stay and his spot on each place (each spot is
  kept only when it is a known place and an x on the stage). His click area, mark and clover sit above the
  shell (`z-index: 1`) and take the pointer only while he is up; carried, he is at `z-index: 40`.
- What he knows comes from existing hooks (`useAgentStatusLine`, `useAgentsWaiting`, the
  agents store, `useWeather`, `useNextMeeting`, the focus store, the audio store and beat
  detector, now playing, `useIdle`); a missing or stale source means he does not mention it.
  `useWeather` and `useNextMeeting` are shared stores (as the agents poll is): one request per
  interval however many components use them.

### Watch (Unwind's second tab)

`wall/src/unwind/watch/`. Which view Unwind shows (Listen or Watch) is one value, `tab`, in
the Watch store (`store.ts`); the tabs set it and nothing in Watch depends on where that
switch sits. Leaving Watch (or Unwind) does not stop a video: it plays on out of sight and is
there, still playing, when the owner comes back (see "The stage layer" below).

- **The list** (`WatchCard.tsx`, right wing above Room): saved items and one field, "Paste a
  YouTube or Twitch link". `links.ts` parses strictly: `youtu.be/<id>`,
  `youtube.com/watch?v=<id>`, `youtube.com/shorts/<id>`, `youtube.com/live/<id>`,
  `youtube.com/playlist?list=<id>`, `music.youtube.com/watch?v=<id>` and
  `music.youtube.com/playlist?list=<id>` (that host exactly, nothing else under it) and
  `twitch.tv/<login>`, with or without the scheme, `www.` or `m.` (YouTube and Twitch only).
  **A link that names a video is saved as that video**, even when it also carries a `list=`
  (what the address bar shows for a video opened from a playlist, a Mix or an album); a
  `watch` link with only a valid list, or a `playlist` link, is saved as the playlist. The list
  a video link also names is never taken silently: after the video is saved, one status line
  under the field reads "Saved the video. The link also names a playlist." with a "Save the
  playlist too" button (the same save path, so "already in the list" and "list is full" read as
  for any link; the focus then returns to the field). No offer is made for a Mix or radio list
  (`list=RD...`) or `WL` and `LL`: those lists are made per viewer or need a sign-in, so a saved
  entry would often play nothing, and the video alone is saved. A video that is already in the list
  keeps its "already in the list" answer, and the offer still follows it, worded "That video is
  already saved. The link also names a playlist.", when that playlist is not saved yet. The line
  goes on the next paste, when the field is typed in, or after 20 seconds; it is state of the card
  and is never saved. An entry saved earlier as a playlist
  from such a link kept no video id (the store writes only kind, id and label), so it is left
  as it is: remove it and paste the link again. Video ids are exactly 11 of `[A-Za-z0-9_-]`, playlist ids
  13 to 64, Twitch logins 3 to 25 of `[a-z0-9_]` (lower-cased; site pages such as
  `directory` are refused). Anything else, a user name, a port, another scheme or a look-alike
  host, gets one plain line. Saved items (kind, id, label, at most 24) are in local storage
  (`wall2-watch-list`), checked whole on every read (`saved.ts`). A new item opens its name
  field; each row plays on click and has rename and remove buttons (32 px, with tooltips).
  Empty, the card explains itself. It shows five whole rows; past five the list scrolls a row
  at a time inside the card, with a visible scrollbar and a fade along the bottom while more
  rows are below.
- **The player** (`PlayerFrame.tsx`, `urls.ts`): one `<iframe>` whose address `embedUrl`
  builds only from a kind and id that pass the checks again: YouTube on
  `https://www.youtube-nocookie.com/embed/<id>` (playlists `/embed/videoseries?list=<id>`)
  with `autoplay=1&controls=0&disablekb=1&fs=0&iv_load_policy=3&playsinline=1&rel=0&enablejsapi=1&origin=<page origin>`
  (the player's own controls, keyboard, fullscreen button and annotations off; `modestbranding`
  is deprecated and not used), Twitch on
  `https://player.twitch.tv/?channel=<login>&parent=<page host>`; `allow="autoplay;
  encrypted-media; picture-in-picture"`, `referrerpolicy="strict-origin-when-cross-origin"`,
  `sandbox="allow-scripts allow-same-origin"`. No third-party script loads.
  The frame takes no pointer (`pointer-events: none` on the frame itself, nothing drawn over
  it), so the players' hover overlays never show. If a play request has not started within 6
  seconds (autoplay refused), the control row says "Click the video to start" and the pointer
  is let through until it plays (over the whole sky, the frame's and Unwind's own boxes let
  the pointer through meanwhile, so a click lands on the picture wherever the wall draws
  nothing). Twitch never says it started: its status stays "Live on the wall", and after the
  same wait one quiet line, "Not started? Click the video", lets the pointer through for one
  click (noticed as the window losing focus to the frame) or 10 seconds; a small "Not
  started?" button asks for it again.
  The end of a playlist item sends nothing (the playlist moves on by itself); the end of a
  single video, a stream or the last item shows "Ended". A state the player reports is never
  sent back to it as a command.
  The wall's own controls drive YouTube through the frame messages, and post nothing before
  the frame's `load` event: the "listening" handshake (once a second until the player answers,
  ten tries at most, never while the page is hidden, cleared on unmount), then `command` messages
  (`playVideo`, `pauseVideo`, `mute`, `unMute`, `setVolume`, `previousVideo`, `nextVideo`,
  `seekTo`) sent only to the exact embed origin. The volume inside the player is set to 100
  and unmuted when playback starts and on Sound on (the system volume sets the level).
  Every message from a frame is outside input and passes `readPlayerMessage`: the exact
  YouTube embed origin AND this frame's own window, a JSON string under 20,000 characters,
  one of `onReady`, `initialDelivery`, `infoDelivery` or `onStateChange`, and only the play
  state, position, length and playlist size and index read, each number finite and clamped.
  The position is taken at most once a second and not while the page is hidden; nothing polls.
  Twitch's frame has no message interface, so it has only Stop (which removes the frame) and
  Open on Twitch. An auto-mix playlist (an id starting `RD`) passes the id check but may not
  play in the embed; Open in YouTube is the way out. Video quality cannot be set from the wall:
  an embedded player picks it from its size.
- **The left block** (`.w-now` in `Watch.tsx`): starts at wall y 30, the line Listen's player
  starts at, so nothing jumps between the two tabs; wall x 624 to 1084. Kind line (y 30), the
  title (up to two lines), for a single video or live stream the channel (one line), "Playing on the wall", the control row, the time bar. The title and
  channel are the player's own (`videoData` in the YouTube embed's `infoDelivery` and
  `initialDelivery` messages, read through the same gate `readPlayerMessage`; no request of
  its own): taken only from the exact embed origin, only when its `video_id` is the id playing,
  cleaned (control, direction and zero-width characters dropped, 200 and 100 characters at
  most) and shown as plain text. Until they arrive the block shows the saved label. A video or
  live item that still has its default label ("YouTube video", "YouTube live stream") takes the
  title as its label once, unless its name field is open; a label the owner typed is never
  changed. A playlist keeps its label and shows no channel; Twitch is unchanged. At rest the
  channel line fades with the kind and status lines. There is no
  Look switch under it and no row of its own for the gear: the looks are chosen in the gear's
  sheet (five picture tiles, or one choice per kind) and in the Tools drawer's Video look.
- **The control row** (`Watch.tsx`, in the left block under the title, the left wing's small
  round `.rd` controls, 40 px): Previous and Next (on only for a playlist the player reports),
  Play or Pause, Mute, Stop, Open in YouTube (or Open on Twitch), and the gear, the row's last
  button (40 px, flush with the end of the time bar): "How video is shown", which opens the sheet
  on its Looks side. The gear fades and returns with the row. With nothing on, the row is the
  Play button for the first saved item and the gear. Under the row the elapsed time, a thin
  bar (a click or the arrow keys seek) and the length, or "Live" for a stream. Closing the sheet
  with Escape or its cross puts the focus back on the gear.
- **For the buddy**: `driveInAudience(state)` in `store.ts` (usable as a store selector) is
  null, or, while something is on in the drive-in look, the screen's rectangle in wall pixels
  (`DRIVE_IN_SCREEN` in `looks.ts`), so the sheep can sit in front of it and watch. The fit
  check compares it with the drawn screen.
- **Open in YouTube** (or Open on Twitch): always in the control row. It calls
  `wall2_watch_open` (`src-tauri/src/wall2_watch.rs`, `wall2` window only) with the kind and
  id; Rust checks them again with the same rules and builds
  `https://www.youtube.com/watch?v=<id>`, `https://www.youtube.com/playlist?list=<id>` or
  `https://www.twitch.tv/<login>` itself. The page never passes an address.
- **Looks** (`looks.ts`, `Watch.tsx`): `feather` (the video in the sky left of the list, its
  edges masked soft, the picture fully visible, in front of the mountains (the owner's choice),
  its lower edge fading out before the horizon line so the ridgelines there show), `sky` (the whole 16:9 picture, never cropped,
  889 by 500 at wall 1106, 16: its top 16 px under the top of the strip, its foot under the
  horizon line BEHIND the ranges and the land, so only the land hides its lower edge, between the
  left block and the cards; its top, left and right edges fade softly into the sky over 120 px
  (`SKY_SOFT_EDGE` in `looks.ts`, carried by the stage as the custom property `--w-sky-soft`; one
  still CSS mask on `.w-sky .w-screen` with smoothstep stops, no filter or blur; the foot is not
  faded, the land hides it; no setting yet). The fade is taken from the picture's own edge and the
  picture keeps its box, size and place, so something very close to an edge fades with it: nothing is
  cut off, a point d px from an edge shows at smoothstep(d / 120), half strength at 60 px, and the
  middle 649 by 380 of the picture is untouched; the embedded player cannot report its video's
  shape, so the frame is fitted as 16:9; it lies under every control and takes no pointer;
  nothing of the wall's is drawn on it: the left block stands beside it on the sky with no plate,
  and the cards turn nearly opaque), `sun` (a 461 px disc at the approved page's place,
  centred at wall x 1331 with its foot 29 px over the horizon, the ranges in front of its lower part,
  a clean circle with no bands across the video (the owner's later words replace the approved
  page's bands), a warm halo and a streak on the floor; it
  shows the middle 56 percent of a 16:9 picture's width) and `drivein` (the Screen tower: the
  video's box is exactly 16:9, 672 by 378 at wall 1244, 54 (`DRIVE_IN_SCREEN`), with no border of its own;
  the frame is one SVG over the whole scene, `DriveInFrame.tsx` with its drawing in `towerFrame.ts`, the first
  child of the stage under the floor light and the screen, taking no pointer: a steel surround with a
  coping and one neon edge line, a Warren truss, two lattice towers and raking stays on footings on the horizon,
  a marquee board, a ground shadow and the legs mirrored in the floor. Every fill round the picture is a
  ring with the box cut out (even-odd) and the neon's glow is clipped to the same ring, so nothing of
  it can cover the picture; a test checks that from the component's own geometry and the fit check
  checks it in the browser. The marquee reads WATT'S DRIVE-IN, NOW SHOWING while playing and
  INTERMISSION while paused (a cross-fade of about a second, at once under reduced motion); with nothing
  on, the empty screen is dark and the marquee reads the name only; the stage light's colours are washed
  on the floor under it, re-centred under the new box and still starting on the horizon) and `holo` (the
  Hologram: the whole 16:9 picture, 736 by 414 at wall 1210, 42, on a pane tilted in 3D
  (`perspective(2400px) rotateY(-7deg) rotateX(1.2deg)`) with `mix-blend-mode: screen` over a dark glass
  plate in the same box and tilt (`HologramPlate`, before the stage), two cyan hairlines and four corner
  ticks outside the picture, and a small emitter on the floor with its beam fan and floor glow
  (`HologramEmitter`, after the stage). It stands in front of the land, claims no front layer, and the
  moon keeps clear of its box; the pointer never reaches the player, but a refused autoplay's click lands
  on the tilted frame's real area. The blend needs the stage and the sky in one layer group: where the
  layering cannot blend (no `mix-blend-mode`, or the main area isolated by a look behind the land) the
  blend is dropped and the plate and the tilt stay). Sky layers: each look claims the horizon's sky
  (`useWatchSky`, `horizon/sky.ts`) with its picture's box (`LOOK_BOXES`, so the moon keeps 40 px
  clear of it: another of its places, or none); the sun and the drive-in own that sky (no moon at
  all); the whole sky and the sun (`behindTheLand`) also give `.w-front`, after the picture, where the
  horizon mounts its front canvas, and their stage sits at z-index -1 in the main area's own
  layer group (`.w-layered`), under every control and line of text. While the player waits for a
  click, the sun comes forward (`layeredNow`). The left block and the Watch list
  card claim their own boxes as keep-clear (`useSkyKeepClear`). The look's claim is held only while
  the stage is in sight; the keep-clear claims go with the Watch panel (Listen, nothing on, another
  place, Zen). The gear on Watch opens a sheet over the right wing on its Looks side; the gear on
  Listen (`LinesGear`, "How the lines move") opens it on its Lines side. A "Looks | Lines" switch
  in its heading row changes the side, and the heading follows it. The Lines side
  (`LinesPanel.tsx`) has one control per 40 px row with its value read back in words, and sizes
  the sheet to its content. The Looks side:
  one look for everything (five picture tiles), or one each for videos and playlists, live
  streams and Twitch (five choices a row), at 540 px (`wall2-watch-look`, checked on read;
  values stored before the newer looks still read the same).
- **Settings for each look** (`lookSettings.ts`, `LookTunePanel.tsx`, key `wall2-watch-look-tune`):
  under the tiles the sheet shows the chosen look's own sliders and switches in the Lines side's
  rows (the value read back in words, a tick at "your usual", "Reset to my usual" for that look
  only, a tooltip on every control, and the foot line "Each look keeps its own settings. Changes
  show at once."). With a look per kind a chooser says which look is adjusted; the settings belong
  to the look, never to the kind of video. Every default is today's number: with nothing moved the
  stage carries no setting at all (the whole sky's soft edge always was carried) and every rule in
  `unwind.css` falls back to today's value, so the wall draws what it always drew. A slider changes
  custom properties on the stage and nothing else. `lookBox(look, settings)` is the one source of
  the picture's box: the stage's place, the sky claim (the moon keeps clear), the edge band, the
  buddy's drive-in audience and fit-check all read it. On load a value outside its range, of the wrong type or not finite is discarded and that one
  field takes its usual value (the rest of the look is kept); a change from the sheet is bounded by
  its control. A limit that depends on another setting (Soft edge by Size, Sun Height by Size) is
  applied where the value is drawn (`resolveTune`), never to what is stored. A slider step updates
  the stage at once and is written to storage at most every 300 ms, and on release, blur, key up
  and when the page is hidden. Dev bundles take `?wtune=sky.size=80,sun.up=-100` (a switch as 0 or 1).

  | Look | Setting | Range | Usual | Limit and why |
  |---|---|---|---|---|
  | Whole sky | Size | 60 to 100 % | 100 | about the foot centre (wall 1550, 516), so smaller only: 100 is as tall as the sky allows |
  | | Soft edge | 0 to 200 px, steps of 1 | 120 | at most 40 % of the picture's smaller side (120 px at 60 %), so the ramps never cross; the stored value is kept when Size takes the limit down, and the sheet says so |
  | | Brightness | 50 to 100 | 90 | |
  | | Floor light | on or off | on | |
  | The sun | Size | 280 to 461 px | 461 | 461 is the largest that fits the sky at the usual height; centre kept at x 1331 |
  | | Height | 100 px sunk to 60 px up | 29 up | the disc's top stays 8 px under the strip's top (at most 497 less the size) |
  | | Glow | 0 to 100, steps of 1 | 50 | halo and rim |
  | | Floor streak | on or off | on | |
  | Feathered | Size | 60 to 108 % | 100 | about the foot centre (1555, 505); at 110 the box would be 1110, 5, 891 by 501 and its right edge (2001) would run 1 px under the list card (x 2000), so it ends at 108 |
  | | Soft edge | 10 to 30 % | 20 | the top and foot fades keep their proportion (17 and 26 percent at 20) |
  | | Glow | 0 to 100 | 50 | |
  | Drive-in | Size | 80 to 105 % | 100 | the screen, the tower and the floor light scale together about the footings (1580, 505); at 110 the tower would reach x 1157 to 2004 (4 px under the list card) and its coping would stand 13 px above the strip, so it ends at 105. The buddy's seat follows the screen |
  | | Floor light | 0 to 100 | 42 | |
  | | Sign under the video | on or off | on | the marquee board and its words; nothing else moves |
  | | Neon line | on or off | on | the neon line and its glow; the steel surround stays |
  | | Travelling light | on or off | off | new, off unless asked for: one soft light (a tenth of the line, a brighter core, a fading tail) travels once round the neon line in 12 s, only while the drive-in shows a playing video; needs the neon line; not drawn while paused, while waiting for a click, with the page hidden, or under reduced motion (the line is simply lit). A CSS dash-offset animation on its own small svg: no script, no layout, no repaint of the stage; it repaints only while a drive-in video plays and never under reduced motion. Its path and bounds are `NEON_PATH` and `NEON_BOUNDS` in `towerFrame.ts`, the same path as the frame's neon |
  | Hologram | Tilt | 0 to 12 degrees | 7 | the pane's reach stays clear of the left block and the cards |
  | | See-through | 10 to 60 | 26 | how much of the wall shows through the glass plate: 100 less the plate's alpha, so 26 is today's 0.74; more shows more |
  | | Beam | on or off | on | the emitter's fan and rays |

  Fit-check (`--area=watchlooks`, the area file `scripts/areas/watchlooks.mjs`) measures every look at both ends of each range (the picture
  is the box the code uses, uncropped 16:9, clear of the left block, clock, tabs and list card,
  nothing painted on it, the whole tower and the travelling light clear of it, hiding the sign
  moves nothing else) and the Looks sheet with its longest section (inside the stage, clear of the
  office slot, controls 32 px at least, text 16 px at least).
- **The stage layer** (`StageLayer.tsx`, watch behaviour): the video's stage (the frame in its
  look, with the player's message bridge) is not part of Unwind. The screens frame
  (`screens/Frame.tsx`) mounts `WatchStageLayer` once in `.top`, Unwind's own box, for every
  place, so the frame element is created once per video and never removed or moved to another
  parent while it lives (an embedded player reloads when it is). On Unwind's Watch tab the stage
  shows in its look exactly as before. Anywhere else (Listen, Work, Home, Meet, Zen) the stage
  is parked: its look's markup goes (a plain 16:9 box, `w-parked`), the layer is `opacity: 0`
  with no pointer (never `display: none` or `visibility: hidden`, which a browser may treat as
  a reason to pause or throttle the frame), and it claims nothing from the sky. The look markup
  lives in `VideoStage` in `StageLayer.tsx`, one block per look before and after the picture;
  every child keeps its slot (null where a look has none), so a look change never re-creates the
  frame either. On the Watch tab Unwind's own boxes let the pointer through to the layer (only
  the wall's blocks take it), so the click to start a refused autoplay and the band over the
  video's lower edge still work; the frame itself takes the pointer only in that click case and
  never while parked. While a video plays out of sight, the rail's Unwind button carries a small
  cyan play mark; its tooltip says "<title> is playing. Click to go to it." and a click goes to
  Unwind's Watch tab. A video that is paused, or waiting for a click, shows a dimmer pause mark
  and "<title> is paused. Click to go to it."; an ended video shows no mark. When the stage is
  parked, focus inside the player frame is dropped, so no key reaches the invisible player. The
  Tools drawer is a drawer over the same place: the video stays where it is under it, and the
  drawer stacks above the layer and its pointer band. Music from Listen and a video can play together; nothing mixes or ducks.
- **The controls fade** (5A, `useControlsFade` in `Watch.tsx`): while a video plays, 3 seconds
  (`CTL_REST_MS`) after the pointer leaves the left block and a 72 px band over the
  video's lower edge (`EdgeBand`, the wall's own transparent box beside the frame, never over
  it), and keyboard focus leaves the controls (a click leaves the clicked button without focus once the pointer is gone), the kind line, the "Playing on the wall" line, the play
  row (the gear is its last button) and the time bar fade to nothing (250 ms; at once under reduced motion)
  and take no pointer; the title stays at half strength with no glow. Pointer, focus or Tab
  brings them back at once. They never fade while paused or ended, with nothing on, or while a
  notice shows ("Click the video to start", "Not started? Click the video", "Could not open the
  browser"). One timer, only while they may fade, cleared on unmount.
  Keys on the Watch tab: Tab shows them and moves through them; Space plays or pauses when the
  focus is on the page, the stage or the left block outside a button (a focused button keeps
  its own Space press; never in a field); Escape stops the video (and that press does not also
  leave fullscreen; a second one does) unless the focus is in a field, a button or a link, or the
  sheet, the tools drawer, a dialog or a menu is open. Elsewhere neither key touches it.
- **When video stops** (`stops.ts`, `useStopRules.ts`, run by the stage layer on every place):
  the page hidden, the display off or Windows locked (`ui/useDisplayDark.ts`, the
  `display-state` half of `useIdle`; input idle never stops a video, since nobody touches the
  mouse while watching), Screens off mode (`monitors-off-mode`), and a call (the signals
  store's `call`), wherever the owner is. The frame is removed, never hidden, and nothing restarts
  it; the left block says why it stopped. Play is off during a call. No wake lock is held.
- **Listen**: when something is saved, the album art has a small "Video" corner that
  switches to Watch. Nothing else on Listen changes.
- **Dev**: `?watch=mock` draws a poster where the frame goes (headless Chromium shows an empty
  frame) and opens Watch; `?wlist=none|three|many`, `?wlook=feather|sky|sun|drivein|holo`, `?wposter=bright` (a pale test picture, the worst case for
  text over video), `?wplay=<n>`,
  `?wsheet=one|kind`, `?wtab=listen`, and a mock player with `?wstate=paused|refused|silent`
  (default: playing at 12:34 of 45:10; a playlist reports item 4 of 24). The stills hold the
  controls shown unless `?wctl=rest` (they fade after 200 ms); `?wplace=work|home|meet` goes
  to that place once the video starts. The gallery and the fit check have Watch states.

### Under the clock (Listen and Watch)

Two rows sit under the Listen and Watch toggles on both tabs (`unwind/UnderClock.tsx`, in the left wing from the
clock's date line to the last row).

- **Pins.** Three places, each a Watch list item or an empty dashed "Add a pin". A click plays the item with the
  Watch store's `play` (which also switches to Watch, so a pin works from Listen); the pin that plays is lit and a
  click on it does nothing new. The name and kind always come from the Watch list, so a rename shows on the pin, and
  an item that left the list leaves an empty place. A word too long for a pin ends in an ellipsis on its line (the full label is in the hover tip). Right-click (or the menu key, or Shift+F10) opens a small menu:
  Replace and Remove on a pin, and the list ("Pin from the Watch list") on an empty place; with an empty Watch list it
  says to add a video first and has an Open Watch button. The pins are kept as three keys under `wall2-watch-pins`
  and read strictly on every load (`watch/pins.ts`). The art square is a drawn gradient from the item's key: no
  thumbnail is fetched.
- **Volume.** On Watch the slider and sound button drive the wall's own video through the YouTube player's own
  `setVolume` (the level is kept in the Watch store under `wall2-watch-volume`, default 100, so nothing changes until
  it is moved; the sound button is the same mute as the play row's). The Windows session is not used for the wall's
  video on purpose: the session is found by process name, but `set_audio_session_volume` changes every session whose
  name contains the given one, and all web view apps (and the wall's own sounds) share `msedgewebview2.exe`, so
  setting it would also move the browser and every other web view app. For the same reason this row never sets a web
  view or browser session, even on Listen. On Listen it drives the player the wall follows through `useAppVolume`
  (the same session and path as the player's own slider, which stays), unless the wall's video is on and not paused
  (playing out of sight). Twitch keeps its own volume, so the row shows dim and disabled for it.
- **Stop in 30 min** (`watch/sleep.ts`). A click steps Off, 30, 60, 90, Off, each counting from the click; the chip
  then reads "Stops in 24 min". It lives at module level (it runs while Unwind is not shown) and is not kept across
  a restart. At the end it takes one observation (a one-shot `get_now_playing` that also works while the page is hidden,
  three seconds at most; a failed or silent read is "unknown", never an answer cached earlier), then, in order:
  Spotify by its own state (signed in and its own playback says playing: one `spotify.pause()`, whatever session the
  observation names and whether or not a wall video is on; paused or unreadable: nothing); the play and pause key, at
  most once, only when the observation names a known outside app (not the wall's own web view, not an unknown or
  missing source, not Spotify when it is signed in) that says playing, aimed at that session and sent before the video
  stops; then the wall's video is stopped with the reason `sleep` ("Stopped by the sleep timer."), always. A toggle
  never starts music. It cannot stop an app the wall does not follow, and an app Windows cannot name is left alone. The
  end is also checked when the page shows again, so a PC that slept past the end stops on wake; the chip's words
  update every ten seconds only while the page shows.
- **Rest and shown.** At rest the rows are quiet (dim text, 42 percent fills, faint borders) but never gone; the
  pointer anywhere on the column from the date line to the last row, an open pin menu, or keyboard focus inside brings
  them to full strength, and they go quiet `CTL_REST_MS` after the last of those leaves.
- **Up next** on Listen moves under the rows and keeps one song (`UpNext` takes a `rows` prop).
- **Dev**: `?wpins=none|one|three|long|gone`, `?wvol=<0..100>`, `?wsleep=<minutes left>|end` and `?wrows=shown`
  (all with `?watch=mock`). The gallery and the fit check have states in `scripts/areas/under-clock.mjs`.

## Home feeds (task card and network tile)

Two cards read your home services. The web view cannot call them (the task
app refuses a request from another origin and the home app sends no CORS
headers), so Rust makes the calls: `src-tauri/src/wall2_feeds.rs`, three async
commands, one shared `ureq` agent with an 8 second timeout, answers capped at
1 MB. No secret is stored anywhere and the two addresses are not in the repository.

### Setting it up: `feeds.json`

Create `feeds.json` in Ridgeline's app config directory, the folder Tauri calls
`app_config_dir` for the identifier `com.havens-consulting.widget-wall2`. On
Windows that is `%APPDATA%\com.havens-consulting.widget-wall2\feeds.json`. The
file is read on every call, so a change applies on the next refresh.

```json
{ "tasksBaseUrl": "https://example.invalid:8443", "homeBaseUrl": "http://192.0.2.10:8080" }
```

- `tasksBaseUrl` must be `https`. `homeBaseUrl` may be `http` or `https`.
- Each is a scheme, host and optional port only. A path (a trailing `/` too), a
  query, a fragment or a user name is refused.
- Prefer a `homeBaseUrl` that is encrypted: the home box's tailnet address (encrypted
  even over `http`) or an `https` front. Plain `http` on the LAN can be spoofed by
  another device on the same network, which could fake a green tile.
- `omniHelperUrl` is optional and `https` only; see "Agents".
- `sonosBaseUrl` is optional: the Sonos service on the home box, scheme, host and port
  only, `http` or `https` (plain `http` to a private address is allowed, as for
  `homeBaseUrl`, with the same spoofing caveat). See "Sound on Home".
- A missing file or key shows "Not set up" on that card, quietly. A malformed
  address shows the card as unavailable.
- `homeSecurityUrl` is optional: the full address of the home app's Security page,
  for example `"homeSecurityUrl": "https://example.invalid/app/#/security"`. It must
  be `https`, may have any path, query or fragment, and may not carry a user name.
  Missing or invalid means the Alarms button stays hidden.

### Task card (Work tab, top right)

The right wing of Work, as the concept's rows (`.tk3`), 70 pixels tall with a 1 pixel rule.

`wall/src/tasks/`. **Due today** is a small list of every open task without the home tag
that is due today or overdue, a mini version of the task app. Work reads
`wall2_tasks_summary({ notTag: "home", due: "today", limit: 60 })`. The block keeps the
height of three rows in every state (one row, two, none, loading, not set up, unavailable):
the heading is at least 24.7 px and the body under it is always 213 px, rows at the top, so
"Always here" below never moves (the fit check asserts the same block box as before in every
state). Three rows are in view and the rest are a scroll away: the mouse wheel with the pointer over the list, a calm 6 px bar at the
right (shown whenever there are more than three rows), a soft fade at the foot while more
rows wait below and at the head once scrolled, and the arrow keys and Page Up and Down when a
row has focus (a key step scrolls smoothly and a held key keeps adding rows to where the last
step was heading; with reduced motion it jumps). The page itself never scrolls with it. A refresh,
or a ticked row leaving the list, keeps the first row in view where it was, instantly. The heading reads "Due today" with the count at
its right ("7", or "7, 2 overdue"); there is no "N more can wait" line on Work. Overdue rows
come first (Rust puts them first, each group in the task app's own order), and each carries one
small amber mark, the Tabler `clock-exclamation` glyph at 18 px, in an 18 px slot just left of the
time column (every row keeps the slot so the tags line up; only an overdue row fills it). Its hover
card says how late in plain words: "Due yesterday", "Due Monday, 2 days ago" (up to six days back),
"Due 12 days ago". Each row: a check circle, the title, the row's tags (see "Tags on task rows"), the
mark slot, and the estimate chip ("15 m", "45 m", "60+ m") in a fixed 78 px column. The chip's hover
card says "Estimate", with the due line for a task that is not overdue.

When nothing is due today the block reads **Next up**, shows the next three tasks (the
read without `due`, as the old "Next three" did, so it is never an empty box) and says "Nothing
due today" in dim text at the heading's right. An account with no open task at all keeps the
heading "Due today" and the body reads "Nothing due today". A failing refresh puts "updated N min ago" in
that slot. Refreshes every 2 minutes while visible and after each completion.
(`useTasks()` with no filter still reads `wall2_tasks_next`; Zen uses that.)

- **Check**: the row shows "Done." with the title struck through, an Undo button and a
  thin bar that runs down over five seconds (no animation with reduced motion); one tick
  waits per row. Undo puts the row back and calls nothing. When the five seconds pass (or
  the place changes) the row is struck through and fades out after 2 seconds;
  `wall2_task_done` sends `PATCH /api/tasks/{id}` with `{"status":"done"}`. If that
  fails the row comes back with "Could not complete." and a Retry button.
- **Open**: a click on a task's title opens it in the task app. `wall2_open_task(id)`
  accepts only an id that one of the last good task reads showed (Work's list, Home's
  chores and the plain next three are kept apart, so one never replaces another), builds
  the address from `tasksBaseUrl`, and opens it with the system's default handler as
  `wall2_open_link` does. The task app has no page for a single task (only the JSON
  `/api/tasks/{id}`), so the address is the app's own page, `tasksBaseUrl` with a
  trailing slash; `task_link` in `wall2_feeds.rs` is the one place to change when it
  gets one. Any other id is refused and nothing happens on the wall.
- **Focus**: hold a row for half a second to start the focus timer with the length
  chosen on the focus card (25 minutes unless changed), named after the task; that
  press opens nothing. A cancelled press or a finger that moves more than 12 pixels
  does neither; with a keyboard, Enter starts focus. Ignored while a session is running
  or paused (a click still opens the task).
- A summary answer without a `next` list counts as a failed read. The label is saved with the session and
  cleared on reset and when the session finishes.
- **States**: "Not set up" (no address), "Nothing due" (empty list), "Tasks
  unavailable" (first read failed), and after a failed refresh the last good list
  with a small "updated N min ago".
- **Estimate and summary**: each task
  carries `est` (`"15"`, `"30"`, `"45"`, `"60plus"` or null), read from the row's
  `estimate` field. `wall2_tasks_summary({ tag?, notTag?, list?, limit?, due? })` returns
  `{ next, remaining, dueTomorrow }` (and `dueToday` with `due`): the first three open tasks, how many more are
  open, and the count and summed minutes (`60plus` counts as 60, no estimate counts
  as 0) of tasks due on the next local day. The filters are all optional and
  combine:
  - `tag` keeps tasks whose `tags` contains it; `notTag` drops tasks whose `tags`
    contains it. Both ignore case. Each is trimmed, then must match
    `^[A-Za-z0-9][A-Za-z0-9 &/_-]{0,39}$`.
  - `list` is a list name, 1 to 60 characters after trimming, no control
    characters. Rust reads `GET /api/buckets` once for the call, finds the bucket
    whose `name` equals it (case and outer spaces ignored) and keeps tasks with that
    `bucket_id`. An unknown name gives an empty summary, not an error.
  - A bad value is refused before any request. None of the three ever goes into a URL.
  - `due` has one allowed value, `"today"` (anything else is refused before any request): it
    keeps the tasks whose due date, in the PC's local time, is today or earlier (overdue). A
    timed task is compared by its instant, an all-day task (or a bare date) by its date text;
    a task with no due date, or one that cannot be read, is never in it. With `due`, `limit`
    may go up to 60 (20 without it) and the answer gains `dueToday`, the count before the
    limit. The task app's list order is not by due date, so overdue tasks are put first; each
    group keeps the app's order. Every row the page can show can be ticked or opened.
  - "Around the house" is `tag: "home"`. Work is `notTag: "home"` with `due: "today"`.

  The existing `wall2_tasks_next` is unchanged.

### Tags on task rows (Work and Home)

Every task row on Work's Due today and Home's Around the house shows its tags the way the
owner's task app draws them: the first tag as a named chip (28 px high, a 16 px glyph and a
600 16 px name), each further tag as a 28 px round dot with its glyph, 6 px apart, text and
glyph in the tag's colour on a 14 percent wash of it with a 38 percent edge. Each chip and dot
has a hover card with the tag's name; tags are not buttons. When the chip would leave the title
under 180 px, every tag of the row is a dot. A row with no tags looks as it did. On Home the
tags sit after the title against the pill column, which is as wide as the widest pill in the list (never under 62 px;
a timed chore's "4:30 PM" needs about 88 px), the same on every row so the tags still line up, and a row with no pill keeps
the room. The list measures its pills and sets `--pill-w`; the pill text never wraps or clips.

Where it comes from: `open_tasks` in `wall2_feeds.rs` keeps up to three tags per row, from the
task's own `tags` strings: trimmed, empty ones dropped, duplicates dropped after lower-casing,
the tag the read filtered by (`home` on Home) dropped, and a tag over 40 characters or with a
control character or invisible format character (direction marks and overrides, isolates, zero width characters) dropped.
This display rule is looser than the filter rule above, so tags with
accents or dots show. `wall2_tasks_summary` also reads the task app's tag list (`GET /api/tags`,
the same timeout and size cap), keeps at most 200 entries as name (lower-cased), icon (only a
plain Tabler name, `^[a-z0-9-]{1,64}$`) and colour (only one of the eleven names `teal blue
green pink magenta lime brown slate khaki orange red`), and joins them to the row tags by
lower-cased name. The list is kept in memory for ten minutes, so the two minute task read does
not fetch it again, and a failed read of it (retried after a minute) never fails the tasks read:
the last good list keeps serving for at most an hour from when it was read, after which rows carry
their tags with no icon and no colour until a read works. Nothing else of the tag list reaches the
page; the page only ever gets names, never markup or CSS.

- **Label**: the tag as the owner typed it when it has any capital letter; otherwise title case
  (a capital for the first letter after the start, a space, a slash, a hyphen or an ampersand, so
  "r&d" is "R&D") with two generic acronym rules: a word of exactly two letters is written in
  capitals ("hr" is "HR") unless it is a common word (am an as at be by do go he if in is it me my no
  of oh ok on or so to up us we), which keeps ordinary title case ("to do" is "To Do"), and a word of
  up to five letters with no vowel (a, e, i, o, u, y; "dbx" is "DBX") is written in capitals. There is no table
  of tag names. A tag that reads wrong (a two letter word that is not an acronym, say) can be
  given an exception in `tag_label` later.
- **Colours** (`tagStyle.ts`): the eleven names map to eight hues as the task app does: teal
  `#6cb6e8`, blue `#7f9cff`, green `#5fc98b`, lime and khaki `#b4cc5c`, pink and red `#f08ac0`,
  magenta `#d389e6`, brown and orange `#c49a74`, slate `#9fb0c6`; no colour is the wall's dim
  text. Each is 4.5 or more as 16 px text on its wash (a test holds it); none needed lightening.
- **Icons**: the owner can pick any Tabler outline icon, so the wall carries the whole set as
  data. `vite-plugin-tabler-icons.mjs` turns `@tabler/icons`' `tabler-nodes-outline.json` (a dev
  dependency) into the virtual module `virtual:tabler-icon-data`, a map from icon name to its
  paths, which only `tasks/tagIcons.tsx` imports, only through `import()`. A production build
  therefore emits it as its own chunk, fetched the first time a tag with an icon name is drawn,
  never on the first load (`npm run prod-check` proves the entry chunk does not hold it). The
  glyph is drawn as an inline SVG from React elements (24 by 24 view box, `currentColor`, 2 px,
  round caps and joins); until the chunk has loaded, and for a name it does not hold, the plain
  `tag` glyph shows.

### Network alarm on every place

The rail's Home icon carries a small amber dot, on every place, while the home security
source reports open alerts; Work's agents header (after the slot meter) and Unwind's status
line carry one quiet chip, "1 network alert" or "N network alerts", whose click goes to Home
(`home/AlarmChip.tsx`). Nothing shows while the source is loading, not set up, down after a
good read, or says its scan is stale. Everything reads one shared security poll
(`useSecurityFeed` in `home/useSecurity.ts`): the rail, the chips, Home's network card and
For you, so there is one read every 5 minutes however many are on screen.

### Home round two (shield, house line, mood pages, chores, now playing)

The home app's desk routes (`src-tauri/src/wall2_desk.rs`, base `homeBaseUrl` in
`feeds.json`, answers capped at 64 KB, nothing logged) feed four commands, all limited to
the `wall2` window and run off the main thread: `wall2_desk_house`
(`GET /api/desk/house`: inside temperature from -40 to 140 F, lit rooms, rooms, stale),
`wall2_desk_rooms` (`GET /api/desk/rooms`: at most 24 rooms, ids of 1 to 16 safe
characters, names of 40), `wall2_desk_security` (`GET /api/desk/security`: alerts with
id, severity mapped to high, medium or low, text capped at 120, time and age; devices,
blocked, unseen, available, stale) and `wall2_desk_clear_alerts`
(`POST /api/desk/security/alerts/clear`, body exactly `{}`, header `X-Desk-Token`; a
success needs `ok: true` and a whole `cleared` count). The token is `homeDeskToken` in
`feeds.json`, read only by Rust; it never reaches the page, a log or an error. The page
has no other way to it: the old app's `save_widget_config` and `load_widget_config`
refuse the `wall2` window (only the old app's `main` window calls them) and any key that
is not 1 to 64 letters, digits, `_` or `-`, so no key can name `feeds.json`. The token is
sent only to an `https` base, a loopback address or a tailnet address (`100.64.0.0/10`
or a `*.ts.net` name); with a plain `http` base on the local network the clear is not
tried and the drawer says "Clear all needs a private or https address". Errors are fixed
words: `not-configured`, `absent` (404, the route is not live yet), `failed`, `stale`,
`not-set-up` (no token), `nothing-to-clear` (409), `forbidden` (403) and
`needs-private-address`. Every part that reads a desk route hides while it answers `absent`.

- **Shield card** (`home/NetworkTile.tsx`, `home/shieldModel.ts`): a ring with one arc
  per open alert (twelve at most, "12+" inside past that), the count inside, the newest
  alert in one line with its shape (amber triangle high, violet diamond medium, open ring
  low). Quiet is a whole mint ring with a check, "All quiet", two fact lines and two doors
  at the right (see "Network and Security card" below). Stale is a grey ring and "as of"
  a time, never mint. Show all (or the newest alert's line, or a click on the card's face) opens the drawer
  (`home/ShieldDrawer.tsx`) with every alert, Open on each and one
  Clear all, which marks every current alert seen in the home app (it has no clear for
  one alert). Clear all clears every alert the home app holds at that moment, including
  any raised after the wall's last read, which the drawer never showed. After it the list
  empties, the drawer closes, the card's heading says "Cleared N alerts" for a few
  seconds and a fresh read follows (a read already out is dropped). While the read is
  stale the drawer's title carries "as of" a time and Clear all says it waits for a fresh
  read. Without a desk token it reads "Clear all: not set up". While the desk route
  is absent the card reads today's `wall2_home_security` and Clear all is hidden.
- **House line** (`home/HouseLine.tsx`): "68° inside. Lights on in two rooms." and a dot
  per room (lit when its lights are on; the name and state on hover), under the weather
  row in the left third (see "Left third" above). Hidden while the routes are absent. The
  "Next" automation line is not built: the home app has no routine schedule yet.
- **Moods** (`home/Moods.tsx`): three large cards; with more, a narrow More card shows
  the next mood peeking, "N more" and dots, and a click or the wheel slides by three.
  Later pages carry a Back arrow, and the last page's More card reads Back. The last
  page shows the last three (the row stops at its end), so no card slot is left empty.
- **Chores** (`home/Chores.tsx`): up to twenty tagged chores, five rows in view (three
  while alerts are open, since the shield card is taller then), a slim scrollbar and the
  wheel with the pointer over the list, and "N more can wait" under it.
- **Sound** (`home/Sound.tsx`): the five plays carry line icons on a colour wash
  (cup, headphones, lamp, moon, laptop). Where reads exactly Office, All Speakers and
  Common Areas, whatever the matching preset is called. Now playing sits at the left: with a Spotify
  track on a house speaker (its device name matches a Sonos speaker or group the Sonos
  read shows playing) the cover, title, artist, where it plays, pause and progress; a
  track on this PC is never shown as the house playing. The position counts on from the
  Spotify read that carries it. Otherwise the play's name or the
  Sonos track, where it plays and pause; with nothing playing, the hour's suggestion. The
  block's layouts (music, the wall's video, both) are described under "Sound on Home".
  Back and next show only when the sound service says it has them.

Dev mocks: `?desk=absent|typical|stale|down` (absent by default), `?alerts=0|1|6|20`,
`?rooms=0|2|4|8`, `?moods=3|7|12`, `?desktoken=none|lan`, and `?spotifyplay=speaker` pairs a
Spotify track with a Sonos speaker. `npm --prefix wall run fit:home` checks the right
column, the drawer, the house area and the mood card widths (`--self-test` breaks each).

### Network and Security card (Home tab, right)

`home/NetworkTile.tsx`, `home/shieldModel.ts` (`shieldFacts`, `severityCounts`, `alertHint`), the card's rules in `styles/home.css`. The card keeps its sizes: 596 by 166 when quiet, not live or not set up, 596 by 250 with alerts open (so Around the house keeps five rows, and three with alerts).

- **Quiet.** The ring (112), the title, "Nothing is open." and two fact lines (16 px, a glyph each) at the left; at the right two doors, 206 wide and 61 high with 12 between: Security ("Home app alarms", opens the home app's alarms page) and Firewalla ("Its own portal"). Each door shows only when the wall has its address (`wall2_links`), the same rule and the same click as before; one door takes the full height. With no door and at least one fact, the facts move to a quiet box at the right, one row each (scan, devices, blocked, alarms); with no door and no fact the text takes the whole width.
- **The fact lines** are drawn only from numbers the home app sent: line one is "Scan 10:24 AM"; line two is "31 devices, 412 blocked" (or whichever of the two exists), or, when it sent neither, "3 alarms in 24 h"; with none of them there is no second line. A fact with no number is never drawn. Hovering a fact says what it is, and "Not live, as of ..." while stale.
- **Alerts open.** The ring (140) with one arc per alert and the count, the title, "3 alerts open, 31 devices at home", the newest alert on one line (its line opens the drawer; long text ends in an ellipsis, the full text and "Show all N open alerts" on hover), the age and the counts by severity ("12 min ago. 1 high, 2 medium."; the age reads "just now", "12 min ago", "3 h ago" or "2 days ago", while the drawer keeps its short "12m"; the counts show only when every open alert is listed and has a severity, so no count is ever short), and a row of equal 50 px buttons: Show all N (filled), Security, Firewalla (the last two only with an address; with neither, Show all stands alone).
- **The title** is one line at 27 px; when it does not fit its column ("Firewall box offline", "Firewall status unknown", "Home app not reachable") it takes two lines at 22 px, the card's box unchanged, and the full title is on hover. The ring's arcs take the alert's severity colour (amber high, violet medium, grey low); an alert whose severity the wall was never told, and every alert past the three the read lists, is a neutral grey, never amber.
- **Not live.** A grey ring, "Nothing was open." (or the alerts as before), the facts dimmed, and the heading's "as of 9:41 AM" (hover: "The home app's last answer"). The scan line is the firewall's own clock (hover: "The firewall's own last scan"), so it can differ from the heading's time. The wall never shows a stale read as live.
- **Not set up, loading, down.** The grey ring and the title (with "Checks again every 5 minutes." when down); no facts, no doors.
- **Could not open** (a door that fails) shows in amber on the heading's right for three seconds.
- Dev stills: `?net=calmbare` (quiet, the home app sent no scan time and no number), `?fw=offline|unknown|unreachable` (the long status titles with doors), `?home=loading`, `?links=security|portal|none` (which doors have an address), `?desk=typical&alerts=0|1|2|3`, `?desk=stale`, `?home=off`. The gallery states and the fit rules (the card's size in each state, 16 px from the card's edge, nothing overlapping, the right side within 24 px of the edge, text 16 px or more, long text ending in an ellipsis; each rule has a break in `--self-test`) are in `wall/scripts/areas/network-card.mjs`.

**Where the alerts come from.** The card reads `GET /api/security?lite=1` every 5 minutes while visible (and the desk route when it answers). The open count follows the home app's own page: an alert whose reviewed request is waiting is hidden; a done request hides it until a newer summary arrives; a failed request hides nothing. The alert rows come from Rust (`top_alerts` in `wall2_feeds.rs`): the visible alerts,
newest first, reading the text from `title`, `message`, `text`, `summary`, `reason` or
`type` (a type slug is turned into words: `abnormal_upload` reads "Abnormal upload"),
the severity from `severity`, `level` or `priority` (mapped to high, medium or
low; amber dot only for high), and the time from an ISO string or epoch seconds or
milliseconds in `ts`, `at`, `time`, `createdAt`, `detectedAt`, `firstSeen` or
`lastSeen`. Text is cleaned of control characters and capped at 120 characters. When
the alerts carry no readable text, the card shows "N open alerts" instead.

- **Green**: "All quiet", or "Up, box online" while alerts are open.
- **Amber**: the scan is stale, the firewall API state is unknown, or the home app
  cannot be reached (a quiet amber line inside the card, never a screen-wide message;
  after a good read the last numbers and rows stay, dimmed).
- **Red**: only when the firewall API is down or the box is offline.
- "Not set up" when there is no address.

Two buttons share the bottom of the card, each half its width and 52 design pixels
tall (see "Pointer and touch" below), shown only when available. **Alarms** opens `homeSecurityUrl` from `feeds.json`.
**Open Firewalla** opens the `portalUrl` from the most recent good security read, and
only when it is `https` on `firewalla.net` or a subdomain. Both open in the default
browser, and Rust does the opening (`wall2_open_link`, kinds `security` and
`portal`); the web view only names the kind and never supplies a URL, and
`capabilities/wall2.json` grants no opener permission. `wall2_links` tells the tile
which buttons to show. A failed open shows "Could not open" for 3 seconds.

Browser dev (`npm run dev`) shows both cards from mocks in `bridge/devMocks/`; the Home
mock also carries the numbers PR 24 will add, so the dev view shows the full card.

## Meet

The Meet tab shows the next meetings from up to two Microsoft 365 calendars for the next 24 hours, a calm countdown to the next one ("In 42 min", "Now, 12 min left", "At 3:30 PM"), and a Join button for Teams links. It makes no sound and flashes nothing; red marks only a call in progress and the Leave key, and the ring turns amber only in the last ten minutes. Cancelled, declined and all-day events are left out, and the same invite on both accounts shows once.

All token and Graph work happens in Rust (`src-tauri/src/wall2_meet/`). The web view sees account states, titles, times, opaque keys and, for the next meetings, names and a cleaned invite text. It never sees a token, an authorization code or a join link: join links stay in Rust behind keys, and the invite text and names, which are outside input, have links, meeting ids, passcodes, phone numbers and addresses removed by fixed rules (see "The wider read, and what it never passes"), a best effort on text that anyone who can send an invitation controls. The content security policy does not change (Graph and login hosts are not allowed in `connect-src`). Every Meet command refuses any window but `wall2`.

### The layout

Meet is one picture, drawn at the stage's own pixels inside `.top` (stage x minus 124, y minus 20), and the frame clock is hidden here because the hero draws the time:

- **The hero** (stage x 124 to 944, `Hero.tsx`): a status row ("In call, Teams" with a red dot; "Now" with a cyan dot when the meeting has started and no call is sensed; "Next, in 20 min" before it) with the time of day at the right; the title (54 px on two lines, 32 px on three lines over 50 characters, then an ellipsis); "Called by <person> · <account>" (no company, no address); the invite's first words (two lines, hidden when there is none); a 164 px ring (minutes to go with the time range under it, filling for the last 30 minutes; minutes left as a share of the meeting, "ends 11:30 AM" under it; past the end, the minutes over in amber under "MIN OVER" and "ended 11:00 AM"; cyan before or with no call sensed, violet in a call, also when joined early, amber with 10 minutes or less left); and the keys. Before or between calls the keys are Join (filled cyan whenever the meeting can be joined; a meeting that is live or within 15 minutes adds a glow) and Open invite (only when exactly one day event has the same account, start, end and title and Outlook can open it). During a Teams or Zoom call they are Mute, Camera, Share and Leave, read from the key library (`teams-mute`, `zoom-leave` and so on) and pressed the way the key deck presses them. Mute never claims a state, because the wall cannot see mute; Camera reads "Camera on" or "Camera off" from the camera signal. A call in the browser draws the four keys dashed and disabled. While a call is sensed the hero is the call: the meeting that was current when it started (or that began within 10 minutes after), kept until the call ends even when the calendar's end passes and the next read no longer lists it, never a later meeting. With no such meeting (an ad hoc call, or the calendar cannot be read) it is a plain call: "In call, Teams", the time, the four keys, the title "Call in progress", no ring, and marks are written under the part "Call". Every kind of hero shows the recording chip while a recorder runs. The people block shows up to five round initials (four and a "+N" when there are more), "N invited" and "4 said yes, 1 maybe"; a person who declined is not drawn. The last row holds the recording chip while a recorder runs and the line "The wall switches to the call by itself when it starts."
- **The island** (stage x 984 to 1914, `Island.tsx`, `islandModel.ts`): one kind large at the left and "Also on file" at the right (one line of preview per other kind), with the order line, left and right arrows and pager dots under them. The arrows, a click on an index row and the dots change the large kind; nothing turns by itself. The kinds that exist today, in this order, each shown only when it has something: **The invite** (the cleaned invite text, source "From the calendar invite"), **Who is coming** (initials, name and reply, "From the invite"), **Your first-meeting list** (from `meet-checklist.txt`; a click ticks an item for this meeting only, in memory) and **Live notes** (this call's marks with their times, "From Capture"). With no kind at all the island shows how the checklist file works in three lines and an Open file button. The known-client kinds (last notes, what is owed, last mail, files) are not built: no source exists in the wall, and the order means they can be added without a redraw.
- **The Next card** (stage x 1944 to 2540, the one panel at the right edge, class `meet-later`): "Next" in a call, "After this" before the hero starts, "Next, back to back" in amber when the meeting after the hero starts from 2 minutes before to 2 minutes after its end, "Next, overlaps" in amber ("Starts before this one ends") when it starts earlier; the meeting after the hero (title, time range and account, then ONE row: "Leave by 11:40 AM" (in a call ", 10 min after this", or amber ", before this ends") when the leave signal is for it, otherwise Join with the amber line when it applies), then "Later" with at most two one-liners and "+5 more today, the last ends 7:00 PM". "N more today" and the latest end count today's meetings only, from the day feed the hero reads (the larger of it and the next read), with no cap; a meeting tomorrow is never called today (its one-liner reads "Tomorrow 9 AM"). With nothing after the hero it says "Nothing else today" and keeps its place.
- **Capture** (stage x 1944 to 2540, y 384, `Capture.tsx`): one tile, "Mark a moment", in the key deck's key style tinted magenta, with this call's marks under it ("2 marked: 03:12, 09:40") and an Open file button for `marks.txt`. A click writes the time in the call and the meeting title (cut to 60 characters) to `marks.txt` through `wall2_onair_mark`, once for a double click. Before a call the tile is dashed and dim and does nothing ("Wakes when the call starts"). The marks of a call stay in memory for Live notes and are cleared when the call ends. The other three Capture keys of the vote picture (Action item, Ask quietly, After the call) are not built: each needs a source the wall does not have.

Every state keeps its words and fills its place: not set up, loading, a failed read, no calendar readable (the last known meeting dimmed with "as of", or "Calendar not available" with Read again), and nothing scheduled ("Nothing scheduled in the next 24 hours"; the island shows the checklist how-to).

### The wider read, and what it never passes

The next-meetings read (not the day read) also selects `organizer`, `attendees` and `bodyPreview`, and `MeetingOut` gains `details: { calledBy, people: [{ name, reply }], peopleMore, invite } | null`. The rules are in `graph.rs` (`shape_details`, `clean_name`, `clean_invite`), each with a unit test on invented data:

- Names only: an address never leaves Rust. A name that holds `@`, `://` or `www.`, or is one bare host or domain, is treated as no name, and a trailing bracketed part (a company in brackets) is removed. Control and invisible format characters are dealt with first, whitespace is collapsed, and names stop at 60 characters. The organizer is matched to the attendee list by identity (the address, in Rust, never sent) before the 20 cap, so they are listed once. At most 20 people are listed; the rest, and every person with no usable name, are counted in `peopleMore`. A reply is `yes`, `maybe`, `no`, `none` or `organizer`.
- `invite` is `bodyPreview` cleaned as a best effort on text that anyone who can send an invitation controls; it removes join links, meeting ids, passcodes, phone numbers and addresses by these fixed rules, and a service or wording they do not know could still let something through. Each line is normalized first (control and invisible format characters, whitespace collapsed), then the text is cut before the first line that holds a run of 8 or more underscores or one of: "microsoft teams", "join on your computer", "join zoom", "google meet", "webex", "meeting id", "meeting-id", "meeting number", "conference id", "access code", "kenncode", "code secret", "passcode", "password", "pin:", "join by phone", "dial in", "dial-in" and the Google divider (not case sensitive); and before the first line or sentence with 9 or more digits once spaces, hyphens and round brackets are taken out. Then every word that holds `://`, `www.` or `@`, starts `tel:`, `sip:`, `mailto:` or `callto:`, is shaped like a host or a host with a path (a dot followed by two letters), or has 5 or more digits is removed; whitespace is collapsed and the text stops at 400 characters. Nothing left is `null`. Tests on invented Teams, Zoom (also German), Google Meet and Webex invites, scheme-less links, hidden characters inside `://` and `www.`, and tab-split markers check the final serialized `details`.
- `Candidate`'s debug output hides the details, and nothing about them is logged.
- If Graph refuses the wider fields (403), the same read is asked again once with the plain fields and `details` is `null` for every meeting; the hero and island then show what the calendar gives (the island falls back to the checklist how-to).

### The checklist file

`meet-checklist.txt` in the app config folder (the folder `feeds.json` lives in): UTF-8, at most 4 KB, one item a line; empty lines and lines starting `#` or `//` are skipped; at most 8 items of 80 characters (`src-tauri/src/wall2_meet/checklist.rs`, the file rules of `wall2_onair.rs`). `wall2_meet_checklist` answers `{ state: 'ok' | 'missing' | 'refused', items, reason }`; `wall2_meet_checklist_open` writes a three-line starter when there is no file and opens it. Both refuse every window but `wall2`, and the path is never taken from the page. The page reads it when Meet shows, when the window gets the focus back and every minute while visible.

### Switching by itself

`meet/autoSwitch.ts`, started from `App.tsx`: when a call goes from none to a call and the place is Work, Home, Unwind or Meet and the page is visible, the wall opens Meet once for that call. It never switches from On Air (a show is running) or Zen, never twice for one call, and never switches back when the call ends. A call that starts while the page is hidden opens Meet once, when the page becomes visible while that call is still on (the same place rules apply then).

### Dev knobs

`?meet=before|known|new|bare|stale|over|clash|heavy` (`devMocks/meet.ts`; `heavy` is in `gallery.ts` with its details from `meet.ts`): `before` has the next meeting 20 minutes away, `known` and `new` a meeting under way with details, `bare` a live meeting with no details, `stale` reads once and then no account answers, `heavy` is the busy day with a long title and 14 people. `over` is a meeting that ended 12 minutes ago (with `call=teams&callsince=-70`, a call that began 70 minutes ago); `clash` has the next meeting start 10 minutes before the hero ends. `?mtitle=long` gives the hero meeting a 206 character title. `?checklist=none|four|long|refused` sets the checklist file. Use them with `call=teams|zoom|browser`, `camera=1`, `rec=1` and `leave=100` (before) or `leave=60` (known, new) for the "Leave by" line. The gallery states and fit rules of this layout are in `scripts/areas/meet-layout.mjs`.

### Setting it up: `meet.json`

Create `meet.json` next to `feeds.json` in Ridgeline's app config directory (`%APPDATA%\com.havens-consulting.widget-wall2\`). It holds no secrets:

```json
{
  "openIn": "desktop",
  "accounts": [
    { "id": "work", "label": "Work", "clientId": "00000000-0000-0000-0000-000000000000" },
    { "id": "second", "label": "Second", "clientId": "00000000-0000-0000-0000-000000000000", "tenant": "common" }
  ]
}
```

- At most two accounts. `id` is 1 to 16 characters of `a-z` and `0-9`, unique. `label` is 1 to 16 printable characters. `clientId` is the application (client) ID of an app registration. `tenant` is optional: `common` (default), `organizations`, `consumers` or a tenant GUID.
- `openIn` is optional. `desktop` is the default and uses classic Outlook when it is usable. `browser` always uses the event's web link. An unknown value keeps the desktop default and is reported in the Tools drawer.
- A missing file shows "Not set up". A file that fails these rules also shows "Not set up" with a note; the native side reports `invalid-config` and never echoes the file.

### Sign in and sign out

Open Tools (the rail button at the bottom, on any place), then "Sign in" on an account under Accounts. Ridgeline opens the system browser at the Microsoft sign-in page and waits up to 5 minutes on a loopback listener (`127.0.0.1`, a random port). The sign-in uses PKCE (S256) and a random `state`; the listener answers 404 to any other path and 400 to a callback whose `state` is wrong or missing (and keeps waiting), and it closes after the first valid callback, a failed or denied answer, a cancel, or the 5 minute limit. The redirect is `http://localhost:<port>/auth-callback.html`; Microsoft ignores the port for `localhost` redirects, so the registrations the old app already uses accept it. If the browser shows AADSTS50011 (reply URL mismatch), add `http://localhost/auth-callback.html` under "Mobile and desktop applications" in that app registration.

The only scopes asked for are `offline_access` and `Calendars.Read`. After the first sign-in Ridgeline refreshes silently. "Sign out" deletes the stored token and the cached access token on this machine; it does not call Microsoft. "Cancel" ends a waiting sign-in. A sign-in that Microsoft rejects later (`invalid_grant`, or another refusal such as `consent_required`) shows "Sign in needed". Closing Tools during a sign-in cancels it. If one account is unavailable, its last meetings and Join buttons stay (with "updated N min ago") until it answers again.

### Where the token lives

The refresh token is kept in Windows Credential Manager (Windows Credentials, Generic), target `WidgetWall2/meet/<id>/<n>`, user name `wall2`. A generic credential holds at most 2560 bytes, so a long token is split over up to four entries (`/0`, `/1`, and so on). Credential Manager protects them per Windows user. Access tokens are kept in memory only and are never written anywhere.

### Day feed

`wall2_meet_day` returns today's and tomorrow's events for the day ribbon and Unwind's
Tomorrow: from local midnight to the local midnight that ends tomorrow (found by local
date, so a 23 or 25 hour day on a clock change is right), past events included, up to 40
merged across both accounts, earliest first. The ribbon draws only today's. Each event has `key`, `accountId`, `title`, `start`, `end`, `canJoin`, `canOpen` and
`isLive`, with the same rules as the next-meetings read (no people and no invite text:
the day read keeps the plain `$select`; cancelled, declined and all-day events left out; the same invite on both
accounts once; join links behind keys). `isLive` is true when the subject starts with
"Livestream". Day keys start with `d` and live in their own map, so a day read never
invalidates a Join key from the next-meetings read. An unavailable account adds no
events to the day view (there is no "updated N min ago" copy here).

### Join links

Join opens only a Teams meeting link: `https` with no user name, password or port other than 443, host exactly `teams.microsoft.com` or `teams.live.com`, a path starting `/l/meetup-join/` or `/meet/`, and at most 2048 characters. Anything else (Zoom, Google Meet, a Safe Links wrapper, an unknown Teams format) shows no Join button. The link stays in Rust behind a key like `3-1`; the web view passes only the key, and Rust checks the rules again before opening it in the system browser. The Ridgeline capability has no opener permission.

### Opening an event in Outlook

The day read selects Graph's `webLink` and asks for the `Binary 0x0FFF` legacy extended property for each event. That property is decoded only when it is standard base64 containing 20 to 512 bytes, then kept as uppercase hex in Rust. Both values stay behind the same day key, are cleared with the day keys on every day read, and are dropped for an account at sign-out. The web view gets only `canOpen: true`. If Graph refuses the extended property request with status 400 or 501, Ridgeline retries once without it so the calendar still works.

With `openIn` set to `desktop` or omitted, `wall2_open_event(key)` first looks for classic Outlook in its registered Windows application path. The path must be absolute, no longer than 260 characters, name `OUTLOOK.EXE`, contain no quote or control character, and exist as a file. When Windows says the new Outlook is selected, classic Outlook is not used. An event with a valid entry id starts that fixed executable directly with the two arguments `/select` and `outlook:<HEX>`. An event without an entry id starts it with `/select` and `outlook:calendar`. No shell or joined command line is used. If Outlook is unavailable, process start fails, or `openIn` is `browser`, Ridgeline checks the stored web link again (`https`, no user name or password, no port other than 443, at most 4096 characters, and an exact allowed Outlook host) and opens it with the default handler. The page supplies only the opaque day key, and nothing about the entry id is sent to the page or logged.

New Outlook has no documented way to open one existing meeting. The Tools drawer reports whether clicks use classic Outlook or the browser. These behaviors have not been verified against live Graph and Outlook: whether the calendar read returns the item id, what item id it returns for one occurrence of a recurring meeting, whether a second account's mailbox opens from the same Outlook profile, whether current classic Outlook builds honor `/select outlook:<HEX>`, registry discovery across 64-bit and 32-bit views, new Outlook detection, process launch, and fallback behavior. Outlook shows its own error box when it cannot find an item, and Ridgeline cannot detect that result. Use `"openIn": "browser"` to opt out.

### Refresh

The list is read when Meet opens and every 5 minutes while Meet is the active place and the window is visible. The countdown ticks every 30 seconds from the last list. A failed read keeps the last list and shows "updated N min ago". When a read leaves an account unavailable, Meet reads again after 30 seconds, then after 60 seconds, then goes back to the 5 minute cadence; the fast retries stop when Meet is hidden, and Try again does not use them up. The calendar read asks for at most 50 events in the next 24 hours and ignores paging (50 is plenty for a day). It selects only the subject, times, response, join link, invite id, web link and the `Binary 0x0FFF` extended property, the next-meetings read also asks for the organizer, the attendees and `bodyPreview` (see "The wider read" below), and the day read never does.

### Why an account is unavailable

An account row in Tools shows one plain line ("Microsoft is not answering", "Network problem", "Signed out", "Sign-in expired") and, for a failing account, when it checks next as a relative time ("checking again in 2 min"). The code (one of the fixed shapes below, with a plain reading) and the exact time of the last try are in the row's tooltip, never on its face. A failing row has Try again; a signed-out or expired account has the cyan Sign in. Meet itself shows only one amber line under the hero's title ("Second calendar signed out. Open Tools"), whose link opens Tools with Accounts ringed for 2 seconds. When one account is read and another is not, the Next card (when nothing follows the hero) says "Nothing else on <account>" with a dim line for the other ("<account> not read since 9:40 AM", "is signed out", "is being checked" while it is still being read), and the hero says "may be out of date" whenever any account is not read yet or not fresh. The Next card says "Nothing else today" only when every account was read fresh. "checking again in N min" counts to the real next read: the earlier of the next fast retry and the next 5 minute poll. The last known meetings are kept per account and only for an account whose read failed; signing an account out (or its sign-in expiring) drops its meetings at once. When every account fails, the last known meeting stays as the hero, dimmed, with its time range and "as of <time>" (no countdown, no ring, no keys); a "Calendar not available" block (with the last good read and the link to Tools) shows only when there is no last known meeting. Join is filled only for a meeting that is live or starts within 15 minutes; every other Join is quiet and outlined. When Meet is not set up it says "Calendar is not connected yet." with "Setup steps are in the Ridgeline README, section Meet." under it. A code has one of these fixed shapes and nothing else:

| Code | Meaning | Shown as |
| --- | --- | --- |
| `graph-<status>` | Graph answered with that HTTP status and a JSON body with no usable error code | 403 "Calendar refused the request", 400 "Calendar did not understand the request", 429 and 5xx "Microsoft is busy", 401 "Calendar did not accept the sign-in", other "Calendar could not be read" |
| `graph-<status>-<code>` | The same, plus Graph's `error.code` when it matches `^[A-Za-z][A-Za-z0-9_]{0,39}$` | the same words as its status |
| `graph-network` | Transport error (no connection, refused, a read that timed out) | "No connection to Microsoft" |
| `graph-timeout` | The read's 12 second budget ran out before Graph could be asked or asked again | "Microsoft did not answer in time" |
| `graph-body` | A reply that could not be read: a 2xx body too large or not JSON, or an error body over 16 KB, not JSON or cut short | "Calendar sent a reply that could not be read" |
| `token-<status>` | HTTP status of the token endpoint, on a refresh or on the first redemption after the browser callback | "Sign-in was not accepted" |
| `token-<status>-<n>` | The same, plus the first number of `error_codes` (digits only, at most seven), for example `token-400-9002327` | "Sign-in was not accepted" |
| `token-network` | The token endpoint could not be reached (the log line says `host=login` and the class) | "No connection to Microsoft" |
| `store-write` | Credential Manager refused to save the sign-in | "Could not save the sign-in on this PC" |
| `store-read` | Credential Manager could not be read (anything but "not found"); nothing is deleted or overwritten | "Could not save the sign-in on this PC" |

An error body is read up to 16 KB (one more byte is read to tell that it was too big), and only to find `error.code` or `error_codes`. A code that fails the check is dropped and only the status stays. A failed first redemption (the browser said "Signed in" but the token step failed) shows the same kind of code in the notice under Accounts.

### Reading Meet: limits, retries, parallel accounts

- **Timeouts.** Every token and Graph request connects within 2 seconds per address (the client tries a host's addresses one after another, each with the whole connect timeout, so a dead IPv6 route used to eat 5 seconds before IPv4 was tried), waits at most 10 seconds for a read and stops at 12 seconds in all. One read has one absolute 12 second deadline that covers everything in it: the wait for the account's turn, the token request (its timeout is what remains), each Graph attempt, the retry waits and the refresh after a 401. A read that reaches the deadline while waiting for its turn answers `graph-timeout` and starts no token request. Only one read per account runs at a time; a second one for the same account waits for the first or gives up at its own deadline.
- **Retries.** A Graph 429, 503 or 504 is tried again, up to twice more (three attempts), after 0.5 s then 1 s, or after the `Retry-After` header (whole seconds or an HTTP date, never negative, at most 5 seconds), and only when the wait still fits in the budget. Nothing else is retried: not a 500, 502, 4xx, a network failure or a reply that cannot be read. A 401 refreshes the token once and asks once more, as before.
- **Accounts do not wait for each other.** The accounts are read at the same time. The Meet screen asks `wall2_meet_next` three ways: `{ peek: true }` (no network: the accounts and their last known state, "checking" before the first read), then `{ only: "<id>" }` once per account, in parallel; each answer is shown the moment it arrives, and an answer with a lower `seq` than one already shown is dropped. With no arguments (the Work Next block) every account is read in parallel and the newest answer is returned. `wall2_meet_day` reads its accounts in parallel the same way.
- **The screen's limit.** Meet leaves "Loading meetings" as soon as the peek answers, and an account that has not answered within 12 seconds shows "Microsoft is not answering" with Try again and the time of the try.
- **Quiet lines.** When no account can be read (all signed out, needing sign in or not answering) the Work Next block and the day ribbon's calendar row say "Calendar not available" instead of showing nothing, and Meet says it in its main card.

### The calendarView request

One request per account per read, `GET https://graph.microsoft.com/v1.0/me/calendarView` with these query options and no others:

| Option | Value |
| --- | --- |
| `startDateTime` | UTC with a `Z`, for example `2026-11-12T17:00:00Z` (URL encoded) |
| `endDateTime` | UTC with a `Z`: 24 hours later for the next-meetings read; the end of tomorrow for the day read (at most 49 hours) |
| `$select` | `subject,start,end,isAllDay,isCancelled,responseStatus,onlineMeeting,onlineMeetingUrl,iCalUId,webLink` for the day read; the next-meetings read adds `organizer,attendees,bodyPreview` (`SELECT_DETAILS` in `graph.rs`) |
| `$orderby` | `start/dateTime` |
| `$top` | `50` |

Headers: `Authorization: Bearer <token>`, `Prefer: outlook.timezone="UTC"`, `Accept: application/json`, `client-request-id: <a fresh GUID per attempt>` and `return-client-request-id: true`. There is no `$filter`, no `$skip`, no `$expand`, and cancelled, declined and all-day events are dropped in Rust. A unit test pins the exact URL and the option names.

### The Meet log: `wall2-meet.log`

Ridgeline writes `wall2-meet.log` in the app log directory (Tauri's `app_log_dir`, `%LOCALAPPDATA%\com.havens-consulting.widget-wall2\logs\`, the same folder as `wall2-placement.log`). It is cleared at every launch and capped at 64 KB, and a write failure is ignored. A line is written each time an account's state or reason changes, and also for every failed Graph call (so a repeat failure can be traced):

```
2026-11-12T17:00:00Z hc start ok none
2026-11-12T17:05:00Z hc ok unavailable graph-403-ErrorAccessDenied req=next host=graph status=403 net=none af=unknown code=ErrorAccessDenied inner=none request-id=<guid> client-request-id=<guid> attempt=1 ms=412 phase=none resolved=0 dns-ms=none v4=none v6=none
```

The first five fields are the UTC time, the account `id` from `meet.json`, the old state, the new state and the reason code (`none` when there is none). A Graph failure adds, in this order: `req` (`next` or `day`), `host` (`graph`, or `login` for the token request), `status` (the HTTP status, or `network` when no reply came), `net` (for a network failure its class: `dns`, `connect`, `timeout`, `reset` or `other`, taken from the error kinds and never from error text; `none` otherwise), `af` (the address families the lookup returned: `v4`, `v6`, `both`, or `unknown` when no lookup was seen), `code` and `inner` (Graph's error code and inner error code, `none` when absent or not a plain name), `request-id` and `client-request-id` (Graph's response headers, `none` when absent or not a plain id), `attempt` (which try, 1 to 3) and `ms` (milliseconds since the read began, not counting the probe below). A failed call ends with five more fixed fields: `phase` (`dns`, `connect`, `tls`, `post-connect`, `headers`, `body`, `body-size` or `none`), `resolved` (how many addresses the lookup returned, not how many were tried), `dns-ms` (the lookup's time, or `none`), and `v4` and `v6` (`none`, `skip`, `ok<ms>` or `fail<ms>`: a one second raw TCP connect to the first address of each family, run after a failure and not repeated for that host until a call to it has succeeded or ten minutes have passed, shown as `skip` in between). `post-connect` means the connection was made but the TLS handshake, the request send or the wait for headers failed; the client cannot tell these apart, and a finer probe is the next step only if the owner's log shows it. `body-size` is a reply over the size cap, not a network fault. A line is cut at 400 characters. The states are `start`, `ok`, `signed-out`, `needs-sign-in`, `unavailable`, `signed-in` and `sign-in-failed`.

### What is never logged

The Meet module has no `println!`, `eprintln!` or `dbg!`, and the only file it writes is `wall2-meet.log` above. Tokens, codes, `state`, the verifier, query strings, URLs, email addresses, names, meeting subjects and HTTP bodies never reach a log (a failed Graph call adds only the status, Graph's error code names, the two request ids, the attempt number and the elapsed time, each checked against a plain character set), a reason code or an error text. Every failure maps to a fixed string (`not-configured`, `invalid-config`, `busy`, `cancelled`, `timed-out`, `denied`, `failed`, `gone`, `forbidden`) or to one of the reason codes above, which are built only from numbers and a checked `error.code`.

## Agents

Ridgeline reads a small helper service on the home box (the agent lanes helper) through Rust, like the other feeds: `src-tauri/src/wall2_omni.rs`. The web view never sees the helper's address and never supplies a URL.

### Setting it up

Add one optional key to `feeds.json` (see "Setting it up: `feeds.json`"):

```json
{ "omniHelperUrl": "https://example.invalid:8790", "omniLinkHost": "example.invalid" }
```

- `omniHelperUrl` must be `https`, a scheme, host and optional port only. A path, query, fragment or user name is refused, as for `tasksBaseUrl`.
- A missing key means "not set up", not an error: the commands answer `not-configured` and `wall2_machines` returns no box numbers.
- A bad address answers `invalid-config`.
- `omniLinkHost` is optional: the bare hostname the session deep links use (1 to 253 characters, dot separated labels of letters, digits and hyphens; no scheme, port, path or user name). Missing means session links are unavailable: `wall2_open_session` answers `not-configured` and the summary carries `linksAvailable: false` so the UI can hide the tap. An invalid value answers `invalid-config`.

### Commands

- `wall2_omni_summary` reads `GET /wall/v1/summary` and returns the typed summary: slots, up to three lanes, parked count, your move, Claude usage, the day's spans and the box `system` block. Titles and lines are capped at 80 characters, ids must match `^[a-f0-9-]{8,64}$` (a lane with any other id is dropped), the answer is read through a 64 KB cap and fails as soon as it is over, whole-number counts only (slot numbers kept as sent, so "5 of 4 slots" shows as it is, up to 99; elapsed time capped at 7 days, PR numbers positive), `usage.claude5hPct` may be null (the weekly figure still shows); every timestamp must be RFC 3339 with `Z` or an offset and at most 40 characters: a bad `now` fails the answer, a bad `since` or `weekResetsAt` becomes null, and a day span with a bad start or end, or an end before its start, is dropped, bidirectional and zero-width characters are dropped from text, and picture `options` are never passed on. A malformed or oversized answer, or any network failure, answers `failed`.
- From helper 1.1.0 the summary also carries, all optional so an older helper's answer reads as before: `sessionsList` (every open parent or standalone session, up to 12, deduplicated, or null), per session `live` (`working` or `idle`), `idleS`, `kids` (`{ total, working }`, working never above total), `waitingSinceS`, `next` (up to 60 characters), `harness` (`claude`, `codex` or `other`; any other text is `other`) and `failed` (true only for `true`); `sessions` (a map of up to 40 ids to `{ title, stage, state }` for naming bars of sessions with no card); `yourMove.ids` (up to 5 waiting ids); `usage.accounts` (up to 6 `{ provider, label, weekPct, fiveHourPct, weekResetsAt }`, labels up to 24 characters) with `usage.claudeWeekPct` now nullable; and `slots.sessions`, `slots.working`, `slots.helpers`. Helper 1.3.0 can also send per-session `bg` (`{ agents, shells }`), `kids.running`, and `slots.busy`; each is optional and bounded, so an older helper still reads exactly as before. The same id, text, number and time rules apply to each.
- `wall2_open_session(id)` accepts only an id that matches the same pattern and appeared in the most recent successful summary (its lanes, session list, waiting ids, first waiting entry, names map or day log), builds `omnigent://<omniLinkHost>/c/<id>` in Rust and opens it. Any other id is refused.
- `wall2_focus_omnigent(id?)` opens the session as `wall2_open_session` does (when an id is given), then brings the OmniGent desktop window forward on the primary monitor. It trusts only the executable registered for `omnigent://` links (the default value of `Software\Classes\omnigent\shell\open\command` under HKCU, then HKLM; the quoted or unquoted path is parsed and compared in full, case-insensitively, after dropping a `\\?\` prefix), so a program with the same file name in another folder is refused; with no handler registered nothing is brought forward (the link still opens). It looks for a visible, unowned, titled top-level window of that executable every 100 ms for up to 2 seconds, skipping a hung window, restores it if minimised, moves it into the primary monitor's work area if it is elsewhere (keeping it maximised if it was), and sets it foreground, using only calls that cannot block on another program's message loop (`ShowWindowAsync`, `SetWindowPos` with `SWP_ASYNCWINDOWPOS`). One attempt runs at a time; a click while one runs starts none. If no window turns up, nothing more happens. Windows only; elsewhere the second step does nothing. When the wall itself sits on the primary monitor it stays above OmniGent (it is always on top).
- `wall2_machines` returns `{ pc: { cpuPct, gpuPct, ramPct }, box: { cpuPct, gpuPct, ramPct, tempC } | null, boxStale }`. The PC numbers come from the same function as the old `get_system_stats` (which is unchanged). The PC numbers are returned at once on every call. The box numbers come from the helper summary's `system` block, refreshed in the background (one read at a time, at most one every 15 seconds, 3 second timeout), so a slow helper never delays the PC numbers and the first call after start shows `box: null`. After a failed read the last good box numbers stay with `boxStale: true` for up to 10 minutes, then `box` is `null`. `box` is also `null` when the helper is not set up. The numbers are kept per `omniHelperUrl`, so a changed address never shows the old host's numbers.
- All of them refuse any window but `wall2` (`forbidden`).

Nothing here logs, and nothing here takes a wake lock or sets an execution state. Browser dev (`npm run dev`) shows mock answers from `devMocks/omni.ts`; `?agents=3` (default), `2`, `1`, `0`, `7`, `12` (sessions from a helper 1.1.0 answer, with three subscriptions, one near full), `helpers` (an idle own turn with two agents, one command and one child still running), `ask` (one waiting), `ask2` (two waiting, one not on a card), `failed`, `12busy` (twelve open, nine working at once, over the limit of 4 since mid morning, one waiting, one failed, one idle, and a helper's run that is never counted; add `&limit=0` for a helper that sends no limit), `old` (an older helper's answer), `stale`, `off` (not set up) or `down` (not answering) picks the helper's state.

### Saved records

The helper keeps a record of each day (`GET /wall/v1/days`, `GET /wall/v1/day?date=`, read by
`wall2_omni_days` and `wall2_omni_day`; see "The frame and the day ribbon"). Its contract, from
helper version 1.2.2 on: a day record holds only parent and standalone sessions. Children and
side chats are resolved to their top parent before anything is recorded, and older day files
were cleaned on the helper's side. That is why a row from a saved record may open its session.

### Agent lanes (Work centre)

`wall/src/agents/`, as in the concept's `f_work`:

- **Data** (`useAgents.ts`): one poll of `wall2_omni_summary` shared by everything that reads it, on mount and every 15 seconds while the page is visible and at least one reader is mounted. Nothing while hidden. One read at a time; a read over 10 seconds counts as failed, and a lane or day span with a missing or wrongly typed field is dropped. `not-configured` or `invalid-config` is "not set up". A failed read keeps the last answer, marked stale, for up to 30 minutes; with no earlier answer, or when the helper's own `now` has not moved for 30 minutes of this PC's time (a frozen helper), it is "not reachable". The two machines' clocks are never compared: the first answer is always accepted, and the skew (the helper's `now` minus this PC's time when the answer arrived) is taken off every helper time before the ribbon draws it. When the page comes back after more than 15 seconds away, the kept answer is stale until the first new read returns.
- **Stale is never live**: while the answer is stale the lanes dim with "updated N min ago", the ribbon's agent row dims and its open runs end at the last good answer's time, `useAgentStatusLine()` returns null and `useAgentsWaiting()` returns false.
- **Header**: "Agents", the slot meter (a pip per slot up to six, the lit ones in the colour of how many work now against the limit: mint 1, cyan 2, violet 3, amber at the limit, red and hatched over it; "9 of 4 working", "at the limit" at it, and over it a tag with a warning mark, "5 over"; the count is the one rule in "How many work at once" under the frame and the day ribbon), a hover with the count, open sessions and the limit, today's time over and at the limit ("Today: over 4 for 1 h 48 m, at 4 for 12 m."), what is counted, and a click that brings OmniGent forward; "3 of 7" when more sessions are open than fit (a click shows the next three); and the network alarm chip ("4 network alerts", see "Network alarm on every place"). Nothing in the header wraps: when it is tight its parts give way in order, the meter's sentence to "5 of 4" (the over tag stays), then to the pips and the tag alone (the full text in the hover), then the alarm chip to a dot and its count; "3 of 8" always stays whole, and the One thing button's title truncates last with an ellipsis (`HeaderFit` in `agents/Lanes.tsx`; the fit check fails on any header part taller than one line). On the right: the button "One thing for you: <title>" in amber, which opens that session and brings OmniGent forward; "then N more" (counting only the up to five ids it can step through, "and more" beyond) opens the next and the header names it ("Also for you: <title>"), wrapping back to the first; with something waiting but no id, "Something needs you", which brings OmniGent forward. With nothing waiting, "Ready to merge: <title>" in mint when a card is ready for Hold to merge (a click shows that card), else "No agent needs you" (it only knows about agents). The waiting list is the helper's `yourMove.ids` (or its first entry) plus any waiting card, less any snoozed here; a title comes from the cards, the first entry or the names map. **Stale**: the header, slot meter, count, parked line and usage meters dim with "updated N min ago"; the amber call to action goes grey and the One thing button and slot meter do nothing; with nothing waiting it reads "Last known: no agent needed you, as of 10:02 AM" with a grey dot, never an all-clear. Cards still open, and their hover says "All of this is as of N min ago".
- **Which session opens.** "Open chat", the "Open what waits on me" key and the For you rows always open the parent or standalone session, never a child session: the helper sends parent ids (from helper 1.2.0) and the wall opens exactly the id it is given.
- **Cards** (`Lane.tsx`, `StageTrack.tsx`, `LaneRing.tsx`): parents and standalone sessions only (`sessionsList`, or the three lanes from an older helper), numbered 1 to N on the ring. Three are in view; more scroll with the wheel a card at a time (scroll snap), with a thin scrollbar that shows on hover; the page never moves. The title takes every free pixel; hover shows the full title with the details. The second line says the most useful thing first: waiting on you (amber: the helper's question for it when there is one, else "Waiting on you for 12 min"), failed (red), what it is doing or its next step, then "Working now" or "Idle for 5 min"; after it, quietly, as many whole facts as fit (helpers, which assistant, the PR with checks), dropped from the end and never cut inside a word, all of them in the hover. A waiting card has an amber edge, an amber ring with "?" and two buttons in place of the time: "Open chat" (opens it and brings OmniGent forward) and "Later", which quietens it for 15 minutes on this display only (kept in this display's storage, nothing sent anywhere): the card keeps a small amber dot and "Snoozed until 10:41 AM", the header and the dot over Watt stop counting it, and it comes back by itself. A failed card has a red edge and a warning sign. The time at the right says what it measures in its hover ("Working, open for 42 min, started 9:42 AM") and reads "idle 12 min" when the helper says how long it has been idle. Only the card with "Hold to merge" takes the button's extra width, from the end of its own track, so every track starts in line. With fewer than three cards they grow (to 150 px) and the quiet facts move to a third line.
- **Stage colours**: Plan, Build, Review, PR and Live each have a colour (`--st-plan` to `--st-live` in `tokens.css`, cool to warm, Live a yellow-green kept apart from the failed red, from amber and from the pink PR colour; amber and mint are kept for "waits on you" and "done"), used on the track (done stages dimmed, the current one glowing), the card's ring and the ribbon bars' left notch. Hover on a track shows the legend. Each measures at least 4.7:1 on the lane glass and the ribbon on the morning, noon, sunset and night skies; the inactive stage labels (6:1) and the timeline row numbers are at least 11 px.
- **Click**: each card's open action is a real button stretched under its content (Tab reaches it, then the card's own buttons); a click anywhere on the card but those buttons calls `wall2_focus_omnigent(id)`: the session opens and OmniGent comes forward. When the summary says `linksAvailable: false` there is no open button.
- **Hold to merge**: drawn on a lane whose PR is ready with checks passing (or none). Until the merge path lands (PR 30), a hold of 600 ms opens the chat; a short tap does nothing but show "Hold" for a moment. A move of more than 12 px, leaving the button or a pointer cancel ends the hold with no hint. Enter or Space on the button opens the chat. The button's events never reach the lane.
- **Free slots**: with fewer than three cards, slim quiet "Free slot" rows (58 px). With no card at all, one slim "All three slots free" row and the focus timer with the weather, a little smaller.
- **Shelf** (`Shelf.tsx`): "N parked sessions" (or "Nothing parked"; hover: "put aside with a note; open OmniGent to resume one"; a click brings OmniGent forward) and usage: one small meter per subscription from a newer helper ("Claude 1", "Claude 2", "Codex"; "n/a" when the helper has no recent reading), with the five hour figure inline when there are two or fewer and the reset time on hover. Amber goes only to a figure the meter shows (the fullest, above 90 percent); a five hour figure above 90 that is not shown inline gets a small amber mark, its number in the hover. From an older helper, the Claude five hour figure and "Claude this week" with a bar, as before. The mail count waits for the mail scope (D7).
- **Ribbon** (`ribbon/AgentRow.tsx`, Work only): one sub-row per session with a span today, in the cards' order, then sessions that ended today. Every sub-row is 8 px tall so a mouse can hit it, and three fit; with more sessions the third row becomes "+N more", whose hover lists each folded session (name, stage, state) and whose click shows the first of them in the cards. No two sessions ever share pixels. The card's number sits at the left of each session's first bar and its stage colour is the bar's left notch. Running cyan, waiting on you amber, a finished run grey, done grey with a mint cap, up to now. Hover shows the session's name (from the names map for a session with no card, else "An earlier session"), stage and spans in plain words ("working 2:10 to 3:40, waiting on you since 3:40"); a click opens it in OmniGent. Hover on the row's icon gives the day in one line ("Today: 5 h 10 m of agent work across 4 sessions, 40 min waiting on you"). A task due label that would sit on the bars shows only its diamond, the label in its hover.
- **Clock carry-over**: any change of the helper's `now` counts as movement, so a helper clock that is corrected backwards never reads as frozen.
- **Hooks for other places**: `useAgentStatusLine()` gives one line ("Two agents still working, nothing needs you") or null when not set up, for Watt's status line; `useAgentsWaiting()` is true while something waits, for the amber dot over Watt. Both share the same poll.

## The key deck (Work, right wing)

Two rows under "Due today", in one box (`.deck`): **Always here** and **Now**. Both act on the owner's Windows PC outside the wall, only on a click on the wall, and fail closed. None of it has been run on a real Windows machine yet: CI compiles and unit-tests the decisions, the Win32 calls are unverified. The deck is not drawn on a build where the commands do not exist.

Files: `Keys.tsx` (Now), `PinnedRow.tsx` (Always here), `KeyMenu.tsx`, `KeyPicker.tsx`, `forYou.ts`, `wallActions.ts`, `libraryModel.ts`, `keysModel.ts`, `keysFeed.ts`, `keyPress.ts`, `deckStore.ts`; Rust in `src-tauri/src/wall2_keys.rs` (config, chords, sending), `wall2_keylib.rs` (the library and the list of wall actions) and `wall2_arrange.rs` (window layouts).

### What a key can do

A key is either a **chord** (keys pressed in the program in front) or a **wall action**, one of a fixed list that Rust checks (`parse_action`). The page sends only a set id and a key index (or a library id). Rust answers one of three ways: the chord was sent, Rust ran the action itself (only `lock` and `displays:off`, which are system calls), or the fixed action name, which the page then runs through the control or command the wall already has for it. Each action is only what a visible control already does, and only on a click. Opening apps, files or links is not part of this.

| Action | What it does |
|---|---|
| `layout:thirds`, `layout:focus`, `layout:record169`, `layout:zones`, `layout:undo` | The window layouts below, and their Undo. Off, with the reason, when there is no big screen. |
| `screens-off` | The wall's own Hide screen (same command as the Unwind button; says so if they are already off). |
| `focus:start`, `focus:25`, `focus:50`, `focus:stop` | The focus timer at its default length, 25 or 50 minutes, and its reset. Refuses a second start. |
| `lock` | Locks the PC with `LockWorkStation`. Win+L stays a refused chord. |
| `displays:off` | Asks Windows to put every monitor to sleep (a `SC_MONITORPOWER` broadcast, as the old app does; the one second limit is per window that does not answer, so it runs on its own thread and never holds the send guard); they wake on input. Different from Hide screen. |
| `mixer` | The existing volume mixer command. |
| `sonos:pause-all`, `sonos:play-suggested` | The existing Sound commands. A key never bypasses a confirm: a loud routine opens Home and says so. Stale Sound data is refused. |
| `mood:<id>` | The existing mood command, for a mood id the home app lists. |
| `tasks:open`, `task:first` | Opens the first row of "Due today" (of "Next up" when nothing is due) in the task app. |
| `omnigent:front`, `agents:open-waiting` | Brings OmniGent forward, or opens the first waiting session that is not snoozed. Refused when the helper is not answering. |
| `meet:join-next`, `event:open-next` | Joins, or opens in Outlook, the next meeting. Refused when the meeting list is old. |
| `zen`, `dream` | Opens Zen or Dream. |

Listed in the picker as "coming" and not runnable: `task:add` (needs a write to the task app), `tv:off` and `alarms:seen` (wait for the home app change), `omnigent:new-chat`.

### Always here

The pin icon beside the heading. Up to five keys that never change by themselves: the owner's pins on this display (local storage `wall2-keys-pins`, validated on read against the library and `keys.json`: a stored value that is malformed means the defaults, while a well formed reference that no longer resolves is simply dropped, down to an empty row with only the Add tile; a pin on a `keys.json` key is stored with that key's label and action and is dropped when the file no longer has the same key there), else the keys named in `pinned` in `keys.json`, else **Thirds, Focus, Record 16:9, Snip, Hide screen**. After the first Add, Remove or Replace on the wall, this display keeps its own pin list, and later edits to `pinned` in `keys.json` no longer change it (the choice made on the wall wins; Reset to defaults in the picker clears it). A free slot appears as a dashed **Add a key** tile and opens the picker for the next place. The last key can be removed, leaving only Add. After a layout key the heading says "3 windows arranged" (or "2 of 3") with an Undo button for 60 seconds, and the layout key keeps its outline.

Every pinned key and every key on a Now set page has a menu, opened by right-click (or by the ContextMenu key or Shift+F10 on a focused key). No button is drawn on a key at hover or focus; the key keeps its own look. A pinned key's menu offers Replace with another key, Add a key (the same picker the Add tile opens, for the next free place; disabled with "Always here is full" and `5 of 5` when all five places are taken), Remove from Always here, and Edit keys file. A Now key can be pinned only when it matches one durable library id; keys that exist only in `keys.json` say so instead of storing a position that could point at a different key after an edit. Every menu can open `keys.json`. Escape, a click outside, a choice, a change of page or of the set shown (Auto following another app) closes it, and so does five seconds with the pointer resting elsewhere: the countdown does not run while the pointer is over the menu or while keyboard focus is inside it. A second right-click on the same key closes the menu and opens it again at once. Escape or a choice returns focus to the key. Every enabled key's tooltip ends with "Right-click for more."; a disabled key keeps only its reason. The deck ignores these gestures while the Day drawer or Agents panel owns the pointer.

**The picker** opens over the two rows' box (never Due today) and runs down over the mountains to just above the day timeline, leaving the 16 px gap the main rows keep (`pickerBottomY` in `keysModel.ts`, measured again when anything above it in the wing changes size; it never covers the timeline or its chips). Search stays at the top and "Reset to defaults" at the bottom; only the list between them scrolls, with the wall's slim scrollbar and a fade at its foot so no row shows cut mid-text. It holds the whole library by group, a search box (label, group and what a key does), the current five marked ("pinned", "this slot"), a click swaps that key into the slot (a key already pinned trades places), "Reset to defaults" at the bottom. Escape (from anywhere while it is open) or a click outside closes it, and the click that closes it does nothing else; the arrow keys move through the rows; rows are 36 px tall, two to a line. Keys marked **check** are shortcuts the owner must confirm on his PC: they are never in a set Auto shows, and the page offers one only once it is pinned. Rust itself accepts any runnable library id (held to its group's programs), so the "only when pinned" rule lives in the page. "coming" rows and shortcuts still to be worked out (the three Power BI ribbon ones) are listed but cannot be pinned. `keys.json` is never written.

### Now

Heading "Now · <page name>", the pages as dots (up to seven; past that "8 of 12"), previous and next arrows (the wheel over the row steps too) and the Auto switch. The page name always shows whole: when the heading is tight the dots give way to "8 of 12" first, then the For you chip shrinks to a dot and its count. Tiles share the full row width. One or two use a 28 px icon beside a one-line 21 px label, three use a 24 px icon over an 18 px label, and four or five keep the standard structure. Every tile stays 70 px high. The Add tile counts when the Always here row chooses its columns. The For you plates are 70 px too, and the Now row is 108 px on every page. On a set's page a key's label drops the group name the page already says ("VS Code: command palette" is "Command palette" on the VS Code page); the full name stays in the hover and the picker. A set with six to eight keys gets a second row only when it fits above the deck's floor; otherwise it shows five at a time ("1/2" by the page name) and the arrows step through them before the next page. The floor (`deckFloorY` in `keysModel.ts`) is a 12 px clearance above the highest point of the mountain ridge under the right wing, worked out from the Work camera (`horizon/ridge.ts`, the renderer's own profile), and above Watt's band where his walk reaches under the wing; no part of the deck goes below it. With the 70 px tiles the deck has about 4 px of room above that floor. That is not enough for a second Always here row, so the pin limit stays five until another part gives up room. A key that cannot be sent right now (its set's app is not in front, or a layout with no big screen) keeps its size and label, loses its colour, goes flat with a dashed edge, and its hover says why.

Keys are tinted by kind: a soft wash, an edge and the icon in the kind's colour, a light top line and a dark 2 px foot; hover brightens and glows, pressed sinks 2 px, and the layout key just used has its own ringed look. Window layouts are cyan, capture and recording magenta (Record 16:9 included), focus, timers and tasks violet, app shortcuts and calls mint, agents and OmniGent amber, system, sound and house grey (`--dim`).
The kind comes from data (`work/keyKind.ts`): a library key by its group (capture keys by id), a wall action by its action, a built-in set's key by its group; a key of the file's own sets by the library key with the same chord (modifier order and case ignored, once the page is given chords; the summary carries none today), else the library key with the same label (case ignored), else its set's rule (the general set grey, an app's set mint). A test holds every library group and wall action to exactly one kind.
`npm --prefix wall run fit-check` holds every key's top and side edges at 3 to 1 or more against the sky beside them by day and by night, read from a screenshot. A key that cannot be sent carries no kind at all. The pages, in stepping order: **For you** (only while something waits), the set for the app in front, the general set, then every other set.

**Auto** shows the set for the app in front, else the general set. When a NEW "For you" item arrives (never seen, or gone for 10 minutes or more; one that blinks out for a poll is the same item; items already waiting when the row mounts are not new; the swap waits for any press in flight) Auto shows that page for 45 seconds, then goes back to the keys by itself, even if the item still waits. While anything waits and the page is not showing, a small amber chip "For you 3" in the heading jumps to it. Stepping by hand (arrows, dots, wheel, the chip) turns on **Hold**: the row stays on that page until Auto is clicked, and Hold never times out. A held For you page ends when nothing waits any more. A key still goes only to an app its set allows; a held set in the wrong app is refused ("Wrong app in front for ...") and nothing is sent.

**For you** is at most two plates side by side, each the height of a key (so the Now row is one height on every page): an icon, a title cut with an ellipsis over a short reason, and one button; the full title and reason show on hover. One item leaves the second half empty. "+N more" stays in the heading. A plate takes its item's tone (mint for a meeting or a ready pull request, amber for a waiting agent or an alarm). In this order, each from a store the wall already has, each left out when its source is stale, down or not set up:

1. a meeting that starts within 10 minutes or is live: **Join** (the Meet join command);
2. an agent waiting on the owner, not snoozed with "Later": the session title and "asks: <question>" when the helper sends one, else "waiting N min": **Open chat** (`wall2_focus_omnigent` with the id);
3. an agent whose pull request is ready to merge: **Show** (scrolls the agent cards to it and flashes its ring once; Hold to merge stays on the card only);
4. an open network alarm: its text and age: **Open** (what Home's own button opens).

With nothing waiting the page is skipped when stepping and Auto never shows it. When the agents helper is down the page shows what it still knows from other sources and says nothing about agents.

**Built-in sets.** Built from the library's groups and matched by executable name (the file part of the program's path, any case); a set in `keys.json` for any of the same programs wins and the built-in one is left out. They are only as right as these names, which the owner should check on his PC and can override with his own set:

| Set | Matches | Keys |
|---|---|---|
| General (the fallback) | any program | Snip, Clipboard history, Task Manager, Lock the PC, All monitors off, Mute sound, Play or pause, Show desktop |
| Teams | `ms-teams.exe`, `teams.exe` | Join next meeting, Mute, Camera, Share screen, Raise hand, Leave |
| Zoom | `zoom.exe` | Mute, Camera, Share screen, Raise hand, Leave |
| OmniGent | `omnigent.exe` | Open what waits on me, OmniGent to the front |
| VS Code | `code.exe` | Command palette, terminal, quick open, search all files, side bar |
| Browser | `chrome.exe`, `msedge.exe`, `brave.exe` | New tab, Reopen closed tab, Address bar, Private window, Dev tools, Hard refresh, Find on page |
| Mail | `outlook.exe`, `olk.exe` | Open next event |
| Recording | `obs64.exe`, `camtasiastudio.exe`, `camtasia.exe` | Record 16:9 layout, Windows screen recording |
| Power BI | `pbidesktop.exe` | Save |
| Excel | `excel.exe` | Filter, make a table, sum, repeat last action |

A key is offered only where it is right: Excel keys never go to Power BI Desktop, VS Code keys never go to OmniGent, and Firefox has no built-in set (its private-window shortcut, Ctrl+Shift+P, is a "check" key in the picker, held to `firefox.exe`).

The other groups (Sound and music, Windows and layouts, Tasks and focus, House, PowerToys, and the rest of Anywhere on the PC) are reached through the picker.

### The library

`wall2_keylib.rs` holds 104 keys in 16 groups, each with a stable id, a label, an icon from the fixed set, a group and one action. `wall2_keys_library` gives the page ids, labels, icons, groups, `how` text and the action name, never a chord. A pinned library key goes only to the programs of its group (anywhere for the general groups), so a Teams key never types into another app. `wall/src/bridge/devMocks/libraryData.ts` is the same catalogue for dev mocks and tests, and a test holds it equal, field by field (ids, labels, icons, kinds, `how`, action, runnable and each group's programs), to what the Rust table returns.

### Big screen layouts

`src-tauri/src/wall2_arrange.rs`. The big screen is the monitor that is not the wall's own and has the widest aspect ratio, taskbar excluded (its work area). With the wall as the only monitor the layout keys are off with a tooltip.

- **Thirds**: the three newest ordinary windows on that monitor in equal columns, left to right as they already stand. Two make halves; one goes to the centred third.
- **Focus**: the newest window in a centred column two thirds wide; the others stay.
- **Record 16:9**: the newest window at the largest 16:9 size that fits, centred.
- **My zones**: rules place the most recently used eligible window of each named program first. The remaining recent windows take the free zones from largest to smallest. The windows you used last move; the rest stay where they are.

My zones first reads the custom canvas or grid layout applied to the big monitor from PowerToys FancyZones. It uses that source only when the monitor model, instance and Windows display number all match one applied entry; when the current virtual desktop is known, that must match too. Unknown identity, a mismatch or more than one candidate silently falls through. Built-in FancyZones templates, missing files, unreadable files, invalid grids and any unrecognised or invalid shape also fall through. It then uses `zones` from `keys.json`, or the built-in measured layout: left 31 percent, centre 49 percent, and the right 20 percent split into top and bottom halves. Every scaled rectangle must remain nonempty inside the work area. FancyZones files are capped at 256 KB, custom layouts at 16 zones, grid dimensions at 256 cells, and are only read when the key runs. They are never written or watched.

Ordinary means visible, not minimised, not cloaked, with a title, top level, not owned, not a tool window, not the taskbar or desktop shell, not the wall's own, and not a fixed-size dialog or an elevated program the wall may not move (those are skipped silently). A maximised window is restored first and given up to 200 ms to leave the maximised state; the handle is looked at again after the wait (still the same process, not minimised) and one that is still maximised at the limit is skipped and asked to maximise again so it is left as it was found. Every window is looked at again immediately before it is saved or moved; one that closed, whose handle another program reused, or whose position cannot be saved is not moved. Nothing is closed, minimised or hidden. Each layout remembers the earlier position of what it moved; Undo shows for 60 seconds (restarting on each layout click) and looks at each saved window as strictly as a layout does (same process, visible, not minimised, not the wall's own): a window the owner has minimised since is left alone. The restore runs on a helper thread with a 400 ms bound so a window that hangs cannot hold the layout guard, which is released on every path. The move is posted without waiting; then, within 250 ms in all, each window's frame is checked once and the answer says "3 windows arranged" or "2 of 3 windows arranged". A double click, or a held key, never acts twice (clicks with `detail > 1` and key repeats are ignored, and a control stays quiet for 500 ms after its action). Commands: `wall2_arrange_status`, `wall2_arrange(layout)` and `wall2_arrange_undo()`, all gated to the `wall2` window. Answers are `{moved, asked}` or a fixed word: `no big screen`, `no windows`, `none moved`, `nothing to undo`, `busy`, `unknown layout`.

### keys.json

`keys.json` beside `feeds.json` (same folder; read, validated and bounded in Rust, never written by the app) supplies custom sets and the default pins. With no file there are no custom sets and the built-in sets and default pins apply (the Now heading's tooltip says where the file goes). Only a missing file falls back; a file that exists but cannot be read shows "keys file could not be read" and offers no keys; an invalid one is refused with a message naming the app and key number. Neither is ever silently replaced. A key has a `label`, an `icon` and either a `chord` or an `action` (never both). `pinned` is an optional list of at most five keys of the same shape. Optional `zones` holds one to eight fractional work-area rectangles. Optional `zoneApps` holds up to eight executable and reading-order zone rules, with zone numbers starting at one and structurally capped at 16. My zones chooses its source first, then checks every rule against that source's actual zone count. A broken or empty scaled rectangle names `zone N`; a rule outside the selected source names `zoneApps rule N`. The ids `pinned`, `foryou` and anything starting `lib-` are reserved.

**Chords** come from a fixed vocabulary, never free text or key codes: modifiers `Ctrl`, `Alt`, `Shift`, `Win` and at most one key per step from letters `A` to `Z`, digits `0` to `9`, `F1` to `F24`, `Enter`, `Tab`, `Esc`, `Space`, `Backspace`, `Delete`, `Insert`, `Home`, `End`, `PageUp`, `PageDown`, `Up`, `Down`, `Left`, `Right`, `.`, `` ` ``, `=`, and the single keys `VolumeUp`, `VolumeDown`, `VolumeMute`, `PlayPause`, `NextTrack`, `PrevTrack`. Steps are separated by commas (`Alt+H, R`), at most six, with a fixed 150 ms gap. Win+L and Ctrl+Alt+Delete are refused when the file is read (Windows does not accept them from a program); Alt+F4 stays allowed. Limits: file 32 KB, 12 sets, 8 keys per set, labels and names 16 plain characters, one general set, executable names unique.

**Volume and media keys** (`VolumeUp`, `VolumeDown`, `VolumeMute`, `PlayPause`, `NextTrack`, `PrevTrack`, alone) are system-wide: they are sent with no program in front, nothing is raised, and an elevated program in front does not stop them. Any other chord still needs its target. **Lock and All monitors off are mouse keys**: Space and Enter never run them, and the tile is blurred afterwards so the key that wakes the screens cannot run them again.

**Sending**, failing closed at each step with a fixed word the row turns into one short line: the page sends only a set id and a key index, or a library id (`busy`, `no key`); the set must accept the remembered window's program (`no app`); the window must still exist, be visible, belong to the same process whose image file name still matches (`gone`); the program must not be elevated (`elevated`), whatever the wall's own level; **do not start the wall as administrator**; it is brought to the front and checked to be in front (`not forward`); the chord is sent with `SendInput`, one step at a time, re-checking the front window before each step and releasing every held key on failure (`failed`). One send at a time, shared with the two system calls. Nothing is logged and no window title leaves Rust. The only process name that does is the file name of a program with no set, so the owner can write one.

Example `keys.json`:

```json
{
  "zones": [
    { "x": 0, "y": 0, "w": 0.31, "h": 1 },
    { "x": 0.31, "y": 0, "w": 0.49, "h": 1 },
    { "x": 0.80, "y": 0, "w": 0.20, "h": 0.5 },
    { "x": 0.80, "y": 0.5, "w": 0.20, "h": 0.5 }
  ],
  "zoneApps": [
    { "exe": "outlook.exe", "zone": 3 }
  ],
  "apps": [
    {
      "id": "general",
      "name": "General",
      "match": "*",
      "keys": [
        { "label": "Snip", "icon": "screenshot", "chord": "Win+Shift+S" },
        { "label": "Clipboard", "icon": "clipboard", "chord": "Win+V" },
        { "label": "Thirds", "icon": "window", "action": "layout:thirds" }
      ]
    },
    {
      "id": "powerbi",
      "name": "Power BI",
      "exe": "PBIDesktop.exe",
      "keys": [
        { "label": "Format", "icon": "brush", "chord": "Alt+H, F, P" },
        { "label": "Refresh", "icon": "refresh", "chord": "Alt+H, R" }
      ]
    }
  ],
  "pinned": [
    { "label": "Thirds", "icon": "window", "action": "layout:thirds" },
    { "label": "Focus 25", "icon": "timer", "action": "focus:25" },
    { "label": "Snip", "icon": "screenshot", "chord": "Win+Shift+S" }
  ]
}
```

The Power BI chords above are placeholders, not checked against the program. Icons are checked against a fixed list in Rust (`ICON_NAMES`; an unknown name is an error naming the set and the key's position, and a test keeps the page's drawn icons equal to the Rust list).

Dev mocks for stills (`?keys=typical|general|nogeneral|idle|many|one|wrong|refuse|problem|library|off`, `?pins=long`, `?hold=<set id or foryou>`, `?source=default`, `?arrange=ok|none|nowin|off`; what waits for For you comes from `?agents=ask`, `?meet=none` and `?net=calm`) are in `wall/src/bridge/devMocks/deck.ts`. `npm --prefix wall run fit-check` checks the deck in sparse, typical and heavy states, For you held, the picker open, and the built-in library sets (twelve pages, the longest labels, a set whose app is not in front), and fails when any part of the deck goes below its floor (the open picker aside), a key label runs outside its tile, two tiles share pixels, the Now heading is cut, or the open picker comes within 16 px of the timeline (checked with the whole library open).

## On Air

The rail's On air button opens a first version of a place for running a live show by hand. It needs no stream service: a show timer, the run of show from a text file, the current part's notes with Previous part and Next part, Mark a moment, and the key deck's recording keys. The code is in `src/onair/` and `src/styles/onair.css`; the files are read and written by `src-tauri/src/wall2_onair.rs`. The day strip stays (the Work kind) and the horizon uses Work's camera (`onair` in `CAMERAS`, the same wide framing). The clock is hidden on On Air, as planned: the show timer sits in its place and the time of day stays on the strip. Watt lives here too: his walk and ground on On Air are Work's (all three columns end at the bottom of the top band, so the band under them is his), and the recording rule for him is unchanged.

- **Show timer** (left, 104 px). Start, Stop (it pauses and keeps the time; Start carries on) and Reset, which works only while stopped and asks "Reset? Click again" for three seconds so a slip never loses the time; Reset also goes back to the first part. The time reads `mm:ss` up to 59:59, then `h:mm:ss`, at most 24 hours: at 24 hours the timer stops itself and the line under it says "Stopped at 24 hours. Reset to start again."; a stored running timer older than that comes back in the same stopped state, and a stored start in the future (past two seconds of clock jitter) is not trusted. Under it: "Started 9:42 AM by hand. No stream service connected." The timer and the current part are kept in local storage (`wall2-onair`: running, `startedAt`, `accumulatedMs`, the first start, the stop time, the part and when it began), checked field by field when read (anything odd gives an idle timer), so a running timer keeps counting across a reload, a place change or a restart of the wall, from the stored start.
- **Run of show** (left). One row a part: done parts ticked, the current one lit with its minutes left, then a quiet amber "N min over" once it runs past its planned minutes. A click on a row makes it current. Forty parts scroll inside the list, which keeps the current row in view. The foot says where the parts come from (and how many lines were skipped, with the reasons on hover), with Reload and Open file. The file is read when the place opens and on Reload, never more often than every 5 seconds (Reload says "Just read" inside that time); a read that fails keeps the last good parts and says so in amber. Each read holds the current part to the parts there are and keeps that (the time in the part starts again when the read moves it), so a file that shrinks and grows again does not bring the old part back. A failed Open file says so in this foot, never under Mark a moment.
- **Notes for this part** (centre card, 1080 by 486). The current part's notes as large as they fit (36, 30, 26 or 22 px); notes that do not fit even at 22 px end in "+N more" with the rest on hover. Previous part and Next part (52 px), and "Next: Audience questions, 15 min". With no file, a refused file or no parts, the card shows how the file works in three lines.
- **Mark a moment** (right, 96 px). One click appends a line to `marks.txt` with the show time and the current part. A double click, or a second click within a second, counts once (in the page and again in Rust). The tile shows today's count and the last three show times ("2 marked: 03:12, 09:40. Saved to marks.txt"); a refusal says why in one amber line ("marks.txt is full; move it aside", "No config folder on this PC"). The file button beside it opens `marks.txt`. Today's count is read again after local midnight (one timer to the next midnight, nothing while the page is hidden, and a read on coming back if the date moved on). The two files keep separate notes: a marks refusal clears when the marks are next read.
- **Recording keys** (right). Four of the key deck's own tiles (its classes and its colours by kind), from the built-in library by id: Record 16:9 (`record-169`, the `layout:record169` wall action), Stop (`rec-stop`), Snip (`snip`) and Hide screen (`strip-dark`, the wall's Hide screen). Each press goes through the deck's own press path (`useKeyPress` and `wall2_keys_send_library`, then `runWallAction` when Rust answers with a wall action); the result shows for a few seconds in place of the heading. Stop agrees with recording mode: lit with the red edge while a recorder runs, plain with a dashed edge (and saying so on hover) when none does. Label, icon, group, action and where a key goes are read from the key library by id (the recorder's keys also from `signals/recordingKeys.ts`), never copied; an id the library lacks shows a disabled tile with a one-line reason. While the page is hidden or the display is off, nothing on this place ticks.
- **Studio lights** (right, between the recording keys and the footnote, x 1920 to 2540 from y 314, 134 px). The two key lights on the desk: a Key lights switch tile, Fine tune, one line saying what they report, and one quiet line, "Presets and room lights come with a later home app change." See "Studio lights" below.
- **Kept free.** The right column ends with the footnote "First version: a timer, a text file and keys. No chat, viewer count or prompter link yet." It sits under the Studio lights block; nothing else goes there. The space under the footnote, down to the strip, stays free.

### The two files

Both live in the app config folder, beside `feeds.json`. The page never sends a path and never sees the file's own text.

`run-of-show.txt`, UTF-8, at most 32 KB (larger: refused, "run-of-show.txt is over 32 KB"; not UTF-8: refused, "run-of-show.txt is not UTF-8 text"). One item a line:

```text
# Friday stream
// Comments start with two slashes and are ignored.
## Welcome | 5
- Say hello and what today is about
## Product demo | 20
- Point it at the real model first
Any other line under a part is a note too
## Questions
```

- `# <title>`: optional, only on the first line that is not blank or a comment; at most 60 characters (longer is cut with an ellipsis).
- `## <part name> | <minutes>`: a part. The name is 1 to 60 characters (longer is cut with an ellipsis); minutes are optional, 1 to 240 (out of range: no minutes). Text after the last bar that is not a number belongs to the name. At most 40 parts; later parts and their notes are skipped.
- `- <note>`, or any other line under a part: a note, at most 160 characters (longer is cut with an ellipsis), at most 12 a part.
- Lines before the first part (other than the title and comments), empty notes and lines past a limit are skipped and counted. Control characters, line and paragraph separators and direction marks are dropped everywhere, and a tab becomes a space.

Open file (`wall2_onair_open` with `show`) writes a starter file with three example parts only when there is no file, never over one, then opens it in the default editor.

`marks.txt` is append only, one line a mark, tab separated: the local time (RFC 3339 with its offset), the show time `hh:mm:ss`, and the part name (control characters, separators and direction marks removed, a tab turned into a space; `-` for none). For example `2026-11-13T10:24:31-08:00	00:42:13	Product demo`. One file for every day; the date is on each line. Past 1 MB a mark is refused ("marks.txt is full; move it aside"): move the file aside and the next mark starts a new one. Today's count reads at most the last 64 KB.

Commands (only the `wall2` window may call them; the file work runs off the main thread; nothing is logged; errors are `not-configured`, `failed` or `refused`):

- `wall2_onair_show()`: `{ state: "ok" | "missing" | "refused", title, parts: [{ name, minutes, notes }], skipped, reason, readAt }`.
- `wall2_onair_mark(showMs, part)`: `showMs` at most 24 hours and `part` at most 60 characters, else `refused`; answers `{ today, last }` (the last three show times marked today). A second call within a second writes nothing and answers the same count.
- `wall2_onair_marks_today()`: the same answer, without writing.
- `wall2_onair_open(which)`: `show` or `marks` only (anything else is `refused`).

Review knobs (development only): `?screen=onair` opens On Air; `?show=typical|one|long|forty|empty|missing|refused|down`; `?marks=0|2|full`; `?oatimer=run|stopped|idle|limit` (running at 42:13, stopped at 42:13, never started, stopped itself at 24 hours); `?openfail=show|marks` makes Open file fail. The gallery's `onair` screen has the typical, stopped, no file, refused file, forty parts, long notes, marks full, one part, read fails, recording, Watt standing, 24 hour stop, failed Open file and Reset states (they open with `?hz=onair`, so the horizon is on On Air's own camera from the first frame and Watt, who waits for his place's camera, stands in the still). `fit-check` holds each column inside its planned box (x 124 to 764, 800 to 1880 and 1920 to 2540, above the strip), fails on a note cut without "+N more", on a recording key smaller than 40 by 40 px and on Watt's box (or his click box) overlapping a column; its self-test breaks are `onair-box` (the notes card 1400 px wide), `onair-notes` (every note shown at 40 px) `onair-keys` (20 px tiles) and `onair-watt` (Watt lifted onto the notes card).

### Studio lights

The key light half of the planned studio lights control. The block on On Air, its Fine tune drawer (x 1680, top 20, 860 px wide) and the Lights chip on Work are in `src/studio/`; the setup is in `src/tools/KeyLights.tsx`; the native side is `src-tauri/src/wall2_keylights.rs` (the rules and their tests) and `wall2_keylights_cmd.rs` (the commands); styles are in `src/styles/studio.css`.

**Not built yet.** Presets (On air, Video call, Back to normal), the Panels, Behind monitor and Overhead switches, the offers when the show timer starts or stops, the Lights chip on Meet and the office moods wait for a home app change: the home app has no studio or office routes yet, and nothing here is written against a route that does not exist. The page says so in one quiet line, not with a control that does nothing.

**The block.** Header ("Studio lights", "Office only"), the Key lights switch (on when either light is on; a click turns every light that answers on or off; its knob takes the colour of the light's warmth), Fine tune, and one line: "Key lights 60%, 4400 K", "Left 60%, 4400 K. Right 45%, 4700 K" when they differ, "Key lights are off". States: not set up ("Key lights: type their addresses in Tools" and an Open Tools button that opens Tools at Key lights, no Fine tune); one light does not answer (dashed amber tile, "The right key light is not answering. The other one works.", the other light still switches); neither answers (dashed amber "Key lights are not answering", Check again, nothing spins); a different answer shape says "Key lights answer differently than expected". A slider's number and its ARIA value are always what the light last reported; the thumb says where it was asked to go: it follows the pointer only while the button is down (or a key is held) and stays at the requested place only while a write is out, then goes to the reported value (at once on letting go when nothing is out). A write a light did not take, whether it answered with a word or accepted it and still reports the old value (more than 2 percent or 100 K from the request), springs back and says "The left key light did not take that change" in amber for 5 seconds; a read back within the light's own rounding counts as taken. Answers always apply newest first: a slow read that began before a write never lands after the write's read back, and when a write for both lights and one for one light overlap the older answer never lands after the newer one. A side with no saved address is "not set up" (Open Tools), never "not answering"; one light on its own gets one pair of sliders and no Linked chip.

**Fine tune.** One brightness slider (3 to 100 percent) and one warmth slider (2900 K warm to 7000 K cool, steps of 50 K) moving both lights; the Linked chip splits them into Left and Right. Moving a slider on a light that is off turns it on, as the light's own app does. Linked with two lights that report different values: the sliders show the left light, a "Not matched" note says so, and the first move sets both lights to the shown values and the move. One light that does not answer splits the pair by itself: its side says "not answering" with Try again and a grey thumb, and the other works. The range line ("Range 2900 K to 7000 K, the maker's figure") is the maker's stated range; the light does not report its own. Escape, a click outside or 2 minutes with the pointer away close it, as Tools does. Keyboard: arrows, Page Up and Down, Home and End.

**The Lights chip** (Work, 32 px, after the Recording chip, only while a recording runs): "Lights: key lights 60%" (both on and matched), "Lights: key lights on" (on, not matched, or only one answers), "Lights: key lights off", "Lights: key lights not answering"; hidden when the key lights are not set up. A click opens the same drawer over Work. The drawer takes focus when it opens, keeps Tab inside and gives focus back to what opened it; it closes when the place changes. The Agents header gives way for the chip as it does for the others (`HeaderFit`), and the chip gives way first: when the header is tight the chip's words shorten to "Lights 60%", "Lights on", "Lights off" before any other part of the header compacts.

**Reading.** On opening On Air (or while the chip or the drawer is up) and every 30 seconds while visible; after every write the native side reads the light back and the page shows that. Nothing is read while the page is hidden or the display is off.

**Setup (Tools, Key lights, under Sources).** Two rows, Left and Right: Not set up with a Set up button, or Saved with Test, Change and Forget side by side, and the row's second line says the state in full ("Left key light answered at 9:42 AM", "Left key light: no answer"). The address is typed once in a field (placeholder `192.168.x.x`, Enter saves, Escape closes the field) and kept by Rust in `keylights.json` in the app config folder (written to a temporary file and renamed; the page never reads it back and nothing ever shows it again). Test reads the light once. Forget removes the address. The page and the native commands name a light only by the word `left`, `right` (or `both` for a write).

**The address rule.** A literal IPv4 address in 10.0.0.0/8, 172.16.0.0/12 or 192.168.0.0/16, written plainly: four decimal parts, no leading zero in a part, and no host name, port, path, scheme, user, password, space or IPv6. Link-local (169.254.x.x), loopback and public addresses are refused (`bad-address`). A hand-edited `keylights.json` goes through the same rule when read.

**The key light interface** (as the maker's own app and community write-ups describe it; proved here against a fake transport only, never against a real light). Plain HTTP on port 9123, no sign-in; requests go only to the two saved addresses; connect timeout 1.5 s, whole request 3 s, redirects off (a 3xx is `failed`), answers capped at 16 KB (`too-big`).

```text
GET  /elgato/lights        -> {"numberOfLights":1,"lights":[{"on":1,"brightness":60,"temperature":227}]}
PUT  /elgato/lights        <- {"numberOfLights":1,"lights":[{"on":1,"brightness":60,"temperature":227}]}   (Content-Type: application/json; only the fields that change)
GET  /elgato/accessory-info   (Test only: the product name, kept as letters and digits in the log)
```

Brightness is a whole percent, 3 to 100 (written values are clamped). `temperature` is a mired-like number, 143 to 344 (clamped); kelvin = round(1 000 000 / temperature), shown to the nearest 50 K (143 is 7000 K, 344 is 2900 K). The web view speaks kelvin only. An answer that is not this shape is `other-model`.

**Writes.** Per light at most one write in flight, at least 100 ms apart, the last value always sent, then one read back 250 ms after the last write (a burst of 20 values sends a few writes and one read back). The page also keeps only the latest value for a light while one write is out.

**Fixed words** (every command's only error text): `not-set-up`, `bad-address`, `no-answer`, `timeout`, `failed`, `too-big`, `other-model` (an answer that is not exactly one light), `refused` (a window that is not `wall2`, or a side that is not `left`, `right` or `both`), `slow-down` (too many address saves, tests or reads) and `busy` (too many writes already waiting on one light). `slow-down` and `busy` are quiet: Tools says so in a plain line and the block shows nothing (the next read corrects it). An address is never in an answer, an error word, a log line or a panic message.

**Native limits.** At most 4 address saves a minute (any answer counts), then `slow-down`. One test or read per side per 500 ms: a call inside that time gets the last answer (or `slow-down` when there is none) and never waits; a write forgets the kept answer. Writes: one worker per light with the latest wanted value; at most 4 callers wait on its answer, a caller past that gets `busy` at once with its value still handed over, so a flood holds at most 5 workers a light.

**keylights.json.** A value that fails the address rule leaves only that side not set up, and a save of either side keeps the good one. A file that is not a JSON object reads as both sides not set up, and Tools says once "The saved addresses could not be read. Type them again." until an address is saved.

**Commands** (only the `wall2` window; the network work runs off the main thread): `wall2_keylights_status()` is `{ left: { set }, right: { set }, unreadable }`; `wall2_keylights_set_address(side, address)` and `wall2_keylights_forget(side)` answer nothing but success or a word; `wall2_keylights_test(side)` is the light or a word; `wall2_keylights_read()` is `{ left, right }`, each a light `{ on, brightness, kelvin }` or a word; `wall2_keylights_set(side, on?, brightness?, kelvin?)` is `{ left, right }` read back after the write, null for a side not written.

**The log**, `wall2-keylights.log` in the app log folder (64 KB, one older file): one line for each Test, each failed read and each write, with the UTC time, the side, `read`, `write` or `test`, the HTTP status or the fixed word, milliseconds, and for a write the numbers sent and the numbers read back. Never an address, never a body other than those numbers:

```text
2026-11-14T17:40:02Z left test 200 48 product=ElgatoKeyLight
2026-11-14T17:41:00Z right read no-answer 1503
2026-11-14T17:42:11Z left write 200 112 sent on=1 bri=60 temp=227 back on=1 bri=60 temp=227
2026-11-14T17:42:30Z right write timeout 3001 sent bri=40
```

**The seam.** `src/studio/keyLights.ts` holds one interface, `KeyLightBackend { read(), set(target, patch) }`, and one back end, `direct` (the commands above). A second back end (the home app passing the sliders through when a light does not answer the simple local call) can be added later without touching the page; none exists, and no home route is called.

**What the home app must offer** for the rest: presets, room light groups and office moods need studio and office routes that read and set them. Until they exist the home half is not built.

Review knob (development only): `?keys2=none|both|off|left-silent|right-silent|neither|other-model|mismatch|writefail|stuck|right-unset|right-unset-silent|unreadable` for the key light commands (`none`, the default, is the day-one state). The gallery's `studio-lights` area has the states (not set up, matched, off, differing, one silent, neither answers, a different model, the drawer linked, split, not matched, one silent and off, a write the light did not take, the Work chip in four states, the Tools section empty, saved, tested, typing and refused). `fit-check` holds the block inside x 1920 to 2540 from y 314 with the footnote below it still above the strip, controls 40 to 48 px, text 16 px or more, the drawer inside the wall above the strip, the Tools section inside the Tools drawer with no cut text, and the Lights chip one 32 px line that leaves the Agents header uncut and the waiting line at least 160 px; its self-test breaks are `studio-block`, `studio-controls`, `studio-text`, `studio-drawer`, `studio-tools` and `studio-chip`.

## Content security policy

Set in `src-tauri/tauri.wall2.conf.json` under `app.security.csp` (Ridgeline only;
the old app's config is untouched). It allows own files (`'self'`), data: images,
own fonts, connections to the Tauri IPC (`ipc:`, `http://ipc.localhost`,
`https://ipc.localhost`), pictures only from the card's own picture hosts (`img-src` lists
`https://i.scdn.co`, `https://mosaic.scdn.co`, `https://image-cdn-ak.spotifycdn.com` and, for the
YouTube library's thumbnails, `https://i.ytimg.com`), no weather service (the weather is read natively), and frames from the two
video players only (`frame-src https://www.youtube-nocookie.com https://player.twitch.tv`,
in `csp` and `devCsp`, for Unwind's Watch tab). Everything else is
denied (`default-src 'none'`); no `unsafe-eval`, no `unsafe-inline`. React sets
inline styles through the CSSOM (`element.style`), which CSP allows. To reach a
new host, add it to `connect-src` (data from `fetch`), `img-src` (pictures) or
`font-src`, and rerun the schema check: validate the file against
`node_modules/@tauri-apps/cli/config.schema.json`. `devCsp` is the same policy for `tauri dev`, plus the Vite origin and websocket
(`http://localhost:1421`, `ws://localhost:1421`) and inline scripts and styles,
which Vite's hot reload injects. Keep the two in step when you add a host.

Both policies also carry `frame-ancestors 'none'`: the wall is never framed. Script inside a
player frame (an ad, a Twitch extension) could otherwise load the wall's own page in a frame
of its own, where it has the wall's origin and every command, and lay it unseen under the
owner's clicks on the video. As a second guard, for a runtime that does not enforce
`frame-ancestors` on the app's own protocol, `src/main.tsx` checks `window.top === window.self`
(`ui/topWindow.ts`) and only then imports `src/boot.tsx`, which holds everything that installs
a listener or calls a command. The Rust test `wall2_watch::tests::wall2_policies_refuse_framing`
holds both policies to `frame-ancestors 'none'` and to exactly the two `frame-src` hosts.

## Tools

The rail's Tools button (pressed while open) opens a drawer over the right third of any place: 806 px wide at x 1734, top 20. Escape, its close button or a click outside close it, and it closes by itself after 2 minutes with no pointer over it. Escape is taken by the drawer (the key press is marked handled, and `fullscreen.ts` ignores an Escape another layer already took), so in fullscreen it closes the drawer and stays fullscreen. While a browser sign-in waits the idle close holds; closing the drawer on purpose during a wait cancels that sign-in (calendar or Spotify) and the next open says "Sign-in cancelled" for a few seconds. The code is in `src/tools/` and `src/styles/tools.css`.

- **Accounts.** Each calendar account from `useMeet(true)` (the same hook Meet uses, reading on any place while the drawer is open) with its state line and Sign in, Sign out or Try again; Spotify from `src/music/spotify.ts` (Not set up, with a hover naming `spotify.json` in the app's config folder, and no button, when it has no `spotify.json`). YouTube (see "YouTube" above) is the row under Spotify, with its Set up form (the form takes the left column while it is open, so Video look and Keys file are hidden until it closes) and a line with its two required links. While a sign-in waits, the row says "Waiting for the browser" and has Cancel. There is no Twitch row: Twitch has no sign-in yet, and a button that does nothing is never drawn. A sign-in or sign-out refreshes Meet and Work's calendar read at once.
- **Sources.** One row each for Calendar, Tasks, Agents, Home, Sound, Music, Weather and Box: a dot (mint fresh, amber stale or failing, red down or not set up, grey nothing read yet), the last good read as a clock time or "never", the store's own reason on hover, and Retry, which runs that store's existing refresh and stays busy until that read settles (15 seconds at most); a second click while it runs starts nothing. Music's Retry says "Nothing is playing to read" when its poll is not running. The rules are in `src/tools/sources.ts` and use each store's own stale rule: the agents helper's `agentsStale`, Home's alarm age, Sound's two minutes, the weather card's "updated N min ago" age, Music's 2 second poll. Tasks, Sound and Box keep their state inside their hooks, so each hook reports every read to `src/tools/reports.ts` and registers its own refresh while mounted; when no screen has it mounted, Retry (and opening the drawer) reads the same command once. Home here is the home app's security read, which is also what the rail's alarm dot uses.
- **Video look.** The chips are the Watch looks (`LOOKS` in `src/unwind/watch/looks.ts`) and use the Watch store's `setLooks`: picking one sets one look for everything. When Watch is set to a look per kind no chip is lit and the hint says so. There is no Off, because the Watch store has none.
- **Keys file.** "keys.json, N keys, read 8:02 AM" counts the keys the file names (its own sets and its pinned keys, not the built-in sets). A refused file shows in amber with the whole reason on hover; no file says "No keys.json. Defaults in use". Reload forgets the shared read and asks `wall2_keys_summary` again. Open calls `wall2_open_keys_file`, which takes no argument: Rust opens `keys.json` in the app config folder with the default editor, or the folder when there is no file yet, and only answers `not-configured` or `failed`. Only the `wall2` window may call it.
- **Key lights.** Under Sources: Left and Right, each Not set up (Set up) or Saved (Test, Change), the address typed once and never shown again. See "Studio lights" under On Air. Open Tools on the On Air block opens the drawer with this section ringed for 2 seconds.
- **Build stamp.** The footer reads `wall2_build_info` as the clock's tooltip does.

What Tools reads that the screens did not: opening it starts the account reads (the same reads Meet makes), reads Tasks, Sound and Box once when no screen has them mounted, and polls the keys file every 2 seconds while it is open (Work's deck already does that).

Review knobs: `?tools=1` opens the drawer on load (`?tools=accounts` rings Accounts), `?youtube=off|out|waiting|in|again|broken|brokenout|down|refuse|rejectsave` picks the YouTube row's state (development mock only) and `?keys=refused` makes `wall2_keys_summary` refuse the file with a long reason. `fit-check` holds the drawer inside x 1700 to 2560 and y 0 to 720, clear of the rail, with no cut text that has no tooltip, holds the YouTube row, its form, its hint and its links line inside the Accounts column with text 16 px or more, controls 32 px or more and a row built like Spotify's, and holds Meet's upper right filled in every Meet state (the Later card carries a plain line when there is no list).

## Fullscreen keys

F11 and Ctrl+F11 toggle true fullscreen; Esc leaves it (only while fullscreen; an Esc pressed during a toggle is queued and applied when it finishes).
A rail button just above Tools does the same (icons `maximize` and `minimize`,
label "Enter fullscreen" or "Exit fullscreen", follows the real state, hidden
outside Tauri). Key repeats are ignored and nothing happens in a plain browser. The handler is
`wall/src/ui/fullscreen.ts`, installed from `main.tsx`. Leaving fullscreen
restores the outer position and size saved just before entering fullscreen.
One change runs at a time (a second request while one is in flight is ignored).
`src-tauri/capabilities/wall2.json` adds `core:window:allow-set-fullscreen`,
`allow-set-position` and `allow-set-size` (Ridgeline only). Reading the state
(`isFullscreen`, `outerPosition`, `outerSize`) is already in `core:default`.

## Pointer and touch

The owner drives the strip with a mouse. The app root still sets `touch-action:
manipulation`, controls do not select text or flash a tap highlight, and rail buttons
show a pressed state on `:active`. Hover is a nicety (a cyan title on a task row, a
tooltip on the ribbon's row icons); nothing depends on it. The rail buttons stay 72 by
72. Inside cards the older touch sizes (72 px, and 52 by 44) no longer apply: controls
are sized for a mouse, about 32 to 40 px tall (Meet's buttons are 40 and its Join rows 36; the centre fill's buttons, chips and
stepper are 40, the Room card's mood chips 40, "Try again" 36). The Home chore ticks keep
their 52 by 44 rows with no shared hit area between rows.

## CI

`.github/workflows/build-windows.yml` has a `wall-web` job (Ubuntu: install,
type check, test, build) and, in the Windows job, a second build uploaded as
the `widget-wall-2-windows` artifact.

## Hidden call and leave signals

`wall/src/signals/` derives call, recording and leave state without rendering it. The
native side reads the current user's Windows microphone and camera consent records every
two seconds, emits only fixed program categories, and fails closed when the registry
cannot be read. It writes fixed words to `wall2-signals.log` in the app log directory.
Native records have 1,800 reserved lines. Page-derived records start with `page`, use a
separate queue, are rate limited, and can use at most 200 lines, so they cannot hide native
device edges. Calendar blocks longer than 24 hours are refused before time-zone conversion.

Development query knobs are `?call=teams|zoom|browser|none`, `?camera=1`, `?rec=1` and
`?leave=<minutes until leaving>`. The call knobs fill the hidden store only (no screen uses a
call yet). `rec` and `leave` now show the recording chip, the Recording keys and the leave
banner, as below.

### Leave-soon banner and recording mode

**Leave banner** (`signals/LeaveBanner.tsx`, mounted once in `App.tsx`). A calendar block whose
title says "(10:45 start)" (the real start; `parseRealStart` reads only that wording) is a travel
block: the block's own start is the time to leave. From 30 minutes before it the banner reads
"Leave in 12 min. Doctor's appointment starts 10:45" in cyan with a quiet "turns amber at 5
minutes". At 5 minutes and under it turns amber and shows Dismiss. From the leave time it reads
"Leave now." until 10 minutes later or the real start, whichever comes first, then goes. The
text is a button that opens the event in Outlook (`wall2_open_event`); the hover card gives the
block's time and the real start; a long title is cut with an ellipsis and shown whole on hover.
Dismiss hides it for that event only, until its real start (kept in local storage, inside try and
catch, and cleared once the event is over). It is never shown while the meeting list is stale or
failed, or the signals are unknown, and not on Zen. On Work it sits over the Agents header (x 624,
y 12, 1290 by 50) and hides the header while it shows; nothing moves. On Home, Unwind and Meet
the top band holds controls, so it sits in the empty band above the ribbon (y 528) and covers
none. The signal store drops an event at its leave time, so the banner keeps the last one for its
"Leave now" window while the event is still in the meeting list.

**Recording mode** (a recorder, Camtasia or OBS, holds the microphone or camera). A small red
"Recording mm:ss" chip (time counts from when the wall first saw the recorder on; the hover card
says so) shows in the Agents header on Work (it shrinks to a dot and the time when the header is
tight), inside the leave banner when that shows, and in the band off Work (at the right of the
centre on Work when the helper is down and there is no header). Not on Zen. In the Now row, Auto
shows a "Recording" page: Stop recording (red edge), Pause, Mark moment and Snip, the deck's own
key tiles in the capture colour at the same height. Stepping by hand still works, Hold wins, and
Auto returns by itself when the recording ends. `isQuietForRecording()` in `signals/store.ts` is
the selector for Watt to keep quiet (not wired in here).

**Rust, guarded.** The three recording keys (`rec-stop` F10, `rec-toggle` F9, `rec-marker` Ctrl+M)
belong to the Recording group, whose keys go only to Camtasia or OBS in front; Camtasia's recorder
hotkeys are global, so these three, and only these, may be sent whatever is in front. All of
these must hold (`recording_pass` in `wall2_keys.rs`, with a test for each): the library id is one
of the three, its chord is exactly the fixed one, and the native recording signal
(`wall2_signals::recording_now`, read in Rust inside `wall2_keys_send_library`, after the window
check, never taken from the page) is on. The pass is a value only that function can build; a key
of a set never gets one; Win+L and Ctrl+Alt+Delete stay refused. The page sends only a library id.

## Zen and Dream

`wall/src/zen/`. The Zen button in the rail opens a calm full-stage view over everything
else (the rail and clock are hidden under it). It is front end only: it does not change
the system volume, Do Not Disturb or the focus timer.

- **Flames** (`Flames.tsx`). Two stacked full-stage layers of slowly drifting fractal
  flames: the lower layer plain, the upper one screen-blended, drifting the other way
  and fading in and out. Every 4 minutes the pair moves to the next flames with a 30
  second cross-fade. Under reduced motion the layers are still and the pair changes
  without a fade. The three images are in `wall/src/assets/flames/`; they were rendered
  for this project with a fractal flame renderer (see the README there).
- **Breathing guide** (`Breath.tsx`, maths in `model.ts`). A 12 second cycle: 4 s in,
  2 s hold, 6 s out. A thin cyan to pink ring scales from 0.8 to 1.06 of 370 px with a
  cubic ease, inside a faint fixed ring at the full inhale size, with a glow (a sibling of the masked ring) that
  brightens on the inhale. The phase word and the seconds left sit in the centre at a
  fixed size; `minRingDiameter` checks that the longest word clears the smallest ring by
  40 px. Starting restarts the cycle at "Breathe in".
- **Zen layout** (`Zen.tsx`). Flames sit behind a veil that leaves about 45 percent of their
  light. Top left: the clock. Bottom left: the length picker and Start, or while a session
  runs "FIVE MINUTES OF ZEN" with "N:NN left.". Bottom centre while a session runs and is not ending: "Click anywhere
  to end early" at 13 px (a click outside Leave ends the session). On entry, keyboard focus starts on the chosen length. The chosen length is the
  one filled chip; keyboard focus is a separate offset ring. Leave is at least 36 px tall. Bottom right: Leave, and "After this:
  N things are waiting." from the same task feed as the Work card (hidden when it is not set
  up or empty; the "Neither is urgent." line shows only when every task has a quadrant and
  none is urgent). The feed returns at most 3 tasks, so a full list reads "3 or more things are waiting." with no urgency line; under reduced motion the ring holds still and only the word and seconds change.
- **Dream** (`Dream.tsx`). Flames dim to 35 percent, the guide is hidden, and the screen
  follows the concept: a large thin clock at left centre (about half white) with the date
  under it, a Tomorrow card at right centre (tomorrow's first meeting from the same feed and
  rules as Unwind's Tomorrow: "as of" when cached, hidden when too old, one line when the
  calendar cannot be read, absent on a clear day), and a quiet 13 px status line at bottom
  left (agents still working and whether one needs the owner, only from a fresh helper
  answer; the lights mood that is on, only when this wall set one in the last three hours).
  The hint reads "Click anywhere to wake"; moving the mouse does not wake it (the strip sits right under the main monitor, so the pointer
  wanders onto it). Nothing is bright. All the text (clock, date, card, status, hint) sits in one layer that drifts by transform alone along a
  closed 30 by 20 px path, one lap in 20 minutes, so no pixel stays lit for hours; under reduced motion it holds one of four points for 7.5 minutes, then
  jumps to the next. The status line and hint are at 40 percent, the card has no frame. Nothing else moves except Watt. Watt sleeps in the corner (the `SheepSvg` sleep pose from `buddy/Watt.tsx`,
  at x 1226, ground line 688). The dimmed state starts when a session ends (the guide fades out
  first), or by itself late at night: from 10 PM until 6 AM local time, once the PC has had no
  input for ten minutes. "Input" is the PC's idle age from `wall2_idle_state` (idle seconds),
  asked every 10 seconds while Zen is lit, after the dim hour and the page is visible, so typing in
  another app keeps Zen bright; a click or key on the wall after the question was sent voids that
  answer. When the command is missing or fails (a browser, dev), the wall's own pointer, wheel and
  key input is the fallback. The hour (18 to 23) and the wait (1 to 60 minutes) are the
  `zenDimHour` and `zenDimWaitMin` settings. From 6 PM Zen shows a quiet line under the session controls that says when it dims. A click
  wakes back to Zen; it dims again only after another quiet wait. Leave returns to Work.
  `openDream` (Unwind's Dream tab, removed later) opens Zen already dimmed.
- **Horizon.** While Zen is active the horizon canvas is hidden and not drawn (no frame
  loop, no timer redraw). Leaving resumes it, gliding from the last camera.
