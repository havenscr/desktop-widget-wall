import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mocks } from '../bridge/tauri';
import { BriefConnect, BriefConnected, BriefSetup, KEY_FAILED, KEY_INVALID, KEY_TIP } from './BriefKey';

const flush = () => act(async () => {});
afterEach(() => mocks.clear());

describe('BriefConnect', () => {
  it('shows the off line with Connect and the helper text on hover', () => {
    render(<BriefConnect />);
    expect(screen.getByText('Meeting brief not connected ·')).toBeTruthy();
    const b = screen.getByRole('button', { name: 'Connect' });
    expect(b).toBeTruthy();
    expect(KEY_TIP).toContain('Windows Credential Manager');
  });

  it('saves the key, closes the field and leaves the value nowhere in the DOM', async () => {
    const set = vi.fn(() => undefined);
    mocks.set('wall2_meet_brief_token_set', set);
    const changed = vi.fn();
    const { container } = render(<BriefConnect onChanged={changed} />);
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    const input = screen.getByLabelText('Brief key') as HTMLInputElement;
    expect(input.type).toBe('password');
    fireEvent.change(input, { target: { value: 'secret-key-123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await flush();
    expect(set).toHaveBeenCalledWith({ value: 'secret-key-123' });
    expect(changed).toHaveBeenCalled();
    expect(screen.queryByLabelText('Brief key')).toBeNull();
    expect(container.innerHTML).not.toContain('secret-key-123');
    expect(document.body.innerHTML).not.toContain('secret-key-123');
  });

  it('says the fixed words for a bad key and for a failed save, and keeps the field open', async () => {
    mocks.set('wall2_meet_brief_token_set', () => {
      throw 'invalid';
    });
    render(<BriefConnect />);
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    fireEvent.change(screen.getByLabelText('Brief key'), { target: { value: 'x y' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await flush();
    expect(screen.getByRole('alert').textContent).toBe(KEY_INVALID);
    mocks.set('wall2_meet_brief_token_set', () => {
      throw 'failed';
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await flush();
    expect(screen.getByRole('alert').textContent).toBe(KEY_FAILED);
    expect(screen.getByLabelText('Brief key')).toBeTruthy();
  });

  it('Escape closes the field only and drops the typed text', () => {
    const outer = vi.fn();
    document.addEventListener('keydown', outer);
    render(<BriefConnect />);
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    const input = screen.getByLabelText('Brief key');
    fireEvent.change(input, { target: { value: 'abc' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    document.removeEventListener('keydown', outer);
    expect(screen.queryByLabelText('Brief key')).toBeNull();
    expect(outer).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    expect((screen.getByLabelText('Brief key') as HTMLInputElement).value).toBe('');
  });
});

describe('BriefConnected', () => {
  it('shows Connected and Forget when the key is set, and Forget clears it', async () => {
    const clear = vi.fn(() => undefined);
    mocks.set('wall2_meet_brief_token_status', () => ({ set: true, unreadable: false }));
    mocks.set('wall2_meet_brief_token_clear', clear);
    const changed = vi.fn();
    render(<BriefConnected onChanged={changed} />);
    await flush();
    expect(screen.getByText('Connected')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Forget' }));
    await flush();
    expect(clear).toHaveBeenCalled();
    expect(changed).toHaveBeenCalled();
    expect(screen.queryByText('Connected')).toBeNull();
  });

  it('draws nothing when no key is set', async () => {
    mocks.set('wall2_meet_brief_token_status', () => ({ set: false, unreadable: false }));
    const { container } = render(<BriefConnected />);
    await flush();
    expect(container.innerHTML).toBe('');
  });
});

describe('BriefSetup (under the empty hero)', () => {
  it('draws nothing until the status is read, then Connect when no key is saved', async () => {
    mocks.set('wall2_meet_brief_token_status', () => ({ set: false, unreadable: false }));
    const { container } = render(<BriefSetup />);
    expect(container.innerHTML).toBe('');
    await flush();
    expect(screen.getByRole('button', { name: 'Connect' })).toBeTruthy();
  });

  it('shows Connected with Forget once a key is saved', async () => {
    let saved = false;
    mocks.set('wall2_meet_brief_token_status', () => ({ set: saved, unreadable: false }));
    mocks.set('wall2_meet_brief_token_set', () => {
      saved = true;
    });
    render(<BriefSetup />);
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    fireEvent.change(screen.getByLabelText('Brief key'), { target: { value: 'k-123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await flush();
    await flush();
    expect(screen.getByText('Connected')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Forget' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Connect' })).toBeNull();
  });

  it('draws nothing when the status cannot be read', async () => {
    mocks.set('wall2_meet_brief_token_status', () => {
      throw 'failed';
    });
    const { container } = render(<BriefSetup />);
    await flush();
    expect(container.innerHTML).toBe('');
  });
});
