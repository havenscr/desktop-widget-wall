# Privacy

Ridgeline is a desktop app that runs on your own Windows PC. The project runs no server and
has no accounts of its own. This page says what the app does with data from a Google account
when you sign in to YouTube in Tools.

## What the app asks for

One permission: `https://www.googleapis.com/auth/youtube.readonly` (view your YouTube
account). With it the app can read. It cannot change, post or delete anything on the account.

You sign in with an OAuth client that you make in your own Google Cloud project. The project
ships no client of its own and receives nothing from yours.

## What it reads

- Your playlists and the videos in them.
- Your liked videos.
- The results of a music search that you type.
- The title, the channel's name and the length of a video you add to a playlist you made on the wall, and of the videos in such a playlist that still lack them when you open it to edit. Only the video's id is sent with your YouTube sign-in.

For each video the app reads the title, the channel's name, the length, and the flags that say
whether the video can play in an embedded player. It does not read descriptions or comments.

## What it does with it

The app shows these lists on the wall and plays the video you pick. It uses the data for
nothing else.

## Where it is kept

- **The lists** stay in the app's memory. They are gone when you sign out or close the app.
- **An item you add to the wall's own watch list** is kept in the app's local storage on this
  PC until you remove it: its kind, its id and the name shown for it (the video's title unless
  you rename it). That list is built from links you paste. Nothing is copied into it from your
  YouTube library on its own. A playlist you make on the wall is one more item in that list (its
  kind, a code made on the wall and its name). Its videos are kept in a second local storage
  key: for each video its id and, once the player has reported them or YouTube has answered
  for them while you are signed in, its channel and length; its title, the same way or as the
  name you gave a saved video that you add (a name you gave is never replaced); and the
  playlist's shuffle and repeat switches. Nothing is created on YouTube.
- **The sign-in** (Google's refresh token) is kept in Windows Credential Manager. Your client
  id and client secret are kept there too when you enter them in the app. If you supply them
  as a `youtube.json` file in the app's config folder instead, they stay in that file, which
  you made and the app only reads. The short-lived access token stays in memory only.
- **The log** `wall2-youtube.log` holds fixed words, an HTTP status and a duration. It never
  holds an id, a token, a title, a channel or the words of a search.

## Who it is shared with

No one. Data that the app receives from Google is not sent to the project, to its developer
or to any third party. The app talks to Google only: the sign-in, YouTube's Data API, and
YouTube's own picture host and player for the small pictures and for playback.

## Taking the access away

- In the app: Tools, YouTube, Sign out. The app tells Google to end the grant and deletes the
  stored sign-in. If you are offline, the stored sign-in is still deleted, and you can end the
  grant at Google as below.
- At Google: remove the app at <https://myaccount.google.com/permissions>.
- Uninstalling the app does not sign out for you. Sign out first, or remove the app at Google.

## Google's terms

The app uses YouTube API Services. By using the YouTube part of the app you agree to the
[YouTube Terms of Service](https://www.youtube.com/t/terms). Google's own handling of your
data is described in the [Google Privacy Policy](https://policies.google.com/privacy).
