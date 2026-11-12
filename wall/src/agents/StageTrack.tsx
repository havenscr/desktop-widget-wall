import { STAGE_NAMES, STAGES, type Stage } from './model';

/**
 * Plan, Build, Review, PR, Live (concept `.jr`): stages before the current one are done
 * (dim cyan), the current one glows cyan, mint when the lane is ready to merge or live,
 * amber while it waits for an answer.
 */
export function StageTrack({ stage, mark }: { stage: Stage; mark: '' | 'ready' | 'wait' }) {
  const cur = STAGES.indexOf(stage);
  return (
    <div className="jr" role="img" aria-label={`Stage: ${STAGE_NAMES[stage]}`}>
      {STAGES.map((s, i) => (
        <span key={s} className="jr-step">
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
