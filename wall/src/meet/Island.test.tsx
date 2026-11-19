import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BRIEF_EMPTY } from '../bridge/devMocks/meetBrief';
import { Island } from './Island';

let live = false;
let brief: unknown;
vi.mock('../onair/useOnAirLiveReport', () => ({ useOnAirLive: () => live }));
vi.mock('./useBrief', () => ({ useBrief: () => brief }));

const draw = () => render(<Island details={null} checklist={{ state: 'missing', items: [], reason: null }} reloadSoon={() => {}} meetingId="m1" briefKey="k" />);

beforeEach(() => {
  live = false;
  brief = { out: BRIEF_EMPTY, err: null, gaveUp: false, retry: () => {} };
});

describe('Island brief lines', () => {
  it('empty mode names the contact until On Air is live, then only the on air line', () => {
    const { unmount } = draw();
    expect(screen.getByText(/No history yet with Northwind Outfitters/)).toBeTruthy();
    unmount();
    live = true;
    draw();
    expect(screen.queryByText(/Northwind/)).toBeNull();
    expect(screen.getByText(/Hidden while on air/)).toBeTruthy();
  });
});
