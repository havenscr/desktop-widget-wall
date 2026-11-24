import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AskPanel } from './AskPanel';

afterEach(() => window.localStorage.clear());

const HOSTILE = 'Use <b>bold</b> and [x](http://x.example) or https://evil.example/a and **stars** end.';

describe('AskPanel', () => {
  it('shows the question, the answer as literal text and the faint source line', () => {
    const { container } = render(<AskPanel view={{ q: 'What changed?', phase: 'done', a: HOSTILE, model: 'Sonnet' }} onBack={vi.fn()} onClear={vi.fn()} />);
    expect(screen.getByText('What changed?')).toBeTruthy();
    const a = container.querySelector('.meet-ask-a') as HTMLElement;
    expect(a.textContent).toBe(HOSTILE);
    expect(a.querySelector('*')).toBeNull();
    expect(container.querySelector('a, img, b, strong')).toBeNull();
    expect(screen.getByText('Claude · brief only · can be wrong')).toBeTruthy();
    for (const el of Array.from(container.querySelectorAll('*'))) {
      for (const attr of Array.from(el.attributes)) {
        expect(attr.value, `${el.tagName} ${attr.name}`).not.toContain('evil.example');
        expect(attr.value).not.toContain('bold');
        expect(attr.value).not.toContain('What changed');
      }
    }
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });

  it('while asking: the seconds line and Cancel, and no answer', () => {
    const onBack = vi.fn();
    render(<AskPanel view={{ q: 'Slow one', phase: 'asking', seconds: 12.4 }} onBack={onBack} onClear={vi.fn()} />);
    expect(screen.getByText('Asking · 12 s')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('an error is one short line', () => {
    render(<AskPanel view={{ q: 'x', phase: 'error', word: 'Busy, try again' }} onBack={vi.fn()} onClear={vi.fn()} />);
    expect(screen.getByText('Busy, try again')).toBeTruthy();
    expect(screen.queryByText('Claude · brief only · can be wrong')).toBeNull();
  });

  it('Back, Clear and Escape', () => {
    const onBack = vi.fn();
    const onClear = vi.fn();
    render(<AskPanel view={{ q: 'q', phase: 'done', a: 'a', model: 'Claude' }} onBack={onBack} onClear={onClear} />);
    fireEvent.click(screen.getByRole('button', { name: /Back/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onBack).toHaveBeenCalledTimes(2);
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});
