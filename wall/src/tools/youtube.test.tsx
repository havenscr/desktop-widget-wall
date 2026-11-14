import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mocks } from '../bridge/tauri';
import type { YoutubeStatus } from '../music/youtube';
import { usePlaceStore } from '../state/places';
import { HoverTipLayer, resetTip } from '../ui/HoverTip';
import { Accounts } from './accounts';
import { ToolsDrawer } from './ToolsDrawer';
import { anySignInWaiting, resetTools, useToolsStore } from './store';

const flush = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

// Values built at run time, so no secret-shaped literal sits in the source.
const ID = `${'1'.repeat(12)}-${'a'.repeat(32)}.apps.googleusercontent.com`;
const SECRET = `GOCSPX-${'x'.repeat(28)}`;

const status = (over: Partial<YoutubeStatus> = {}): YoutubeStatus => ({ setup: true, signedIn: false, reason: null, searchesLeft: null, ...over });
const FIRST_RUN = status({ setup: false, reason: 'not set up' });

beforeEach(() => {
  resetTools();
  resetTip();
  vi.useFakeTimers();
  usePlaceStore.setState({ active: 'work' });
  mocks.set('wall2_meet_next', () => ({ accounts: [], meetings: [] }));
  mocks.set('wall2_meet_open_status', () => 'desktop');
  mocks.set('wall2_spotify_status', () => ({ setup: false, signedIn: false }));
  try {
    localStorage.clear();
    sessionStorage.clear();
  } catch {
    // Browser storage can be unavailable; the checks below then read nothing.
  }
});
afterEach(() => {
  vi.useRealTimers();
  mocks.clear();
});

const show = async (answer: YoutubeStatus | (() => YoutubeStatus)) => {
  mocks.set('wall2_youtube_status', typeof answer === 'function' ? answer : () => answer);
  const view = render(
    <>
      <Accounts />
      <HoverTipLayer />
    </>,
  );
  await flush();
  return view;
};
const row = () => screen.getByText('YouTube').closest('li')!;
const buttons = () => [...row().querySelectorAll('button')].map((b) => b.getAttribute('aria-label') ?? b.textContent);
const hoverText = async (el: Element): Promise<string> => {
  fireEvent.mouseEnter(el);
  await flush(300);
  return document.querySelector('.hover-tip')?.textContent ?? '';
};
/** True when neither value is in any element's text, any attribute, or any input's value. */
const nowhere = (...values: string[]): boolean => {
  for (const el of [document.documentElement, ...document.querySelectorAll('*')]) {
    const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent ?? '').join('');
    const attrs = [...el.attributes].map((a) => a.value).join('\n');
    const typed = el instanceof HTMLInputElement ? el.value : '';
    if (values.some((v) => own.includes(v) || attrs.includes(v) || typed.includes(v))) return false;
  }
  return true;
};
const storedText = (): string => {
  try {
    return JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage });
  } catch {
    return '';
  }
};

it.each<[string, YoutubeStatus, string, string[]]>([
  ['not set up', FIRST_RUN, 'Not set up', ['Set up']],
  ['signed out', status(), 'Signed out', ['Change setup', 'Sign in']],
  ['the saved sign-in died', status({ reason: 'sign in again' }), 'Sign in again', ['Change setup', 'Sign in']],
  ['signed in', status({ signedIn: true }), 'Signed in', ['Sign out']],
  ['refused client while signed in', status({ signedIn: true, reason: 'setup broken' }), 'Setup broken', ['Sign out']],
  ['refused client while signed out', status({ reason: 'setup broken' }), 'Setup broken', ['Set up']],
  ['the stored sign-in cannot be read', status({ reason: 'failed' }), 'Could not read the saved sign-in', ['Retry']],
  ['the client cannot be read', status({ setup: false, reason: 'failed' }), 'Could not check', ['Retry']],
  ['signed in but the saved setup is gone', status({ setup: false, signedIn: true, reason: 'setup missing' }), 'Signed in, setup missing', ['Sign out']],
  ['the saved setup cannot be read, signed in', status({ signedIn: true, reason: 'setup unreadable' }), 'Setup broken', ['Sign out']],
  ['the saved setup cannot be read, signed out', status({ reason: 'setup unreadable' }), 'Setup broken', ['Set up']],
  ['a sign-in waits that this page did not start', status({ reason: 'signing in' }), 'Waiting for the browser', ['Cancel']],
])('the YouTube row, %s, reads %s with its buttons', async (_name, answer, line, names) => {
  await show(answer);
  expect(row().textContent).toContain(line);
  expect(buttons()).toEqual(names);
});

