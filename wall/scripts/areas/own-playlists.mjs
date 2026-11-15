// Playlists the owner makes on the wall (Part 12: 1D, 2B, 3A, 4C): gallery states for the list, the name row, the play row's
// add menu, the editor, the playing view, the skip note and the end block; fit variants with one in-page measurement and its
// rules; and a deliberate break for each rule. The mock frame never loads a real player (`watch=mock`) and the pictures are
// drawn `data:` motifs through the `ownThumb` seam, so no state reaches YouTube. The knob `wown=` is in `devMocks/watch.ts`.
// Everything this area needs lives here.

const BASE = 'hz=unwind&at=2026-11-11T22%3A30%3A00-08%3A00&clock=review&weather=ok&watch=mock&wlook=sky&wmeta=title';
const PLAY3 = 'wplay=3';
const state = (name, extra, expect, actions) => ({
  screen: 'unwind',
  name: `own playlists: ${name}`,
  query: `${BASE}&${extra}`,
  custom: true,
  ...(typeof expect === 'string' && expect.startsWith('note:') ? { expectNote: expect.slice(5) } : { expect }),
  ...(actions ? { actions } : {}),
});

const states = [
  state('the list, a playlist with its count and the YouTube word', `wown=lists&${PLAY3}`, ['Friday wind down', '12 videos', '5 videos', 'Weekend cooking', 'YouTube', 'New playlist', '6 saved']),
  state('the name row of a new playlist', `wown=draft&${PLAY3}`, 'note:the name field holds its text as a value, not as text; the rest of the list is as in the list state'),
  state('the add menu in the play row', `wown=menu&${PLAY3}`, ['Add this video to', 'Friday wind down', 'Slow mornings', 'New playlist']),
  state('the add menu, a row hovered', `wown=menu&${PLAY3}`, ['Add this video to', 'Add this video to Friday wind down'], 'hover:.w-pop-row'),
  state('the add button, hovered', `wown=lists&${PLAY3}`, 'Add to a playlist', 'hover:.w-addpl'),
  state('the editor, twelve videos', `wown=edit&${PLAY3}`, ['Friday wind down', '12 videos · 10 h 13 min', 'named once it has played', 'Plays only on YouTube', 'What is playing', 'From the Watch list', 'Done']),
  state('the editor, a row held by its grip', `wown=drag&${PLAY3}`, ['Friday wind down', 'What is playing']),
  state('the editor, a row dragged to the third place', `wown=edit&${PLAY3}`, ['Friday wind down', 'What is playing'], 'drag:.own-v:nth-child(6) .own-grip@2050,245'),
  state('the editor, a grip hovered', `wown=edit&${PLAY3}`, 'Drag to put it in order', 'hover:.own-grip'),
  state('the editor, From the Watch list', `wown=edit&${PLAY3}`, ['Night drive mix', 'Done'], '.own-chip:nth-child(2)'),
  state('playing, the card follows', 'wown=playing', ['Your playlist · 3 of 12', 'Playing Friday wind down', 'Next', 'Late train through the valley', 'Stops after the last video', '3 of 12']),
  state('playing with repeat on', 'wown=repeat', ['Repeat is on: it starts again after the last video', 'Your playlist · 3 of 12']),
  state('playing, a switch hovered', 'wown=repeat', 'Repeat is on', 'hover:.w-own-switch:nth-child(2)'),
  state('playing, back to the list shows the pill', 'wown=playing', ['3 of 12', 'Friday wind down', '!Stops after the last video'], '.own-back'),
  state('a video skipped, with its note', 'wown=skip', ['Skipped one: it plays only on YouTube', 'Your playlist · 6 of 12']),
  state('the end, the playlist ran out', 'wown=end', ['Your playlist · ended', 'All 12 videos played', 'Stopped after the last video', 'Play again', 'Edit the playlist']),
  state('the end, nothing could play', 'wown=none', ['Your playlist · ended', 'None of these can play here', 'Open in YouTube', 'Edit the playlist']),
  state('the delete question on a row', `wown=lists&${PLAY3}`, ['Delete Friday wind down and its 12 videos?', 'Keep'], '.own-row .w-mini:nth-of-type(2)'),
];

export default {
  name: 'own-playlists',
  gallery: { states },
};
