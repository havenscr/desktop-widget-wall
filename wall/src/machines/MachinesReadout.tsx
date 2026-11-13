import { BOX_LABEL, isHot, pct, type MetricKey } from './model';
import { useMachines } from './useMachines';

function Cell({ value, hot, label }: { value: number | null; hot: boolean; label: string }) {
  // No reading: an empty track and no number, so the columns stay aligned.
  if (value === null)
    return (
      <span className="mc-cell none" aria-label={`${label} no reading`}>
        <i className="mc-bar" aria-hidden="true" />
        <b className="mc-num" aria-hidden="true" />
      </span>
    );
  const n = pct(value);
  return (
    <span className={`mc-cell${hot ? ' hot' : ''}`} aria-label={`${label} ${n} percent`}>
      <i className="mc-bar" aria-hidden="true">
        <i style={{ width: `${n}%` }} />
      </i>
      <b className="mc-num">{n}</b>
    </span>
  );
}

/**
 * The temperature column: the number with a degree sign, or a quiet dash when there is no
 * reading, so the column never jumps. `label` is the accessible name's subject.
 */
function Temp({ value, hot, label }: { value: number | null; hot: boolean; label: string }) {
  if (value === null)
    return (
      <b className="mc-num mc-temp none" aria-label={`${label} no reading`}>
        {'\u2013'}
      </b>
    );
  const n = Math.round(value);
  return (
    <b className={`mc-num mc-temp${hot ? ' hot' : ''}`} aria-label={`${label} ${n} degrees`}>
      {n}°
    </b>
  );
}

/**
 * The owner's vote A, "whisper bars": a header row (CPU, GPU, RAM) and two thin rows,
 * PC and the second machine (BOX_LABEL), each with a TEMP column, at the bottom of the Work left wing. Grey by
 * default; a number turns amber only after it stays over its limit for 30 seconds. The
 * second machine's row is dimmed when its numbers are stale; with no box numbers at all it stays,
 * dimmed, and says "no reading", so the owner can tell it exists (it fills in when the
 * helper answers). Nothing shows when the PC numbers cannot be read.
 */
export function MachinesReadout() {
  const { data, over, now } = useMachines();
  if (!data) return null;
  const hot = (key: MetricKey) => isHot(over, key, now);
  const b = data.box;
  return (
    <div className="mc" role="group" aria-label="Machines">
      <div className="mc-row mc-hd" aria-hidden="true">
        <span />
        <span>CPU</span>
        <span>GPU</span>
        <span>RAM</span>
        <span>TEMP</span>
      </div>
      <div className="mc-row" data-machine="pc">
        <span className="mc-name">PC</span>
        <Cell label="PC CPU" value={data.pc.cpuPct} hot={hot('pc.cpu')} />
        <Cell label="PC GPU" value={data.pc.gpuPct} hot={hot('pc.gpu')} />
        <Cell label="PC RAM" value={data.pc.ramPct} hot={hot('pc.ram')} />
        <Temp label="PC graphics card" value={data.pc.tempC ?? null} hot={hot('pc.temp')} />
      </div>
      {!b && (
        <div className="mc-row none" data-machine="box" aria-label={`${BOX_LABEL} no reading`}>
          <span className="mc-name">{BOX_LABEL}</span>
          <span className="mc-none">no reading</span>
        </div>
      )}
      {b && (
        <div className={`mc-row${data.boxStale ? ' stale' : ''}`} data-machine="box">
          <span className="mc-name">{BOX_LABEL}</span>
          <Cell label={`${BOX_LABEL} CPU`} value={b.cpuPct} hot={hot('box.cpu')} />
          <Cell label={`${BOX_LABEL} GPU`} value={b.gpuPct} hot={hot('box.gpu')} />
          <Cell label={`${BOX_LABEL} RAM`} value={b.ramPct} hot={hot('box.ram')} />
          <Temp label={BOX_LABEL} value={b.tempC} hot={hot('box.temp')} />
        </div>
      )}
    </div>
  );
}