it('the YouTube row says Checking first and Could not check when the status fails', async () => {
  let release: (s: YoutubeStatus) => void = () => undefined;
  const view = await show(() => new Promise<YoutubeStatus>((done) => { release = done; }) as unknown as YoutubeStatus);
  expect(row().textContent).toContain('Checking');
  view.unmount();
  mocks.set('wall2_youtube_status', () => {
    throw new Error('failed');
  });
  render(<Accounts />);
  await flush();
  expect(row().textContent).toContain('Could not check');
  expect(buttons()).toEqual(['Retry']);
  release(FIRST_RUN);
});

it('a refused client is said in words in the Accounts note, and in amber on the row itself', async () => {
  await show(status({ signedIn: true, reason: 'setup broken' }));
  expect(screen.getByText('Google refused this setup. Sign out, then set it up again.')).toBeTruthy();
  expect(row().querySelector('.tools-line.bad')?.textContent).toBe('Setup broken');
});

it('Change setup is hidden while signed in and opens the form while signed out', async () => {
  const view = await show(status({ signedIn: true }));
  expect(screen.queryByRole('button', { name: 'Change setup' })).toBeNull();
  view.unmount();
  await show(status());
  fireEvent.click(screen.getByRole('button', { name: 'Change setup' }));
  expect(screen.getByLabelText('Client ID')).toBeTruthy();
  // The form takes the row's buttons' place: nothing to press twice.
  expect(buttons()).toEqual([]);
});

it('the Set up form has exactly the planned fields, attributes and hint, and no form element', async () => {
  await show(FIRST_RUN);
  fireEvent.click(screen.getByRole('button', { name: 'Set up' }));
  const id = screen.getByLabelText('Client ID') as HTMLInputElement;
  const secret = screen.getByLabelText('Client secret') as HTMLInputElement;
  expect(id.type).toBe('text');
  expect(secret.type).toBe('password');
  for (const input of [id, secret]) {
    expect(input.getAttribute('autocomplete')).toBe('off');
    expect(input.getAttribute('spellcheck')).toBe('false');
    expect(input.getAttribute('autocorrect')).toBe('off');
    expect(input.getAttribute('autocapitalize')).toBe('off');
    expect(input.getAttribute('name')).toBeNull();
    expect(input.closest('form')).toBeNull();
  }
  expect(document.querySelector('form')).toBeNull();
  expect(screen.getByText("From your own Google Cloud project. Kept in Windows' credential store, never in a file.")).toBeTruthy();
  expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
});

