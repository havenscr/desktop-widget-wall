import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BRIEF_CLIENT, BRIEF_MANY } from '../bridge/devMocks/meetBrief';
import { mocks } from '../bridge/tauri';
import { BriefFeed } from './BriefFeed';
import { briefView } from './briefModel';

const flush = () => act(async () => {});
const draw = (out = BRIEF_CLIENT, onAir = false) => render(<BriefFeed out={out} view={briefView(out, null)} onAir={onAir} />);

afterEach(() => {
  mocks.clear();
  window.localStorage.clear();
});

describe('BriefFeed', () => {
  it('draws the strip, the rows, the dimmed ask box and no more line for three items', () => {
    draw();
    expect(screen.getByText('Priya Calder · Northwind Outfitters · Annual renewal · Proposal sent')).toBeTruthy();
    expect(screen.getByText('Re: renewal terms for next year')).toBeTruthy();
    expect(screen.queryByText(/more items/)).toBeNull();
    const ask = screen.getByText('Ask about this meeting (coming later)').closest('.meet-brief-ask') as HTMLElement;
    expect(ask.getAttribute('aria-disabled')).toBe('true');
    expect(ask.querySelector('button, input, [tabindex]')).toBeNull();
  });

  it('seven rows and "+ 3 more items" for ten', () => {
    const { container } = draw(BRIEF_MANY);
    expect(container.querySelectorAll('.meet-brief-row')).toHaveLength(7);
    expect(screen.getByText('+ 3 more items')).toBeTruthy();
  });

  it('a row opens its detail; Back and Escape return to the list', () => {
    draw();
    fireEvent.click(screen.getByText('Re: renewal terms for next year'));
    expect(screen.getByText(/Happy to go ahead/)).toBeTruthy();
    expect(screen.getByText('Send the revised quote')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByText('Quarterly check-in')).toBeTruthy();
    fireEvent.click(screen.getByText('Quarterly check-in'));
    expect(screen.queryByText('Re: renewal terms for next year')).toBeNull();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByText('Re: renewal terms for next year')).toBeTruthy();
  });

  it('Open appears only with an openKey and calls the open command; a failure says so', async () => {
    const open = vi.fn(() => {
      throw 'failed';
    });
    mocks.set('wall2_meet_brief_open', open);
    draw();
    fireEvent.click(screen.getByText('Quarterly check-in'));
    expect(screen.queryByRole('button', { name: 'Open' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    fireEvent.click(screen.getByText('Re: renewal terms for next year'));
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    await flush();
    expect(open).toHaveBeenCalledWith({ openKey: 'b1-0' });
    expect(screen.getByText('Could not open it')).toBeTruthy();
  });

  it('shows the quiet tag for an unchecked sender in the detail only', () => {
    const { container } = draw(BRIEF_MANY);
    expect(screen.queryByText('Sender not checked')).toBeNull();
    fireEvent.click(screen.getByText('Item 3: notes from the renewal talks'));
    expect(screen.getByText('Sender not checked')).toBeTruthy();
    expect(container.querySelector('.meet-brief-tag')).toBeTruthy();
  });

  it('while on air the rows are replaced by one line and an open detail closes', () => {
    const out = BRIEF_CLIENT;
    const { rerender } = draw();
    fireEvent.click(screen.getByText('Re: renewal terms for next year'));
    rerender(<BriefFeed out={out} view={briefView(out, null)} onAir={true} />);
    expect(screen.getByText('Hidden while on air')).toBeTruthy();
    expect(screen.queryByText(/Priya Calder|Northwind|Annual renewal|Proposal sent/)).toBeNull();
    expect(screen.queryByText('Re: renewal terms for next year')).toBeNull();
    expect(screen.queryByText(/Happy to go ahead/)).toBeNull();
    rerender(<BriefFeed out={out} view={briefView(out, null)} onAir={false} />);
    expect(screen.getByText('Quarterly check-in')).toBeTruthy();
  });

  it('a stale feed keeps its rows with a quiet line and Retry', () => {
    const retry = vi.fn();
    render(<BriefFeed out={BRIEF_CLIENT} view={briefView(BRIEF_CLIENT, 'failed')} onAir={false} retry={retry} />);
    expect(screen.getByText('Re: renewal terms for next year')).toBeTruthy();
    expect(screen.getByText('Could not refresh')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalled();
  });

  it('puts no brief text in any attribute or storage', () => {
    const { container } = draw();
    fireEvent.click(screen.getByText('Re: renewal terms for next year'));
    const secrets = ['renewal terms', 'Happy to go ahead', 'Priya Calder', 'Northwind', 'revised quote'];
    for (const el of Array.from(container.querySelectorAll('*'))) {
      for (const at of Array.from(el.attributes)) for (const s of secrets) expect(at.value).not.toContain(s);
    }
    for (const s of secrets) {
      expect(JSON.stringify(window.localStorage)).not.toContain(s);
      expect(JSON.stringify(window.sessionStorage)).not.toContain(s);
    }
  });
});
