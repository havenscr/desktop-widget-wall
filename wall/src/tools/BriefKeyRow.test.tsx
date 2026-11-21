import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mocks } from '../bridge/tauri';
import { HoverTipLayer, resetTip } from '../ui/HoverTip';
import { BRIEF_KEY_ERRORS, BriefKeyRow } from './BriefKeyRow';

vi.setConfig({ testTimeout: 20_000 });

const flush = () => act(async () => {});

// An invented value.
const KEY = 'sample-brief-key-123';
let status: { set: boolean; unreadable: boolean };
let calls: { command: string; args?: Record<string, unknown> }[];
let setWord: string | null;
let forgetFails: boolean;

beforeEach(() => {
  resetTip();
  status = { set: false, unreadable: false };
  calls = [];
  setWord = null;
  forgetFails = false;
  mocks.set('wall2_meet_brief_token_status', () => ({ ...status }));
  mocks.set('wall2_meet_brief_token_set', (args) => {
    calls.push({ command: 'set', args });
    if (setWord) throw setWord;
    status = { set: true, unreadable: false };
  });
  mocks.set('wall2_meet_brief_token_clear', () => {
    calls.push({ command: 'forget' });
    if (forgetFails) throw 'failed';
    status = { set: false, unreadable: false };
  });
});
afterEach(() => mocks.clear());

const show = async () => {
  render(
    <>
      <BriefKeyRow />
      <HoverTipLayer />
    </>,
  );
  await flush();
};
const field = () => screen.getByLabelText('Brief key') as HTMLInputElement;
const type = (v: string) => fireEvent.change(field(), { target: { value: v } });

it('says Not set, then Set up opens a password field that is not remembered or spell checked', async () => {
  await show();
  expect(screen.getByText('Meeting brief')).toBeTruthy();
  expect(screen.getByText('Not set')).toBeTruthy();
  fireEvent.click(screen.getByText('Set up'));
  expect(field().type).toBe('password');
  expect(field().getAttribute('autocomplete')).toBe('off');
  expect(field().getAttribute('spellcheck')).toBe('false');
  expect(screen.getByText('Save').closest('button')?.hasAttribute('disabled')).toBe(true);
});

it('Save sends the value once, empties the field, says Saved on this PC, and the key is in no text on the page', async () => {
  await show();
  fireEvent.click(screen.getByText('Set up'));
  type(`  ${KEY} `);
  fireEvent.click(screen.getByText('Save'));
  await flush();
  expect(calls).toEqual([{ command: 'set', args: { value: KEY } }]);
  expect(screen.queryByLabelText('Brief key')).toBeNull();
  expect(screen.getByText('Saved on this PC')).toBeTruthy();
  expect(document.body.innerHTML).not.toContain(KEY);
  expect(screen.getByText('Change')).toBeTruthy();
  expect(screen.getByText('Forget')).toBeTruthy();
});

it('Change replaces a saved key with the new one', async () => {
  status = { set: true, unreadable: false };
  await show();
  fireEvent.click(screen.getByText('Change'));
  type(KEY);
  fireEvent.click(screen.getByText('Save'));
  await flush();
  expect(calls).toEqual([{ command: 'set', args: { value: KEY } }]);
  expect(screen.getByText('Saved on this PC')).toBeTruthy();
  expect(document.body.innerHTML).not.toContain(KEY);
});

it('Forget removes the key and goes back to Not set', async () => {
  status = { set: true, unreadable: false };
  await show();
  expect(screen.getByText('Saved on this PC')).toBeTruthy();
  fireEvent.click(screen.getByText('Forget'));
  await flush();
  expect(calls).toEqual([{ command: 'forget' }]);
  expect(screen.getByText('Not set')).toBeTruthy();
  expect(screen.queryByText('Forget')).toBeNull();
});

it('a failed forget says its fixed line and keeps the key marked saved', async () => {
  status = { set: true, unreadable: false };
  forgetFails = true;
  await show();
  fireEvent.click(screen.getByText('Forget'));
  await flush();
  expect(screen.getByText(BRIEF_KEY_ERRORS.forget)).toBeTruthy();
  expect(screen.getByText('Saved on this PC')).toBeTruthy();
});

it('a refused key and a failed save show their fixed lines and empty the field either way', async () => {
  await show();
  fireEvent.click(screen.getByText('Set up'));
  type('two words');
  setWord = 'invalid';
  fireEvent.click(screen.getByText('Save'));
  await flush();
  expect(screen.getByText(BRIEF_KEY_ERRORS.invalid)).toBeTruthy();
  expect(field().value).toBe('');
  type(KEY);
  setWord = 'failed';
  fireEvent.click(screen.getByText('Save'));
  await flush();
  expect(screen.getByText(BRIEF_KEY_ERRORS.failed)).toBeTruthy();
  expect(field().value).toBe('');
  expect(document.body.innerHTML).not.toContain(KEY);
});

it('Escape closes the field only and empties it; Cancel sends nothing', async () => {
  const outer = vi.fn();
  document.addEventListener('keydown', outer);
  await show();
  fireEvent.click(screen.getByText('Set up'));
  type(KEY);
  fireEvent.keyDown(field(), { key: 'Escape' });
  document.removeEventListener('keydown', outer);
  expect(screen.queryByLabelText('Brief key')).toBeNull();
  expect(outer).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('Set up'));
  expect(field().value).toBe('');
  type(KEY);
  fireEvent.click(screen.getByText('Cancel'));
  expect(calls).toHaveLength(0);
  expect(document.body.innerHTML).not.toContain(KEY);
});

it('an unreadable key offers Change and Forget with a note', async () => {
  status = { set: false, unreadable: true };
  await show();
  expect(screen.getByText('The saved key could not be read. Type it again.')).toBeTruthy();
  expect(screen.getByText('Change')).toBeTruthy();
  expect(screen.getByText('Forget')).toBeTruthy();
});