it('Save sends both values once, empties the form and leaves nothing in the page or in storage', async () => {
  const save = vi.fn();
  mocks.set('wall2_youtube_set_client', save);
  let answer = FIRST_RUN;
  await show(() => answer);
  fireEvent.click(screen.getByRole('button', { name: 'Set up' }));
  fireEvent.change(screen.getByLabelText('Client ID'), { target: { value: ID } });
  fireEvent.change(screen.getByLabelText('Client secret'), { target: { value: SECRET } });
  answer = status();
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await flush();
  expect(save).toHaveBeenCalledTimes(1);
  expect(save).toHaveBeenCalledWith({ clientId: ID, clientSecret: SECRET });
  // The form is gone, so no input holds either value; nothing else in the page, an attribute or storage does.
  expect(screen.queryByLabelText('Client ID')).toBeNull();
  expect(screen.queryByLabelText('Client secret')).toBeNull();
  expect(document.querySelectorAll('input')).toHaveLength(0);
  expect(nowhere(ID, SECRET)).toBe(true);
  expect(storedText()).not.toContain('apps.googleusercontent');
  expect(storedText()).not.toContain('GOCSPX');
  expect(row().textContent).toContain('Signed out');
  expect(buttons()).toEqual(['Change setup', 'Sign in']);
});

