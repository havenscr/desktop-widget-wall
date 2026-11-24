import type { AskAnswer, BriefHealth, BriefOut, BriefTokenStatus } from '../meetBrief';
import { mocks } from '../tauri';

/**
 * Invented answers for the brief commands (the Meet island reads them). Every name, company and domain here is
 * made up. Three meetings: a client with history, a brand-new contact with every source empty or not set up, and a mixed
 * invite. Nothing in them is a URL, an id or an address.
 */

/** The one invented person key with a saved contact. Every other key has none. */
const CONTACT_KEY = 'p1-0';

/** The dev preview says On Air is live when the page is opened with `?onairlive=1`. */
const onAirLive = (): boolean => {
  try {
    return new URLSearchParams(globalThis.location?.search ?? '').get('onairlive') === '1';
  } catch {
    return false;
  }
};

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

/** A known client and nothing on file yet: Teams is not signed in. */
export const BRIEF_EMPTY: BriefOut = { ...BRIEF_NEW_CONTACT, match: { kind: 'client', label: 'Northwind Outfitters' }, sources: sources({ chats: 'not-set-up' }) };

export const BRIEF_BUILDING: BriefOut = { ...BRIEF_NEW_CONTACT, state: 'building' };

const KINDS: [BriefOut['items'][number]['source'], BriefOut['items'][number]['kind']][] = [['mail', 'thread'], ['chat', 'chat'], ['file', 'file'], ['file', 'folder'], ['crm', 'note'], ['note', 'meeting']];

/** Ten items, one with a 120 character title (the cap), for the 7 row limit and the ellipsis. */
export const BRIEF_MANY: BriefOut = {
  ...BRIEF_CLIENT,
  items: Array.from({ length: 10 }, (_, i) => ({
    ...BRIEF_CLIENT.items[i % BRIEF_CLIENT.items.length],
    id: `m${i}`,
    source: KINDS[i % KINDS.length][0],
    kind: KINDS[i % KINDS.length][1],
    title: i === 1 ? 'Re: the revised support hours, the renewal quote, the dashboard refresh scope and who signs off on each part before the end of the year' : `Item ${i + 1}: notes from the renewal talks`,
    unverifiedSender: i === 2,
    openKey: i % 2 === 0 ? `b1-${i}` : null,
  })),
};

/** `?brief=ready|empty|building|off|forbidden|failed|many` picks the answer for every meeting; the default is `off`. */
const briefMode = (): string => {
  try {
    return new URLSearchParams(globalThis.location?.search ?? '').get('brief') ?? 'off';
  } catch {
    return 'off';
  }
};

/** `?token=off` starts with no brief key saved; the default is a saved key. */
const tokenOff = (): boolean => {
  try {
    return new URLSearchParams(globalThis.location?.search ?? '').get('token') === 'off';
  } catch {
    return false;
  }
};

/** `?ask=ok|slow|busy|off|limit|refused|failing` picks the ask box's answer; the default is `off`. */
const askMode = (): string => {
  try {
    return new URLSearchParams(globalThis.location?.search ?? '').get('ask') ?? 'off';
  } catch {
    return 'off';
  }
};

/** Invented text only. Two lines, so the panel shows a real answer shape. */
export const ASK_ANSWER: AskAnswer = {
  a: 'Priya wrote on Nov 11 that she is happy to go ahead if the support hours stay the same, and asked for a revised quote. The brief does not say what the current hours are.',
  model: 'Sonnet',
};

const ASK_HEALTH: Record<string, BriefHealth['ask']> = {
  ok: { state: 'ready', name: 'Sonnet' },
  slow: { state: 'ready', name: 'Sonnet' },
  limit: { state: 'ready', name: 'Sonnet' },
  refused: { state: 'ready', name: 'Sonnet' },
  busy: { state: 'busy', name: 'Sonnet' },
  failing: { state: 'failing', name: 'Claude' },
};

export function registerMeetBriefMocks(): void {
  mocks.set('wall2_meet_brief_health', () => ({ ask: ASK_HEALTH[askMode()] ?? { state: 'off', name: 'Claude' } }));
  mocks.set('wall2_meet_brief_ask', async (args) => {
    if (typeof args?.key !== 'string' || args.key === '') throw 'gone';
    if (typeof args.q !== 'string' || args.q.trim() === '') throw 'failed';
    switch (askMode()) {
      case 'ok':
        return ASK_ANSWER;
      case 'slow':
        // Never answers inside a screenshot: the panel stays on "Asking".
        await new Promise((resolve) => setTimeout(resolve, 600_000));
        return ASK_ANSWER;
      case 'busy':
        throw 'busy';
      case 'limit':
        throw 'limit';
      case 'refused':
        throw 'refused';
      case 'failing':
        throw 'model-off';
      default:
        throw 'ask-off';
    }
  });
  let token: BriefTokenStatus = { set: !tokenOff(), unreadable: false };
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
    if (typeof args?.key !== 'string' || args.key === '') throw 'gone';
    if (!token.set) throw 'not-set-up';
    switch (briefMode()) {
      case 'ready':
        return BRIEF_CLIENT;
      case 'many':
        return BRIEF_MANY;
      case 'empty':
        return BRIEF_EMPTY;
      case 'building':
        return BRIEF_BUILDING;
      case 'forbidden':
        throw 'forbidden';
      case 'failed':
        throw 'failed';
      default:
        throw 'not-configured';
    }
  });
  mocks.set('wall2_meet_brief_open', () => undefined);
  mocks.set('wall2_meet_person_action', (args) => {
    if (typeof args?.key !== 'string' || !/^p\d+-\d+$/.test(args.key)) throw 'gone';
    if (!['copy', 'email', 'teams', 'contact'].includes(String(args.action))) throw 'failed';
    if (args.action === 'contact' && args.key !== CONTACT_KEY) throw 'unavailable';
  });
  mocks.set('wall2_meet_person_address', (args) => {
    if (onAirLive()) throw 'on-air';
    if (typeof args?.key !== 'string' || !/^p\d+-\d+$/.test(args.key)) throw 'gone';
    return { address: 'priya.calder@contoso.example' };
  });
  mocks.set('wall2_meet_set_on_air', () => undefined);
  mocks.set('wall2_meet_person_contact', (args) => {
    if (typeof args?.key !== 'string' || !/^p\d+-\d+$/.test(args.key)) throw 'gone';
    return { available: args.key === CONTACT_KEY };
  });
}
