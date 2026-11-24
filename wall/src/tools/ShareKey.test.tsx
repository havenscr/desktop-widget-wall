// @ts-ignore node's own file calls; one test reads the Rust command registration as text.
import { readFileSync } from 'node:fs';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mocks } from '../bridge/tauri';
import { HoverTipLayer, resetTip } from '../ui/HoverTip';
import { SHARE_KEY_ERRORS, ShareKey } from './ShareKey';

vi.setConfig({ testTimeout: 20_000 });

const lib: string = readFileSync('../src-tauri/src/lib.rs', 'utf8');
const flush = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

// An invented value.
const KEY = 'sample-share-key-123';
let status: { set: boolean; unreadable: boolean };
let calls: { command: string; args?: Record<string, unknown> }[];
let setWord: string | null;

beforeEach(() => {
  vi.useFakeTimers();
  resetTip();
  status = { set: false, unreadable: false };
  calls = [];
  setWord = null;
  mocks.set('wall2_share_key_status', () => status);
  mocks.set('wall2_share_key_set', (args) => {
    calls.push({ command: 'set', args });
    if (setWord) throw setWord;
    status = { set: true, unreadable: false };
  });
  mocks.set('wall2_share_key_forget', () => {
    calls.push({ command: 'forget' });
    status = { set: false, unreadable: false };
  });
});
afterEach(() => {
  vi.useRealTimers();
  mocks.clear();
});

const show = async () => {
  const view = render(
    <>
      <ShareKey />
      <HoverTipLayer />
    </>,
  );
  await flush();
  return view;
};
const field = () => screen.getByLabelText('Share key') as HTMLInputElement;
const type = (v: string) => fireEvent.change(field(), { target: { value: v } });

it('has a Share key row that says Not set, and Set up opens a password field that is not remembered', async () => {
  await show();
  expect(screen.getByText('Share link')).toBeTruthy();
  expect(screen.getByText('Share key')).toBeTruthy();
  expect(screen.getByText('Not set')).toBeTruthy();
  fireEvent.click(screen.getByText('Set up'));
  expect(field().type).toBe('password');
  expect(field().getAttribute('autocomplete')).toBe('off');
  expect(field().getAttribute('spellcheck')).toBe('false');
  expect(screen.getByText('Save').closest('button')?.hasAttribute('disabled')).toBe(true);
});

it('Save sends the value once, empties the field, says Set, and the key is in no text on the page', async () => {
  await show();
  fireEvent.click(screen.getByText('Set up'));
  type(`  ${KEY} `);
  fireEvent.click(screen.getByText('Save'));
  await flush();
  expect(calls).toEqual([{ command: 'set', args: { key: `  ${KEY} ` } }]);
  expect(screen.queryByLabelText('Share key')).toBeNull();
  expect(screen.getByText('Set')).toBeTruthy();
  expect(document.body.innerHTML).not.toContain(KEY);
  expect(screen.getByText('Change')).toBeTruthy();
  expect(screen.getByText('Forget')).toBeTruthy();
});

it('Enter saves; Escape cancels and empties the field without closing anything else', async () => {
  const outer = vi.fn();
  document.addEventListener('keydown', outer);
  await show();
  fireEvent.click(screen.getByText('Set up'));
  type(KEY);
  fireEvent.keyDown(field(), { key: 'Escape' });
  expect(screen.queryByLabelText('Share key')).toBeNull();
  expect(outer).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('Set up'));
  expect(field().value).toBe('');
  type(KEY);
  fireEvent.keyDown(field(), { key: 'Enter' });
  await flush();
  expect(calls).toHaveLength(1);
  document.removeEventListener('keydown', outer);
});

it('a refused value and a failed save show their fixed lines and empty the field either way', async () => {
  await show();
  fireEvent.click(screen.getByText('Set up'));
  type('two words');
  setWord = 'invalid';
  fireEvent.click(screen.getByText('Save'));
  await flush();
  expect(screen.getByText(SHARE_KEY_ERRORS.invalid)).toBeTruthy();
  expect(field().value).toBe('');
  type(KEY);
  setWord = 'failed';
  fireEvent.click(screen.getByText('Save'));
  await flush();
  expect(screen.getByText(SHARE_KEY_ERRORS.failed)).toBeTruthy();
  expect(document.body.innerHTML).not.toContain(KEY);
});

it('Forget removes it; a key that could not be read says so and offers Change and Forget', async () => {
  status = { set: true, unreadable: false };
  await show();
  fireEvent.click(screen.getByText('Forget'));
  await flush();
  expect(calls).toEqual([{ command: 'forget' }]);
  expect(screen.getByText('Not set')).toBeTruthy();
  status = { set: false, unreadable: true };
  fireEvent.click(screen.getByText('Set up'));
  fireEvent.keyDown(field(), { key: 'Escape' });
  await flush();
});

it('an unreadable saved key is named, with Change and Forget', async () => {
  status = { set: false, unreadable: true };
  await show();
  expect(screen.getByText('The saved key could not be read. Type it again.')).toBeTruthy();
  expect(screen.getByText('Change')).toBeTruthy();
  expect(screen.getByText('Forget')).toBeTruthy();
});

it('every control has a hover tip, and the field tip says where the key is kept', async () => {
  await show();
  const tipOf = async (el: Element) => {
    fireEvent.mouseEnter(el);
    await flush(300);
    const t = document.querySelector('.hover-tip')?.textContent ?? '';
    fireEvent.mouseLeave(el);
    await flush(50);
    return t;
  };
  expect(await tipOf(screen.getByText('Set up'))).toContain('go-ae.org');
  fireEvent.click(screen.getByText('Set up'));
  expect(await tipOf(field())).toContain('Windows Credential Manager');
  type(KEY);
  expect(await tipOf(screen.getByText('Save'))).toContain('Saves the key on this PC');
  expect(await tipOf(screen.getByText('Cancel'))).toContain('without saving');
});

it('the commands are registered natively', () => {
  for (const c of ['wall2_captures_share', 'wall2_share_key_status', 'wall2_share_key_set', 'wall2_share_key_forget']) {
    expect(lib).toContain(c);
  }
});