it('a refused Save names the problem, empties both fields and keeps the values out of the page', async () => {
  mocks.set('wall2_youtube_set_client', () => {
    throw new Error('invalid');
  });
  await show(FIRST_RUN);
  fireEvent.click(screen.getByRole('button', { name: 'Set up' }));
  fireEvent.change(screen.getByLabelText('Client ID'), { target: { value: ID } });
  fireEvent.change(screen.getByLabelText('Client secret'), { target: { value: SECRET } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await flush();
  expect(screen.getByRole('alert').textContent).toBe('That is not a Desktop app client. Check both values.');
  expect((screen.getByLabelText('Client ID') as HTMLInputElement).value).toBe('');
  expect((screen.getByLabelText('Client secret') as HTMLInputElement).value).toBe('');
  // Every input is present and empty, and no element, attribute or storage key holds either value.
  expect([...document.querySelectorAll('input')].map((i) => i.value)).toEqual(['', '']);
  expect(nowhere(ID, SECRET)).toBe(true);
  expect(storedText()).not.toContain('GOCSPX');
});

it.each([
  ['sign out first', 'Sign out of YouTube first.'],
  ['failed', 'Could not save the setup.'],
])('a Save refused with "%s" says "%s"', async (word, line) => {
  mocks.set('wall2_youtube_set_client', () => {
    throw new Error(word);
  });
  await show(FIRST_RUN);
  fireEvent.click(screen.getByRole('button', { name: 'Set up' }));
  fireEvent.change(screen.getByLabelText('Client ID'), { target: { value: ID } });
  fireEvent.change(screen.getByLabelText('Client secret'), { target: { value: SECRET } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await flush();
  expect(screen.getByRole('alert').textContent).toBe(line);
});

it('Cancel closes the form without sending anything, and unmounting in the middle of a Save is harmless', async () => {
  const save = vi.fn(() => new Promise<void>(() => undefined));
  mocks.set('wall2_youtube_set_client', save);
  const view = await show(FIRST_RUN);
  fireEvent.click(screen.getByRole('button', { name: 'Set up' }));
  fireEvent.change(screen.getByLabelText('Client ID'), { target: { value: ID } });
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByLabelText('Client ID')).toBeNull();
  expect(save).not.toHaveBeenCalled();
  expect(buttons()).toEqual(['Set up']);
  fireEvent.click(screen.getByRole('button', { name: 'Set up' }));
  fireEvent.change(screen.getByLabelText('Client ID'), { target: { value: ID } });
  fireEvent.change(screen.getByLabelText('Client secret'), { target: { value: SECRET } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(save).toHaveBeenCalledTimes(1);
  view.unmount();
  await flush();
});

it('a waiting sign-in shows Cancel, which cancels it, holds the drawer and is cancelled again on leaving', async () => {
  const cancel = vi.fn();
  mocks.set('wall2_youtube_sign_in', () => new Promise<void>(() => undefined));
  mocks.set('wall2_youtube_cancel_sign_in', cancel);
  const view = await show(status());
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  await flush();
  expect(row().textContent).toContain('Waiting for the browser');
  expect(buttons()).toEqual(['Cancel']);
  expect(useToolsStore.getState().waiting.youtube).toBe(true);
  expect(anySignInWaiting()).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(cancel).toHaveBeenCalledTimes(1);
  view.unmount();
  await flush();
  expect(cancel).toHaveBeenCalledTimes(2);
  expect(useToolsStore.getState().waiting.youtube).toBe(false);
});

it('a finished sign-in reads the status again and shows Signed in with Sign out', async () => {
  let signedIn = false;
  mocks.set('wall2_youtube_sign_in', () => {
    signedIn = true;
  });
  await show(() => status({ signedIn }));
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  await flush();
  expect(row().textContent).toContain('Signed in');
  expect(buttons()).toEqual(['Sign out']);
});

it.each([
  ['denied', 'YouTube sign-in was refused'],
  ['timed-out', 'YouTube sign-in timed out'],
  ['busy', 'Google is busy, try again in a minute'],
  ['down', 'Could not reach Google'],
  ['failed', 'YouTube sign-in did not finish'],
])('a sign-in that ends with "%s" says "%s" at the foot of Accounts', async (word, line) => {
  mocks.set('wall2_youtube_sign_in', () => {
    throw new Error(word);
  });
  await show(status());
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  await flush();
  expect(document.querySelector('.tools-note')?.textContent).toBe(line);
  expect(row().textContent).toContain('Signed out');
});

it('a cancelled sign-in says nothing, and a refused client says why instead of "did not finish"', async () => {
  let answer = status();
  mocks.set('wall2_youtube_sign_in', () => {
    throw new Error('cancelled');
  });
  await show(() => answer);
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  await flush();
  expect(document.querySelector('.tools-note')).toBeNull();
  mocks.set('wall2_youtube_sign_in', () => {
    answer = status({ reason: 'setup broken' });
    throw new Error('setup broken');
  });
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  await flush();
  // The note is the refused-client sentence, not a vague "did not finish".
  expect(document.querySelector('.tools-note')?.textContent).toBe('Google refused this setup. Set it up again.');
  expect(row().textContent).toContain('Setup broken');
});

it('Sign out calls the bridge and reads again', async () => {
  let signedIn = true;
  const out = vi.fn(() => {
    signedIn = false;
  });
  mocks.set('wall2_youtube_sign_out', out);
  await show(() => status({ signedIn }));
  fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
  await flush();
  expect(out).toHaveBeenCalledTimes(1);
  expect(row().textContent).toContain('Signed out');
});

it('a failing Sign out says so', async () => {
  mocks.set('wall2_youtube_sign_out', () => {
    throw new Error('failed');
  });
  await show(status({ signedIn: true }));
  fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
  await flush();
  expect(document.querySelector('.tools-note')?.textContent).toBe('Could not sign out of YouTube');
});

it('the two links call the bridge with the kind word only', async () => {
  const opened = vi.fn();
  mocks.set('wall2_open_link', opened);
  await show(FIRST_RUN);
  expect(screen.getByText('Uses YouTube API Services:')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'YouTube Terms' }));
  fireEvent.click(screen.getByRole('button', { name: 'Google Privacy Policy' }));
  expect(opened.mock.calls).toEqual([[{ kind: 'youtube-terms' }], [{ kind: 'google-privacy' }]]);
  expect(document.querySelector('.tools-yt-links a')).toBeNull();
  expect(document.querySelector('.tools-yt-links [href]')).toBeNull();
});

it('a link that cannot open says so', async () => {
  mocks.set('wall2_open_link', () => {
    throw new Error('no');
  });
  await show(FIRST_RUN);
  fireEvent.click(screen.getByRole('button', { name: 'YouTube Terms' }));
  await flush();
  expect(document.querySelector('.tools-note')?.textContent).toBe('Could not open the link');
});

it('every new control has a hover tip', async () => {
  await show(status());
  const expected: [Element, string][] = [
    [screen.getByRole('button', { name: 'Change setup' }), 'Replace the client id and secret. Works only while signed out.'],
    [screen.getByRole('button', { name: 'Sign in' }), "Opens Google's sign-in in your browser."],
    [screen.getByRole('button', { name: 'YouTube Terms' }), "Opens YouTube's Terms of Service in your browser."],
    [screen.getByRole('button', { name: 'Google Privacy Policy' }), "Opens Google's Privacy Policy in your browser."],
  ];
  for (const [el, text] of expected) {
    resetTip();
    expect(await hoverText(el)).toBe(text);
  }
  fireEvent.click(screen.getByRole('button', { name: 'Change setup' }));
  const form: [Element, string][] = [
    [screen.getByLabelText('Client ID'), 'The Client ID of your Google Cloud Desktop app client. It ends in .apps.googleusercontent.com.'],
    [screen.getByLabelText('Client secret'), 'The client secret of the same client. It shows as dots and is never shown again.'],
    [screen.getByRole('button', { name: 'Cancel' }), 'Closes the form without saving.'],
  ];
  for (const [el, text] of form) {
    resetTip();
    expect(await hoverText(el)).toBe(text);
  }
});

it('the YouTube row is a plain account row, built from the same parts as the Spotify row beside it', async () => {
  mocks.set('wall2_spotify_status', () => ({ setup: true, signedIn: true }));
  await show(status());
  const parts = (li: Element) => [...li.children].map((c) => c.className.split(' ')[0]);
  const spotifyRow = screen.getByText('Spotify').closest('li')!;
  expect(row().className).toBe(spotifyRow.className);
  expect(parts(row()).slice(0, 3)).toEqual(parts(spotifyRow).slice(0, 3));
  expect(row().querySelector('.tools-ico svg')).not.toBeNull();
});

it('Set up stays hidden while the form is open in the refused-client, signed-out state', async () => {
  await show(status({ reason: 'setup broken' }));
  expect(buttons()).toEqual(['Set up']);
  fireEvent.click(screen.getByRole('button', { name: 'Set up' }));
  expect(buttons()).toEqual([]);
  expect(screen.getByLabelText('Client ID')).toBeTruthy();
});

it('a saved setup that cannot be read says so in the note, with the sign-out step only while signed in', async () => {
  const view = await show(status({ reason: 'setup unreadable' }));
  expect(document.querySelector('.tools-note')?.textContent).toBe('The saved setup could not be read. Set it up again.');
  view.unmount();
  await show(status({ signedIn: true, reason: 'setup unreadable' }));
  expect(document.querySelector('.tools-note')?.textContent).toBe('The saved setup could not be read. Sign out, then set it up again.');
});

it('signed in with the setup gone offers Sign out, with the reason on hover', async () => {
  const out = vi.fn();
  mocks.set('wall2_youtube_sign_out', out);
  await show(status({ setup: false, signedIn: true, reason: 'setup missing' }));
  expect(await hoverText(row())).toBe('The saved setup is gone. Sign out, then set it up again.');
  fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
  await flush();
  expect(out).toHaveBeenCalledTimes(1);
});

it('after a reload in the middle of a sign-in the row waits again, follows it, and Cancel ends it', async () => {
  const cancel = vi.fn(() => {
    answer = status();
  });
  let answer = status({ reason: 'signing in' });
  const read = vi.fn(() => answer);
  mocks.set('wall2_youtube_cancel_sign_in', cancel);
  const view = await show(read);
  expect(row().textContent).toContain('Waiting for the browser');
  expect(buttons()).toEqual(['Cancel']);
  expect(useToolsStore.getState().waiting.youtube).toBe(true);
  // The row keeps asking while Rust says a sign-in waits.
  const before = read.mock.calls.length;
  await flush(3100);
  expect(read.mock.calls.length).toBeGreaterThanOrEqual(before + 2);
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(cancel).toHaveBeenCalledTimes(1);
  await flush(1600);
  expect(row().textContent).toContain('Signed out');
  expect(buttons()).toEqual(['Change setup', 'Sign in']);
  // No more asking once it ended.
  const after = read.mock.calls.length;
  await flush(5000);
  expect(read.mock.calls.length).toBe(after);
  view.unmount();
});

it('Escape in the form closes only the form, clears it and returns focus; a second Escape closes the drawer', async () => {
  mocks.set('wall2_youtube_status', () => status());
  render(<ToolsDrawer />);
  act(() => useToolsStore.getState().openDrawer());
  await flush();
  const opener = screen.getByRole('button', { name: 'Change setup' });
  fireEvent.click(opener);
  const id = screen.getByLabelText('Client ID') as HTMLInputElement;
  fireEvent.change(id, { target: { value: ID } });
  id.focus();
  fireEvent.keyDown(id, { key: 'Escape' });
  await flush();
  expect(screen.queryByLabelText('Client ID')).toBeNull();
  expect(screen.getByLabelText('Tools')).toBeTruthy();
  expect(useToolsStore.getState().open).toBe(true);
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Change setup' }));
  expect(nowhere(ID)).toBe(true);
  // Reopened, the form is empty.
  fireEvent.click(screen.getByRole('button', { name: 'Change setup' }));
  expect((screen.getByLabelText('Client ID') as HTMLInputElement).value).toBe('');
  // Escape from a button in the form works the same way.
  fireEvent.keyDown(screen.getByRole('button', { name: 'Cancel' }), { key: 'Escape' });
  await flush();
  expect(screen.queryByLabelText('Client ID')).toBeNull();
  expect(useToolsStore.getState().open).toBe(true);
  fireEvent.keyDown(document.body, { key: 'Escape' });
  await flush();
  expect(useToolsStore.getState().open).toBe(false);
});

it('Forget this setup is offered only while signed out with a setup, removes it, and the row goes back to Not set up', async () => {
  const forget = vi.fn(() => {
    answer = FIRST_RUN;
  });
  let answer = status();
  mocks.set('wall2_youtube_forget_client', forget);
  const view = await show(() => answer);
  fireEvent.click(screen.getByRole('button', { name: 'Change setup' }));
  const button = screen.getByRole('button', { name: 'Forget this setup' });
  expect(await hoverText(button)).toBe('Removes the saved Client ID and secret from this PC. The YouTube row goes back to Not set up.');
  fireEvent.click(button);
  await flush();
  expect(forget).toHaveBeenCalledTimes(1);
  expect(screen.queryByLabelText('Client ID')).toBeNull();
  expect(row().textContent).toContain('Not set up');
  expect(buttons()).toEqual(['Set up']);
  // Not offered on a first-run form, nor while signed in (there is no form then).
  fireEvent.click(screen.getByRole('button', { name: 'Set up' }));
  expect(screen.queryByRole('button', { name: 'Forget this setup' })).toBeNull();
  view.unmount();
  await show(status({ signedIn: true }));
  expect(screen.queryByRole('button', { name: 'Change setup' })).toBeNull();
});

it('a refused Forget says why and keeps the form', async () => {
  mocks.set('wall2_youtube_forget_client', () => {
    throw new Error('sign out first');
  });
  await show(status());
  fireEvent.click(screen.getByRole('button', { name: 'Change setup' }));
  fireEvent.click(screen.getByRole('button', { name: 'Forget this setup' }));
  await flush();
  expect(screen.getByRole('alert').textContent).toBe('Sign out of YouTube first.');
  expect(screen.getByLabelText('Client ID')).toBeTruthy();
});

it('a sign-in refused because a token is stored says to sign out first', async () => {
  mocks.set('wall2_youtube_sign_in', () => {
    throw new Error('sign out first');
  });
  await show(status());
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  await flush();
  expect(document.querySelector('.tools-note')?.textContent).toBe('Sign out of YouTube first.');
});
