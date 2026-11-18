import type { BriefOut, BriefTokenStatus } from '../meetBrief';
import { mocks } from '../tauri';

/**
 * Invented answers for the brief commands (plumbing only: no screen reads them yet). Every name, company and domain here is
 * made up. Three meetings: a client with history, a brand-new contact with every source empty or not set up, and a mixed
 * invite. Nothing in them is a URL, an id or an address.
 */

const sources = (s: Partial<BriefOut['sources']>): BriefOut['sources'] => ({ crm: 'empty', mail: 'empty', chats: 'empty', notes: 'empty', files: 'empty', ...s });

export const BRIEF_CLIENT: BriefOut = {
  state: 'ready',
  builtAt: '2026-11-12T16:55:00Z',
  start: '2026-11-12T17:00:00Z',
  stale: false,
  match: { kind: 'client', label: 'Northwind Outfitters' },
  sources: sources({ crm: 'ok', mail: 'ok', chats: 'ok', notes: 'ok', files: 'ok' }),
  company: { name: 'Northwind Outfitters', lifecycle: 'Customer', owner: 'Marcus Veld', lastActivity: '2026-11-10T09:00:00Z' },
  people: [
    { name: 'Priya Calder', title: 'Head of Operations', lastContact: '2026-11-10T09:00:00Z' },
    { name: 'Tomas Reyes', title: 'Finance Lead', lastContact: '2026-10-21T14:30:00Z' },
  ],
  deals: [{ name: 'Annual renewal', stage: 'Proposal sent', closeDate: '2026-12-15' }],
  items: [
    {
      id: 'i1',
      source: 'mail',
      kind: 'thread',
      title: 'Re: renewal terms for next year',
      when: '2026-11-11T10:00:00Z',
      who: 'Priya Calder',
      preview: 'Happy to go ahead if the support hours stay the same. Can you send the revised quote?',
      actions: ['Send the revised quote'],
      recording: false,
      unverifiedSender: false,
      openKey: 'b1-0',
    },
    {
      id: 'i2',
      source: 'note',
      kind: 'meeting',
      title: 'Quarterly check-in',
      when: '2026-09-18T15:00:00Z',
      who: 'Marcus Veld',
      preview: 'Reporting is stable; they want a dashboard refresh in Q1.',
      actions: ['Scope the Q1 dashboard refresh', 'Share the usage summary'],
      recording: true,
      unverifiedSender: false,
      openKey: null,
    },
    {
      id: 'i3',
      source: 'crm',
      kind: 'note',
      title: 'Call: pricing questions',
      when: '2026-10-21T14:30:00Z',
      who: 'Marcus Veld',
      preview: null,
      actions: [],
      recording: false,
      unverifiedSender: false,
      openKey: 'b1-1',
    },
  ],
};

export const BRIEF_NEW_CONTACT: BriefOut = {
  state: 'ready',
  builtAt: '2026-11-12T16:55:00Z',
  start: '2026-11-12T19:00:00Z',
  stale: false,
  match: { kind: 'unknown', label: null },
  sources: sources({ crm: 'empty', mail: 'empty', chats: 'not-set-up', notes: 'not-set-up', files: 'empty' }),
  company: null,
  people: [],
  deals: [],
  items: [],
};

export const BRIEF_MIXED: BriefOut = {
  state: 'none',
  builtAt: '2026-11-12T16:55:00Z',
  start: '2026-11-12T21:00:00Z',
  stale: false,
  match: { kind: 'mixed', label: null },
  sources: sources({ crm: 'not-set-up', mail: 'not-set-up', chats: 'not-set-up', notes: 'not-set-up', files: 'not-set-up' }),
  company: null,
  people: [],
  deals: [],
  items: [],
};

/** The mock meeting keys (`wall2_meet_next` mocks rotate them, so the brief mock cycles by key's last digit instead). */
const BRIEFS: BriefOut[] = [BRIEF_CLIENT, BRIEF_NEW_CONTACT, BRIEF_MIXED];

export function registerMeetBriefMocks(): void {
  let token: BriefTokenStatus = { set: true, unreadable: false };
  mocks.set('wall2_meet_brief_token_status', () => ({ ...token }));
  mocks.set('wall2_meet_brief_token_set', (args) => {
    const value = typeof args?.value === 'string' ? args.value.trim() : '';
    if (!/^[\x21-\x7e]{1,256}$/.test(value)) throw 'invalid';
    token = { set: true, unreadable: false };
  });
  mocks.set('wall2_meet_brief_token_clear', () => {
    token = { set: false, unreadable: false };
  });
  mocks.set('wall2_meet_brief', (args) => {
    if (!token.set) throw 'not-set-up';
    const key = typeof args?.key === 'string' ? args.key : '';
    const n = Number(key.split('-')[1]);
    if (!Number.isInteger(n) || n < 0) throw 'gone';
    return BRIEFS[n % BRIEFS.length];
  });
  mocks.set('wall2_meet_brief_open', () => undefined);
  mocks.set('wall2_meet_person_action', (args) => {
    if (typeof args?.key !== 'string' || !/^p\d+-\d+$/.test(args.key)) throw 'gone';
    if (!['copy', 'email', 'teams'].includes(String(args.action))) throw 'failed';
  });
}
