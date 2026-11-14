import { invoke } from '../bridge/tauri';

/**
 * What the wall may know about the YouTube sign-in: whether a Google client is set up, whether a
 * sign-in is stored, and one fixed word. The client id, the client secret and the tokens never
 * come back from Rust. `searchesLeft` is for the search of a later change and is empty for now.
 */
export interface YoutubeStatus { setup: boolean; signedIn: boolean; reason: string | null; searchesLeft: number | null }
/** The two links YouTube API Services asks every app that uses them to show; Rust owns the addresses. */
export type YoutubeLink = 'youtube-terms' | 'google-privacy';

export const youtube = {
  status: () => invoke<YoutubeStatus>('wall2_youtube_status'),
  /** Rust checks both values and refuses while signed in. Nothing is returned, and nothing reads them back. */
  setClient: (clientId: string, clientSecret: string) => invoke<void>('wall2_youtube_set_client', { clientId, clientSecret }),
  forgetClient: () => invoke<void>('wall2_youtube_forget_client'),
  signIn: () => invoke<void>('wall2_youtube_sign_in'),
  cancelSignIn: () => invoke<void>('wall2_youtube_cancel_sign_in'),
  signOut: () => invoke<void>('wall2_youtube_sign_out'),
  /** Only the kind word goes over; the address is fixed in Rust. */
  openLink: (kind: YoutubeLink) => invoke<void>('wall2_open_link', { kind }),
};
