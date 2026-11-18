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

export type PersonAction = 'copy' | 'email' | 'teams';

/** The brief for a meeting. `key` is the meeting key from the last `wall2_meet_next` read. */
export const readBrief = (key: string): Promise<BriefOut> => invoke<BriefOut>('wall2_meet_brief', { key });

/** Open the link behind an item's `openKey` (checked again in Rust). */
export const openBriefItem = (openKey: string): Promise<void> => invoke<void>('wall2_meet_brief_open', { openKey });

export const briefTokenStatus = (): Promise<BriefTokenStatus> => invoke<BriefTokenStatus>('wall2_meet_brief_token_status');
export const setBriefToken = (value: string): Promise<void> => invoke<void>('wall2_meet_brief_token_set', { value });
export const clearBriefToken = (): Promise<void> => invoke<void>('wall2_meet_brief_token_clear');

/** Copy the address, start an email or start a Teams chat for a listed person; `key` is `Person.key`. Nothing is sent. */
export const personAction = (key: string, action: PersonAction): Promise<void> => invoke<void>('wall2_meet_person_action', { key, action });
