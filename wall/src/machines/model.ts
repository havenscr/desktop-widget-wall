/** The `wall2_machines` answer (Rust `Machines`). Percentages are 0 to 100. */
export interface PcStats {
  cpuPct: number;
  gpuPct: number;
  ramPct: number;
}
export interface BoxStats {
  cpuPct: number;
  gpuPct: number | null;
  ramPct: number;
  tempC: number | null;
}
export interface Machines {
  pc: PcStats;
  box: BoxStats | null;
  boxStale: boolean;
}

export const POLL_MS = 2000;
/** A number turns amber only after it has stayed over its limit this long. */
export const HOLD_MS = 30_000;

/** Every number the readout can mark, one key each. */
export type MetricKey = 'pc.cpu' | 'pc.gpu' | 'pc.ram' | 'box.cpu' | 'box.gpu' | 'box.ram' | 'box.temp';

/** Over these, a number is hot (owner vote A): RAM over 90, CPU or GPU over 95, box over 90 degrees. */
export const LIMITS: Record<MetricKey, number> = {
  'pc.cpu': 95,
  'pc.gpu': 95,
  'pc.ram': 90,
  'box.cpu': 95,
  'box.gpu': 95,
  'box.ram': 90,
  'box.temp': 90,
};

/** The readout's numbers by key; a missing number is null. */
export function readings(m: Machines): Record<MetricKey, number | null> {
  const b = m.box;
  return {
    'pc.cpu': m.pc.cpuPct,
    'pc.gpu': m.pc.gpuPct,
    'pc.ram': m.pc.ramPct,
    'box.cpu': b ? b.cpuPct : null,
    'box.gpu': b ? b.gpuPct : null,
    'box.ram': b ? b.ramPct : null,
    'box.temp': b ? b.tempC : null,
  };
}

/** When each number went over its limit and has stayed there since; absent while under. */
export type OverSince = Partial<Record<MetricKey, number>>;

/**
 * The next over-since table after a reading at `now`. A number over its limit keeps the
 * time it first went over; one at or under its limit, or missing, drops out at once.
 */
export function nextOverSince(prev: OverSince, values: Record<MetricKey, number | null>, now: number): OverSince {
  const out: OverSince = {};
  for (const key of Object.keys(LIMITS) as MetricKey[]) {
    const v = values[key];
    if (v !== null && Number.isFinite(v) && v > LIMITS[key]) out[key] = prev[key] ?? now;
  }
  return out;
}

/** True once the number has been over its limit for the whole hold. */
export function isHot(over: OverSince, key: MetricKey, now: number): boolean {
  const since = over[key];
  return since !== undefined && now - since >= HOLD_MS;
}

/** A whole number for the readout, 0 to 100. */
export function pct(n: number): number {
  return Math.round(Math.min(100, Math.max(0, Number.isFinite(n) ? n : 0)));
}
