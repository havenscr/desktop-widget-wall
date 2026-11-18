import { useLayoutEffect } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mocks } from '../bridge/tauri';
import { PersonDetails } from './PersonDetails';

const ADDR = 'priya.calder@contoso.example';
type Deferred = { resolve: (v: unknown) => void; reject: (e: unknown) => void };

function defer(command: string): { calls: () => number; d: () => Deferred } {
  let n = 0;
  let last: Deferred | null = null;
  mocks.set(command, () => {
    n += 1;
    return new Promise((resolve, reject) => {
      last = { resolve, reject };
    });
  });
  return { calls: () => n, d: () => last! };
}
const flush = () => act(async () => {});

beforeEach(() => {
  mocks.set('wall2_meet_person_contact', () => ({ available: false }));
});
afterEach(() => {
  mocks.clear();
  window.localStorage.clear();
});

describe('address line', () => {
  it('asks once on mount, waits, then shows the address', async () => {
    const a = defer('wall2_meet_person_address');
    const { container } = render(<PersonDetails personKey="p1-0" onAirLive={false} />);
    expect(screen.getByText('Looking up the address')).toBeTruthy();
    expect(screen.queryByText(ADDR)).toBeNull();
    await act(async () => a.d().resolve({ address: ADDR }));
    expect(screen.getByText(ADDR)).toBeTruthy();
    expect(a.calls()).toBe(1);
    expect(container.innerHTML.split(ADDR).length - 1).toBe(1);
    // No attribute and no storage holds it.
    for (const el of Array.from(container.querySelectorAll('*'))) {
      for (const at of Array.from(el.attributes)) expect(at.value).not.toContain(ADDR);
    }
    expect(JSON.stringify(window.localStorage)).not.toContain(ADDR);
    expect(JSON.stringify(window.sessionStorage)).not.toContain(ADDR);
  });

  it('never asks while on air and says so', async () => {
    const a = defer('wall2_meet_person_address');
    render(<PersonDetails personKey="p1-0" onAirLive={true} />);
    await flush();
    expect(a.calls()).toBe(0);
    expect(screen.getByText('Address hidden while on air')).toBeTruthy();
  });

  it('drops a shown address at once when on air turns live', async () => {
    mocks.set('wall2_meet_person_address', () => ({ address: ADDR }));
    const { container, rerender } = render(<PersonDetails personKey="p1-0" onAirLive={false} />);
    await flush();
    expect(screen.getByText(ADDR)).toBeTruthy();
    rerender(<PersonDetails personKey="p1-0" onAirLive={true} />);
    expect(container.textContent).not.toContain(ADDR);
    expect(screen.getByText('Address hidden while on air')).toBeTruthy();
  });

  it('no committed frame shows the address once on air is live (checked before passive effects run)', async () => {
    mocks.set('wall2_meet_person_address', () => ({ address: ADDR }));
    // Layout effects run in the same commit as the DOM change, before any passive effect, so a value hidden only by an
    // effect would still be in the frame this probe records.
    const frames: { live: boolean; text: string }[] = [];
    function Probe({ live }: { live: boolean }) {
      useLayoutEffect(() => {
        frames.push({ live, text: document.body.textContent ?? '' });
      });
      return null;
    }
    const tree = (live: boolean) => (
      <>
        <PersonDetails personKey="p1-0" onAirLive={live} />
        <Probe live={live} />
      </>
    );
    const { rerender } = render(tree(false));
    await flush();
    expect(document.body.textContent).toContain(ADDR);
    rerender(tree(true));
    const live = frames.filter((f) => f.live);
    expect(live.length).toBeGreaterThan(0);
    for (const f of live) expect(f.text).not.toContain(ADDR);
    expect(live[0].text).toContain('Address hidden while on air');
  });

  it('drops a late answer when on air was live during the request, even if it ended', async () => {
    const a = defer('wall2_meet_person_address');
    const { container, rerender } = render(<PersonDetails personKey="p1-0" onAirLive={false} />);
    await flush();
    rerender(<PersonDetails personKey="p1-0" onAirLive={true} />);
    rerender(<PersonDetails personKey="p1-0" onAirLive={false} />);
    await act(async () => a.d().resolve({ address: ADDR }));
    expect(container.textContent).not.toContain(ADDR);
    expect(container.innerHTML).not.toContain(ADDR);
    expect(a.calls()).toBe(1);
  });

  it('drops an answer that arrives after on air went live', async () => {
    const a = defer('wall2_meet_person_address');
    const { container, rerender } = render(<PersonDetails personKey="p1-0" onAirLive={false} />);
    rerender(<PersonDetails personKey="p1-0" onAirLive={true} />);
    await act(async () => a.d().resolve({ address: ADDR }));
    expect(container.textContent).not.toContain(ADDR);
  });

  it.each([
    ['on-air', 'Address hidden while on air'],
    ['gone', 'This meeting changed; open the card again'],
    ['invalid', 'No address to show'],
    ['failed', 'No address to show'],
  ])('maps %s to its line', async (word, text) => {
    mocks.set('wall2_meet_person_address', () => {
      throw word;
    });
    render(<PersonDetails personKey="p1-0" onAirLive={false} />);
    await flush();
    expect(screen.getByText(text)).toBeTruthy();
  });

  it('drops a late answer after unmount and after the key changed', async () => {
    const a = defer('wall2_meet_person_address');
    const { container, rerender, unmount } = render(<PersonDetails personKey="p1-0" onAirLive={false} />);
    const first = a.d();
    rerender(<PersonDetails personKey="p1-1" onAirLive={false} />);
    await act(async () => first.resolve({ address: 'old.person@contoso.example' }));
    expect(container.textContent).not.toContain('old.person');
    const second = a.d();
    unmount();
    await act(async () => second.resolve({ address: ADDR }));
    expect(document.body.textContent).not.toContain(ADDR);
  });

  it('renders nothing for a null key and asks nothing', async () => {
    const a = defer('wall2_meet_person_address');
    const c = defer('wall2_meet_person_contact');
    const { container } = render(<PersonDetails personKey={null} onAirLive={false} />);
    await flush();
    expect(container.innerHTML).toBe('');
    expect(a.calls() + c.calls()).toBe(0);
  });
});

