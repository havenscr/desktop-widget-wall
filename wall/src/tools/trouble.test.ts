import { expect, it } from 'vitest';
import { calendarName, troubleLine } from './trouble';

const acct = (label: string, state: 'ok' | 'signed-out' | 'needs-sign-in' | 'unavailable' | 'checking') => ({ id: label, label, state });

it('names a calendar without doubling the word', () => {
  expect(calendarName('Second')).toBe('Second calendar');
  expect(calendarName('Team Calendar')).toBe('Team Calendar');
});

it('says nothing when every account is fine or only being checked', () => {
  expect(troubleLine([acct('Work', 'ok'), acct('Second', 'checking')])).toBeNull();
  expect(troubleLine([])).toBeNull();
});

it('names the one account in trouble and what is wrong', () => {
  expect(troubleLine([acct('Work', 'ok'), acct('Second', 'signed-out')])).toBe('Second calendar signed out.');
  expect(troubleLine([acct('Second', 'needs-sign-in')])).toBe('Second calendar sign-in expired.');
  expect(troubleLine([acct('Second', 'unavailable')])).toBe('Second calendar not answering.');
});

it('counts when more than one account needs attention', () => {
  expect(troubleLine([acct('Work', 'signed-out'), acct('Second', 'unavailable')])).toBe('2 calendars need attention.');
});
