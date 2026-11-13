/** The `wall2_machines` answer (Rust `Machines`). Percentages are 0 to 100. */
export interface PcStats {
  cpuPct: number;
  gpuPct: number;
  ramPct: number;
  /** The graphics card's temperature (NVML), or null with no NVIDIA card or a failed read. */
  tempC: number | null;
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

/** The second machine's name on the wall: the visible row label and every accessible name. */
export const BOX_LABEL = 'LLM';

export const POLL_MS = 2000;
/** A read that takes longer than this counts as failed, as in the music store. */
export const CALL_TIMEOUT_MS = 5000;
/** A number turns amber only after it has stayed over its limit this long. */
export const HOLD_MS = 30_000;

/** Every number the readout can mark, one key each. */
export type MetricKey = 'pc.cpu' | 'pc.gpu' | 'pc.ram' | 'pc.temp' | 'box.cpu' | 'box.gpu' | 'box.ram' | 'box.temp';

/** Over these, a number is hot (owner vote A): RAM over 90, CPU or GPU over 95, either temperature over 90 degrees. */
export const LIMITS: Record<MetricKey, number> = {
  'pc.cpu': 95,
  'pc.gpu': 95,
  'pc.ram': 90,
  'pc.temp': 90,
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
    'pc.temp': m.pc.tempC ?? null,
    'box.cpu': b ? b.cpuPct : null,
    'box.gpu': b ? b.gpuPct : null,
    'box.ram': b ? b.ramPct : null,
    'box.temp': b ? b.tempC : null,
  };
}

/**
 * The numbers the amber hold counts: as `readings`, but the box's are null while they are
 * stale, so old box numbers never turn amber.
 */
export function holdReadings(m: Machines): Record<MetricKey, number | null> {
  const r = readings(m);
  if (m.boxStale) {
    r['box.cpu'] = null;
    r['box.gpu'] = null;
    r['box.ram'] = null;
    r['box.temp'] = null;
  }
  return r;
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
