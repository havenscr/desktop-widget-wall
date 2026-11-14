import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mocks } from '../bridge/tauri';
import type { YoutubeStatus } from '../music/youtube';
import { usePlaceStore } from '../state/places';
import { HoverTipLayer, resetTip } from '../ui/HoverTip';
import { Accounts } from './accounts';
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
  expect(screen.queryByLabelText('Client ID')).toBeNull();
  expect(screen.queryByLabelText('Client secret')).toBeNull();
  expect(document.body.innerHTML).not.toContain(ID);
  expect(document.body.innerHTML).not.toContain(SECRET);
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
  expect(document.body.innerHTML).not.toContain(ID);
  expect(document.body.innerHTML).not.toContain(SECRET);
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
