import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mocks } from '../bridge/tauri';
import { MachinesReadout } from './MachinesReadout';
import { HOLD_MS, isHot, nextOverSince, readings, type Machines } from './model';

const flush = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};
const setHidden = (hidden: boolean) => {
  Object.defineProperty(document, 'hidden', { configurable: true, value: hidden });
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
};

const calm: Machines = {
  pc: { cpuPct: 34, gpuPct: 71, ramPct: 58 },
  box: { cpuPct: 61, gpuPct: null, ramPct: 48, tempC: 52 },
  boxStale: false,
};

let answer: Machines = calm;
let calls = 0;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 10, 11, 10, 24, 0));
  answer = calm;
  calls = 0;
  mocks.set('wall2_machines', () => {
    calls++;
    return answer;
  });
});
afterEach(() => {
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  vi.useRealTimers();
  mocks.clear();
});

const hotCells = (c: HTMLElement) => [...c.querySelectorAll('.hot')].map((e) => e.getAttribute('aria-label'));

it('shows grey PC and BOX rows with the box temperature', async () => {
  const r = render(<MachinesReadout />);
  await flush();
  expect(r.container.querySelector('[data-machine="pc"]')!.textContent).toBe('PC347158');
  expect(r.container.querySelector('[data-machine="box"]')!.textContent).toBe('BOX614852°');
  expect(hotCells(r.container)).toEqual([]);
});

it('turns RAM amber only after it stays over 90 for 30 seconds', async () => {
  answer = { ...calm, pc: { ...calm.pc, ramPct: 93 } };
  const r = render(<MachinesReadout />);
  await flush();
  await flush(28_000);
  expect(hotCells(r.container)).toEqual([]);
  await flush(2_000);
  expect(hotCells(r.container)).toEqual(['PC RAM 93 percent']);
});

it('starts the 30 seconds again after a dip, so a spike never flickers amber', async () => {
  answer = { ...calm, pc: { ...calm.pc, cpuPct: 99 } };
  const r = render(<MachinesReadout />);
  await flush();
  await flush(20_000);
  answer = calm;
  await flush(2_000);
  answer = { ...calm, pc: { ...calm.pc, cpuPct: 99 } };
  // Over again from the read at 24 s: still grey at 50 s, amber at 54 s (30 s over).
  await flush(28_000);
  expect(hotCells(r.container)).toEqual([]);
  await flush(4_000);
  expect(hotCells(r.container)).toEqual(['PC CPU 99 percent']);
  answer = calm;
  await flush(2_000);
  expect(hotCells(r.container)).toEqual([]);
});

it('marks the box temperature over 90 degrees and GPU over 95, each on its own', async () => {
  answer = { ...calm, pc: { ...calm.pc, gpuPct: 96 }, box: { ...calm.box!, tempC: 91 } };
  const r = render(<MachinesReadout />);
  await flush();
  await flush(HOLD_MS);
  expect(hotCells(r.container)).toEqual(['PC GPU 96 percent', 'Box 91 degrees']);
});

it('does not count a number at its limit as over', () => {
  const at = { ...calm, pc: { cpuPct: 95, gpuPct: 95, ramPct: 90 } };
  const over = nextOverSince({}, readings(at), 0);
  expect(over).toEqual({});
  const past = nextOverSince({}, readings({ ...at, pc: { ...at.pc, ramPct: 90.5 } }), 0);
  expect(isHot(past, 'pc.ram', HOLD_MS - 1)).toBe(false);
  expect(isHot(past, 'pc.ram', HOLD_MS)).toBe(true);
});

it('keeps the BOX row, dimmed with "no reading", when the box has no numbers, and fills it in when they come', async () => {
  answer = { ...calm, box: null };
  const r = render(<MachinesReadout />);
  await flush();
  const row = () => r.container.querySelector('[data-machine="box"]')!;
  expect(row().textContent).toBe('BOXno reading');
  expect(row().className).toContain('none');
  expect(row().getAttribute('aria-label')).toBe('Box no reading');
  answer = calm;
  await flush(2_000);
  expect(row().textContent).toBe('BOX614852°');
  expect(row().className).not.toContain('none');
  answer = { ...calm, boxStale: true };
  await flush(2_000);
  expect(row().className).toContain('stale');
});

