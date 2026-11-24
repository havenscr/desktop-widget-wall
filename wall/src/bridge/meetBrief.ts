import { invoke } from './tauri';

/**
 * Types and typed `invoke` wrappers for the meeting brief and the person actions (plumbing only: no screen uses them yet).
 * The native side (`wall2_meet/brief.rs`, `brief_token.rs`, `people.rs`) sends the helper one HMAC key, builds every link
 * itself and keeps it behind a key, so nothing here is ever a URL, an id, an address or a token.
 */

/** Fixed error words the brief commands reject with. */
export type BriefError = 'not-configured' | 'invalid-config' | 'not-set-up' | 'forbidden' | 'gone' | 'failed';

export type BriefState = 'ready' | 'building' | 'none';
export type MatchKind = 'client' | 'internal' | 'unknown' | 'mixed' | 'none';
/** One source's state; any word Rust does not know arrives as `failed`. */
export type SourceState = 'ok' | 'empty' | 'not-set-up' | 'failed';
export type ItemSource = 'crm' | 'mail' | 'chat' | 'note' | 'file';
/** Krisp notes open a krisp.ai link (https only), built and checked in Rust. */
export type ItemKind = 'note' | 'thread' | 'chat' | 'meeting' | 'file' | 'folder';

export interface BriefSources {
  crm: SourceState;
  mail: SourceState;
  chats: SourceState;
  notes: SourceState;
  files: SourceState;
}

export interface BriefCompany {
  name: string;
  lifecycle: string | null;
  owner: string | null;
  /** RFC 3339, or null. */
  lastActivity: string | null;
}

export interface BriefPerson {
  name: string;
  title: string | null;
  lastContact: string | null;
}

export interface BriefDeal {
  name: string;
  stage: string | null;
  /** `YYYY-MM-DD`, or null. */
  closeDate: string | null;
}

export interface BriefItem {
  id: string;
  source: ItemSource;
  kind: ItemKind;
  title: string;
  when: string | null;
  who: string | null;
  preview: string | null;
  actions: string[];
  recording: boolean;
  unverifiedSender: boolean;
  /** `b<read>-<n>` for `wall2_meet_brief_open` when Rust holds a link for the item; never the link. */
  openKey: string | null;
}

/** What `wall2_meet_brief` answers. Caps: 8 people, 5 deals, 40 items, title 120, preview 200, 5 actions of 120. */
export interface BriefOut {
  state: BriefState;
  builtAt: string | null;
  start: string | null;
  stale: boolean;
  match: { kind: MatchKind; label: string | null };
  sources: BriefSources;
  company: BriefCompany | null;
  people: BriefPerson[];
  deals: BriefDeal[];
  items: BriefItem[];
}

/** What the token status commands answer: never the token, its length or any part of it. */
export interface BriefTokenStatus {
  set: boolean;
  unreadable: boolean;
}

export type PersonAction = 'copy' | 'email' | 'teams' | 'contact';

/** The brief for a meeting. `key` is the meeting key from the last `wall2_meet_next` read. */
export const readBrief = (key: string): Promise<BriefOut> => invoke<BriefOut>('wall2_meet_brief', { key });

/** Open the link behind an item's `openKey` (checked again in Rust). */
export const openBriefItem = (openKey: string): Promise<void> => invoke<void>('wall2_meet_brief_open', { openKey });

export const briefTokenStatus = (): Promise<BriefTokenStatus> => invoke<BriefTokenStatus>('wall2_meet_brief_token_status');
export const setBriefToken = (value: string): Promise<void> => invoke<void>('wall2_meet_brief_token_set', { value });
export const clearBriefToken = (): Promise<void> => invoke<void>('wall2_meet_brief_token_clear');

/**
 * Copy the address, start an email, start a Teams chat or open the saved contact in classic Outlook for a listed person; `key` is
 * `Person.key`. Nothing is sent. `contact` is refused with `unavailable` unless `personContact` said `available` for that key.
 */
export const personAction = (key: string, action: PersonAction): Promise<void> => invoke<void>('wall2_meet_person_action', { key, action });

/** The one address Rust hands the page, for one person key, on a click. Never while On Air is live (`on-air`). */
export interface PersonAddress {
  address: string;
}

/** Fixed words `personAddress` can reject with: `on-air`, `gone` (no such key) and `invalid` (the stored address failed the check). */
export const personAddress = (key: string): Promise<PersonAddress> => invoke<PersonAddress>('wall2_meet_person_address', { key });

/** Tell Rust whether On Air is live, so it refuses `personAddress` (it also refuses on its own when the native recorder is on). */
export const setOnAirLive = (live: boolean): Promise<void> => invoke<void>('wall2_meet_set_on_air', { live });

/** Whether "Open contact card" is offered: one saved contact for the person and classic Outlook usable and selected. */
export interface PersonContact {
  available: boolean;
}

/** Asked when a card opens; Rust answers from its own lookup and holds the answer for the life of that read. */
export const personContact = (key: string): Promise<PersonContact> => invoke<PersonContact>('wall2_meet_person_contact', { key });

/** Fixed words `askBrief` can reject with. */
export type AskError = 'not-ready' | 'busy' | 'limit' | 'day-limit' | 'refused' | 'model-off' | 'ask-off' | 'limit-store' | 'forbidden' | 'failed' | 'not-set-up' | 'not-configured' | 'invalid-config' | 'gone';
export type AskModel = 'Sonnet' | 'Opus' | 'Claude';
export type AskState = 'off' | 'ready' | 'busy' | 'failing';

export interface AskTurn {
  q: string;
  a: string;
}

/** The answer to one question: plain text, at most 1200 characters, never markup. */
export interface AskAnswer {
  a: string;
  model: AskModel;
}

/** What `wall2_meet_brief_health` answers: two fixed words and nothing else. */
export interface BriefHealth {
  ask: { state: AskState; name: AskModel };
}

/** Ask one question about the meeting's brief. Content leaves the box only when this is called (the Enter key). */
export const askBrief = (key: string, q: string, turns: AskTurn[]): Promise<AskAnswer> => invoke<AskAnswer>('wall2_meet_brief_ask', { key, q, turns });

/** The box's ask status; never calls the model. */
export const briefHealth = (): Promise<BriefHealth> => invoke<BriefHealth>('wall2_meet_brief_health');
