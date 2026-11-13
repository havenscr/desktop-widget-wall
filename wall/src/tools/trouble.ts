import { needsSignIn, type MeetAccount } from '../meet/model';

/** "Second" becomes "Second calendar"; a label that already says calendar stays as it is. */
export function calendarName(label: string): string {
  return /calendar/i.test(label) ? label : `${label} calendar`;
}

/**
 * The one amber line for Meet's Next card when an account needs attention, or null. It names
 * the account and says what is wrong; the card adds "Open Tools" as the click. Accounts that
 * are only being checked are not in trouble.
 */
export function troubleLine(accounts: readonly MeetAccount[]): string | null {
  const out = accounts.filter((a) => needsSignIn(a.state));
  const down = accounts.filter((a) => a.state === 'unavailable');
  const n = out.length + down.length;
  if (n === 0) return null;
  if (n > 1) return `${n} calendars need attention.`;
  if (out.length === 1) return `${calendarName(out[0].label)} ${out[0].state === 'needs-sign-in' ? 'sign-in expired' : 'signed out'}.`;
  return `${calendarName(down[0].label)} not answering.`;
}