it('shows nothing when the numbers cannot be read', async () => {
  mocks.set('wall2_machines', () => {
    throw new Error('failed');
  });
  const r = render(<MachinesReadout />);
  await flush();
  expect(r.container.innerHTML).toBe('');
});

it('reads every 2 seconds while visible, never while hidden, and stops on unmount', async () => {
  const r = render(<MachinesReadout />);
  await flush();
  expect(calls).toBe(1);
  await flush(6_000);
  expect(calls).toBe(4);
  setHidden(true);
  await flush(60_000);
  expect(calls).toBe(4);
  setHidden(false);
  await flush();
  expect(calls).toBe(5);
  r.unmount();
  await flush(10_000);
  expect(calls).toBe(5);
  expect(vi.getTimerCount()).toBe(0);
});

it('treats a read that hangs for 5 seconds as failed, then recovers on the next read', async () => {
  let hang = true;
  mocks.set('wall2_machines', () => {
    calls++;
    return hang ? new Promise<Machines>(() => undefined) : calm;
  });
  const r = render(<MachinesReadout />);
  await flush();
  expect(r.container.innerHTML).toBe('');
  // Ticks while the first read hangs are skipped: one read at a time.
  await flush(4_000);
  expect(calls).toBe(1);
  hang = false;
  await flush(1_000);
  // Timed out at 5 s: the busy flag is free, so the 6 s tick reads.
  await flush(1_000);
  expect(calls).toBe(2);
  expect(r.container.querySelector('[data-machine="pc"]')).not.toBeNull();
});

it('never stacks reads across hide and show, and ignores the answer of a superseded read', async () => {
  const pending: Array<(m: Machines) => void> = [];
  let active = 0;
  let maxActive = 0;
  mocks.set('wall2_machines', () => {
    calls++;
    active++;
    maxActive = Math.max(maxActive, active);
    return new Promise<Machines>((resolve) =>
      pending.push((m) => {
        active--;
        resolve(m);
      }),
    );
  });
  const r = render(<MachinesReadout />);
  await flush();
  pending.shift()!(calm);
  await flush();
  await flush(2_000); // a second read starts and stays pending
  expect(calls).toBe(2);
  setHidden(true);
  setHidden(false);
  await flush(2_000);
  // The read from before the hide still owns the flag, so nothing new started.
  expect(calls).toBe(2);
  pending.shift()!({ ...calm, pc: { ...calm.pc, cpuPct: 11 } });
  await flush();
  // Its answer belongs to the hidden period and is dropped.
  expect(r.container.querySelector('[data-machine="pc"]')!.textContent).toBe('PC347158');
  await flush(2_000);
  expect(calls).toBe(3);
  pending.shift()!({ ...calm, pc: { ...calm.pc, cpuPct: 22 } });
  await flush();
  expect(r.container.querySelector('[data-machine="pc"]')!.textContent).toBe('PC227158');
  expect(maxActive).toBe(1);
});

it('never turns stale box numbers amber, and starts their hold when they are fresh again', async () => {
  answer = { ...calm, box: { ...calm.box!, tempC: 95 }, boxStale: true };
  const r = render(<MachinesReadout />);
  await flush();
  await flush(40_000);
  expect(hotCells(r.container)).toEqual([]);
  answer = { ...calm, box: { ...calm.box!, tempC: 95 }, boxStale: false };
  // Fresh from the read at 42 s: grey at 70 s, amber at 72 s.
  await flush(30_000);
  expect(hotCells(r.container)).toEqual([]);
  await flush(2_000);
  expect(hotCells(r.container)).toEqual(['Box 95 degrees']);
});

it('draws an empty track with no number for a column with no reading', async () => {
  const r = render(<MachinesReadout />);
  await flush();
  const gpu = r.container.querySelector('[aria-label="Box GPU no reading"]')!;
  expect(gpu.className).toBe('mc-cell none');
  expect(gpu.querySelector('.mc-bar')).not.toBeNull();
  expect(gpu.textContent).toBe('');
});
