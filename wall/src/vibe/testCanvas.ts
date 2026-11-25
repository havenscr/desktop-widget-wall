import { vi } from 'vitest';

/** A recording 2d context: every call is kept as [name, ...args]; gradients and the rest answer harmlessly. */
export interface Rec {
  calls: unknown[][];
  ctx: CanvasRenderingContext2D;
}

export function recorder(): Rec {
  const calls: unknown[][] = [];
  const grad = { addColorStop: () => undefined };
  const ctx = new Proxy({} as Record<string, unknown>, {
    get(t, k: string) {
      if (k in t) return t[k];
      if (k === 'createLinearGradient' || k === 'createRadialGradient') return (...a: unknown[]) => (calls.push([k, ...a]), grad);
      return (...a: unknown[]) => void calls.push([k, ...a]);
    },
    set(t, k: string, v) {
      t[k] = v;
      calls.push([`set ${k}`, v]);
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { calls, ctx };
}

/** Make every canvas in jsdom hand out one recording context; returns it and a restore function. */
export function stubCanvas(): { rec: Rec; restore: () => void } {
  const rec = recorder();
  const spy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => rec.ctx as never);
  return { rec, restore: () => spy.mockRestore() };
}
