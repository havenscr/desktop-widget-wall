import { isHot, pct, type MetricKey } from './model';
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
 * The owner's vote A, "whisper bars": a header row (CPU, GPU, RAM) and two thin rows,
 * PC and BOX (with the box temperature), at the bottom of the Work left wing. Grey by
 * default; a number turns amber only after it stays over its limit for 30 seconds. The
 * BOX row is hidden when the box has no numbers and dimmed when they are stale. Nothing
 * shows when the PC numbers cannot be read.
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
        <span />
      </div>
      <div className="mc-row" data-machine="pc">
        <span className="mc-name">PC</span>
        <Cell label="PC CPU" value={data.pc.cpuPct} hot={hot('pc.cpu')} />
        <Cell label="PC GPU" value={data.pc.gpuPct} hot={hot('pc.gpu')} />
        <Cell label="PC RAM" value={data.pc.ramPct} hot={hot('pc.ram')} />
        <span />
      </div>
      {b && (
        <div className={`mc-row${data.boxStale ? ' stale' : ''}`} data-machine="box">
          <span className="mc-name">BOX</span>
          <Cell label="Box CPU" value={b.cpuPct} hot={hot('box.cpu')} />
          <Cell label="Box GPU" value={b.gpuPct} hot={hot('box.gpu')} />
          <Cell label="Box RAM" value={b.ramPct} hot={hot('box.ram')} />
          {b.tempC === null ? (
            <span />
          ) : (
            <b className={`mc-num mc-temp${hot('box.temp') ? ' hot' : ''}`} aria-label={`Box ${Math.round(b.tempC)} degrees`}>
              {Math.round(b.tempC)}°
            </b>
          )}
        </div>
      )}
    </div>
  );
}
