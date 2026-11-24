import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AskBox } from './AskBox';
import type { BriefAsk } from './useBriefAsk';

const base = (over: Partial<BriefAsk> = {}): BriefAsk => ({ gate: { enabled: true, reason: null }, health: { state: 'ready', name: 'Sonnet' }, view: null, hasTurns: false, send: vi.fn(() => true), back: vi.fn(), clear: vi.fn(), ...over });

afterEach(() => window.localStorage.clear());

describe('AskBox', () => {
  it('focus sends nothing; Enter sends and empties the field; Escape clears and leaves', () => {
    const ask = base();
    render(<AskBox ask={ask} />);
    const input = screen.getByLabelText('Ask about this meeting') as HTMLInputElement;
    input.focus();
    expect(ask.send).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: 'What is open?' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(ask.send).toHaveBeenCalledWith('What is open?');
    expect(input.value).toBe('');
    fireEvent.change(input, { target: { value: 'draft' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(input.value).toBe('');
    expect(document.activeElement).not.toBe(input);
    expect(ask.send).toHaveBeenCalledTimes(1);
  });

  it('a field that refused the send keeps its text', () => {
    const ask = base({ send: vi.fn(() => false) });
    render(<AskBox ask={ask} />);
    const input = screen.getByLabelText('Ask about this meeting') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'wait' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(input.value).toBe('wait');
  });

  it('holds 300 characters, shows the follow-up prompt and the status word', () => {
    render(<AskBox ask={base({ hasTurns: true })} />);
    const input = screen.getByLabelText('Ask about this meeting') as HTMLInputElement;
    expect(input.maxLength).toBe(300);
    expect(input.placeholder).toBe('Ask a follow up');
    expect(screen.getByText('Sonnet ready')).toBeTruthy();
  });

  it('a disabled field shows its reason and sends nothing', () => {
    const ask = base({ gate: { enabled: false, reason: 'Hidden on air' }, health: { state: 'off', name: 'Claude' } });
    render(<AskBox ask={ask} />);
    const input = screen.getByLabelText('Ask about this meeting') as HTMLInputElement;
    expect(input.disabled).toBe(true);
    expect(input.placeholder).toBe('Hidden on air');
    expect(screen.getByText('Ask off')).toBeTruthy();
    act(() => void fireEvent.keyDown(input, { key: 'Enter' }));
    expect(ask.send).not.toHaveBeenCalled();
  });

  it('draws no status word before health is known', () => {
    const { container } = render(<AskBox ask={base({ health: null })} />);
    expect(container.querySelector('.meet-ask-status')).toBeNull();
  });
});
