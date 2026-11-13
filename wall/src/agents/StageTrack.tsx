import { tip } from '../ui/HoverTip';
import { STAGE_NAMES, STAGES, type Stage } from './model';

/** The stage colours with their names, for the track's hover card. */
export function StageLegend() {
  return (
    <span className="stage-legend">
      <span className="tip-t">Stages</span>
      {STAGES.map((s) => (
        <span key={s} className="stage-key">
          <i style={{ background: `var(--st-${s})` }} aria-hidden="true" />
          {STAGE_NAMES[s]}
        </span>
      ))}
      <span className="tip-k">Amber means it waits on you.</span>
    </span>
  );
}

/**
 * Plan, Build, Review, PR, Live (concept `.jr`), each in its own colour (cool to warm):
 * stages before the current one are done (their colour, dimmed), the current one glows in
 * its colour, or amber while the session waits for an answer. Hover shows the legend.
 */
export function StageTrack({ stage, mark }: { stage: Stage; mark: '' | 'ready' | 'wait' }) {
  const cur = STAGES.indexOf(stage);
  return (
    <div className="jr" role="img" aria-label={`Stage: ${STAGE_NAMES[stage]}`} {...tip(<StageLegend />)}>
      {STAGES.map((s, i) => (
        <span key={s} className="jr-step" style={{ ['--sc' as string]: `var(--st-${s})` }}>
          {i > 0 && <i className={`jc${i <= cur ? ' d' : ''}`} aria-hidden="true" />}
          <span className={`jn${i < cur ? ' d' : i === cur ? ` c${mark ? ` ${mark}` : ''}` : ''}`} aria-hidden="true">
            <i />
            <em>{STAGE_NAMES[s]}</em>
          </span>
        </span>
      ))}
    </div>
  );
}
