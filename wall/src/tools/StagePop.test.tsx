import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { mocks } from '../bridge/tauri';
import { SP_OFF, type SpStatus } from '../onair/v2/stagepopModel';
import { useStagePop } from '../onair/v2/stagepopStore';
import { resetTip } from '../ui/HoverTip';
import { StagePopTools } from './StagePop';

const CODE = 'one-time-pairing-code-xyz';
const status = (over: Partial<SpStatus> = {}): SpStatus => ({ ...SP_OFF, state: 'connected', placement: { left: 2560, top: 80, source: 'elgato' }, token: 'ready', ...over });
let calls: { cmd: string; args: unknown }[];
let current: SpStatus;

beforeEach(() => {
  calls = [];
  current = status();
  mocks.set('wall2_stagepop_status', () => current);
  mocks.set('wall2_stagepop_token', (args) => {
    calls.push({ cmd: 'token', args });
    if (args?.action === 'show' && current.token === 'hidden') throw 'hidden';
    current = { ...current, token: 'hidden' };
    return CODE;
  });
  mocks.set('wall2_stagepop_placement_set', (args) => void calls.push({ cmd: 'place', args }));
  useStagePop.setState({ status: current, failed: false });
});
afterEach(() => {
  cleanup();
  resetTip();
  for (const k of ['wall2_stagepop_status', 'wall2_stagepop_token', 'wall2_stagepop_placement_set']) mocks.delete(k);
});

it('Show code shows the code once in a read-only field, and Hide removes it', async () => {
  render(<StagePopTools />);
  expect(screen.queryByLabelText('Pairing code')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Show code' }));
  const field = (await screen.findByLabelText('Pairing code')) as HTMLInputElement;
  expect(field.value).toBe(CODE);
  expect(field.readOnly).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Hide' }));
  expect(screen.queryByLabelText('Pairing code')).toBeNull();
  expect(document.body.textContent).not.toContain(CODE);
  // The code was shown once: Show code is now off.
  await waitFor(() => expect((screen.getByRole('button', { name: 'Show code' }) as HTMLButtonElement).disabled).toBe(true));
});

it('New code asks twice before it makes one', async () => {
  render(<StagePopTools />);
  fireEvent.click(screen.getByRole('button', { name: 'New code' }));
  expect(calls).toEqual([]);
  fireEvent.click(screen.getByRole('button', { name: 'New code? Click again' }));
  await waitFor(() => expect(calls).toEqual([{ cmd: 'token', args: { action: 'new' } }]));
  expect(((await screen.findByLabelText('Pairing code')) as HTMLInputElement).value).toBe(CODE);
});

it('the placement fields start from the place in use and Save sends whole numbers', async () => {
  render(<StagePopTools />);
  const left = (await screen.findByLabelText('Left in pixels')) as HTMLInputElement;
  const top = screen.getByLabelText('Top in pixels') as HTMLInputElement;
  await waitFor(() => expect(left.value).toBe('2560'));
  expect(top.value).toBe('80');
  fireEvent.change(left, { target: { value: '-1024' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(calls).toEqual([{ cmd: 'place', args: { left: -1024, top: 80 } }]));
  fireEvent.change(top, { target: { value: 'abc' } });
  expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
});

it('the state word follows the add-on, and the source of the place is named', async () => {
  current = status({ state: 'waiting', placement: { left: null, top: null, source: 'none' } });
  useStagePop.setState({ status: current });
  render(<StagePopTools />);
  expect(screen.getByRole('status').textContent).toBe('Not connected');
  expect(screen.getByText('No Elgato monitor found')).toBeTruthy();
  // Let the first status read land before the answer changes.
  await act(async () => void (await new Promise((r) => setTimeout(r, 30))));
  current = status({ window: { open: true, fullscreen: false } });
  act(() => useStagePop.setState({ status: current }));
  await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Open'));
  expect(screen.getByText('Elgato monitor')).toBeTruthy();
});