describe('contact key', () => {
  beforeEach(() => {
    mocks.set('wall2_meet_person_address', () => ({ address: ADDR }));
  });

  it('is hidden when not available, and when the lookup fails', async () => {
    render(<PersonDetails personKey="p1-0" onAirLive={false} />);
    await flush();
    expect(screen.queryByText('Open contact card')).toBeNull();
    mocks.set('wall2_meet_person_contact', () => {
      throw 'gone';
    });
    render(<PersonDetails personKey="p1-1" onAirLive={false} />);
    await flush();
    expect(screen.queryByText('Open contact card')).toBeNull();
  });

  it('shows when available and a click sends the contact action with the key', async () => {
    mocks.set('wall2_meet_person_contact', () => ({ available: true }));
    const action = vi.fn();
    mocks.set('wall2_meet_person_action', action);
    render(<PersonDetails personKey="p1-0" onAirLive={false} />);
    await flush();
    fireEvent.click(screen.getByText('Open contact card'));
    await flush();
    expect(action).toHaveBeenCalledWith({ key: 'p1-0', action: 'contact' });
    expect(screen.queryByText('Could not open the contact')).toBeNull();
  });

  it('shows one quiet line when the action is refused', async () => {
    mocks.set('wall2_meet_person_contact', () => ({ available: true }));
    mocks.set('wall2_meet_person_action', () => {
      throw 'unavailable';
    });
    render(<PersonDetails personKey="p1-0" onAirLive={false} />);
    await flush();
    fireEvent.click(screen.getByText('Open contact card'));
    await flush();
    expect(screen.getByText('Could not open the contact')).toBeTruthy();
  });
});
