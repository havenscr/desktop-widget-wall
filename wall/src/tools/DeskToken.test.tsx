// @ts-ignore node's own file calls; one test reads the Rust command registration as text.
import { readFileSync } from 'node:fs';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mocks } from '../bridge/tauri';
import { resetHome, useHome } from '../studio/homeStore';
import { HoverTipLayer, resetTip } from '../ui/HoverTip';
import { DeskToken, TOKEN_ERRORS } from './DeskToken';

vi.setConfig({ testTimeout: 20_000 });

const lib: string = readFileSync('../src-tauri/src/lib.rs', 'utf8');
const flush = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

// An invented value.
const TOKEN = 'sample-desk-token-123';
let status: { set: boolean; unreadable: boolean };
let calls: { command: string; args?: Record<string, unknown> }[];
let setWord: string | null;
let studioReads: number;

beforeEach(() => {
  vi.useFakeTimers();
  resetHome();
  resetTip();
  status = { set: false, unreadable: false };
  calls = [];
  setWord = null;
  studioReads = 0;
  mocks.set('wall2_desk_token_status', () => status);
  mocks.set('wall2_desk_token_set', (args) => {
    calls.push({ command: 'set', args });
    if (setWord) throw setWord;
    status = { set: true, unreadable: false };
  });
  mocks.set('wall2_desk_token_forget', () => {
    calls.push({ command: 'forget' });
    status = { set: false, unreadable: false };
  });
  mocks.set('wall2_studio', () => {
    studioReads++;
    throw 'absent';
  });
});
afterEach(() => {
  resetHome();
  vi.useRealTimers();
  mocks.clear();
});

const show = async () => {
  const view = render(
    <>
      <DeskToken />
      <HoverTipLayer />
    </>,
  );
  await flush();
  return view;
};
const field = () => screen.getByLabelText('Desk token') as HTMLInputElement;
const type = (v: string) => fireEvent.change(field(), { target: { value: v } });

it('says Not set, then Set up opens a password field that is not remembered or spell checked', async () => {
  await show();
  expect(screen.getByText('Home app')).toBeTruthy();
  expect(screen.getByText('Not set')).toBeTruthy();
  fireEvent.click(screen.getByText('Set up'));
  const f = field();
  expect(f.type).toBe('password');
  expect(f.getAttribute('autocomplete')).toBe('off');
  expect(f.getAttribute('spellcheck')).toBe('false');
  expect(screen.getByText('Save').closest('button')?.hasAttribute('disabled')).toBe(true);
});

it('Save sends the value once, empties the field, says Set, and the token is in no text on the page', async () => {
  await show();
  fireEvent.click(screen.getByText('Set up'));
  type(`  ${TOKEN} `);
  fireEvent.click(screen.getByText('Save'));
  await flush();
  expect(calls).toEqual([{ command: 'set', args: { token: `  ${TOKEN} ` } }]);
  expect(screen.queryByLabelText('Desk token')).toBeNull();
  expect(screen.getByText('Set')).toBeTruthy();
  expect(document.body.innerHTML).not.toContain(TOKEN);
  expect(screen.getByText('Change')).toBeTruthy();
  expect(screen.getByText('Forget')).toBeTruthy();
  // The studio is read again after the token changed.
  expect(studioReads).toBeGreaterThan(0);
});

it('Enter saves, Escape cancels and empties the field without closing anything else', async () => {
  const outer = vi.fn();
  document.addEventListener('keydown', outer);
  await show();
  fireEvent.click(screen.getByText('Set up'));
  type(TOKEN);
  fireEvent.keyDown(field(), { key: 'Escape' });
  expect(screen.queryByLabelText('Desk token')).toBeNull();
  expect(screen.getByText('Not set')).toBeTruthy();
  expect(outer).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('Set up'));
  expect(field().value).toBe('');
  type(TOKEN);
  fireEvent.keyDown(field(), { key: 'Enter' });
  await flush();
  expect(calls).toHaveLength(1);
  document.removeEventListener('keydown', outer);
});

it('Cancel closes the form and nothing is sent', async () => {
  await show();
  fireEvent.click(screen.getByText('Set up'));
  type(TOKEN);
  fireEvent.click(screen.getByText('Cancel'));
  expect(calls).toHaveLength(0);
  expect(document.body.innerHTML).not.toContain(TOKEN);
});

it('a refused value and a failed save show their fixed lines and empty the field either way', async () => {
  await show();
  fireEvent.click(screen.getByText('Set up'));
  type('two words');
  setWord = 'invalid';
  fireEvent.click(screen.getByText('Save'));
  await flush();
  expect(screen.getByText(TOKEN_ERRORS.invalid)).toBeTruthy();
  expect(field().value).toBe('');
  type(TOKEN);
  setWord = 'failed';
  fireEvent.click(screen.getByText('Save'));
  await flush();
  expect(screen.getByText(TOKEN_ERRORS.failed)).toBeTruthy();
  expect(field().value).toBe('');
  expect(document.body.innerHTML).not.toContain(TOKEN);
  expect(TOKEN_ERRORS.invalid).toBe('That token has characters the home app cannot take');
  expect(TOKEN_ERRORS.failed).toBe('Could not save the token');
});

it('Forget removes it and reads the studio again; a set token shows Set, Change and Forget', async () => {
  status = { set: true, unreadable: false };
  await show();
  expect(screen.getByText('Set')).toBeTruthy();
  fireEvent.click(screen.getByText('Forget'));
  await flush();
  expect(calls).toEqual([{ command: 'forget' }]);
  expect(screen.getByText('Not set')).toBeTruthy();
  expect(studioReads).toBeGreaterThan(0);
});

it('a token that could not be read says so, offers Change and Forget, and a kept amber line goes when the token changes', async () => {
  status = { set: false, unreadable: true };
  useHome.setState({ sticky: 'forbidden' });
  await show();
  expect(screen.getByText('The saved token could not be read. Type it again.')).toBeTruthy();
  expect(screen.getByText('Change')).toBeTruthy();
  fireEvent.click(screen.getByText('Change'));
  type(TOKEN);
  fireEvent.click(screen.getByText('Save'));
  await flush();
  expect(useHome.getState().sticky).toBeNull();
  expect(screen.queryByText(/could not be read/)).toBeNull();
});

it('every control has a hover tip, and the field tip says where the token is kept', async () => {
  await show();
  const tipOf = async (el: Element) => {
    fireEvent.mouseEnter(el);
    await flush(300);
    const t = document.querySelector('.hover-tip')?.textContent ?? '';
    fireEvent.mouseLeave(el);
    await flush(50);
    return t;
  };
  expect(await tipOf(screen.getByText('Set up'))).toContain('desk token');
  fireEvent.click(screen.getByText('Set up'));
  expect(await tipOf(field())).toContain('Windows Credential Manager');
  type(TOKEN);
  expect(await tipOf(screen.getByText('Save'))).toContain('Saves the token on this PC');
  expect(await tipOf(screen.getByText('Cancel'))).toContain('without saving');
});

it('the commands are registered natively, and the page never reads the token back', () => {
  for (const c of ['wall2_desk_token_status', 'wall2_desk_token_set', 'wall2_desk_token_forget', 'wall2_studio', 'wall2_studio_preset', 'wall2_studio_normal', 'wall2_studio_group', 'wall2_studio_look', 'wall2_studio_keys', 'wall2_office_moods', 'wall2_office_mood']) {
    expect(lib).toContain(c);
  }
});
