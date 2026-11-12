import type { ReactNode } from 'react';
import { invoke } from '../bridge/tauri';
import { FreeRow, Lane } from './Lane';
import { ageText, allFreeText, freeSlots, headerAsk, slotsText, type OmniSummary } from './model';
import { Shelf } from './Shelf';

/** Asks Rust to open the chat; Rust checks the id. A refusal changes nothing on the wall. */
function openSession(id: string): void {
  invoke('wall2_open_session', { id }).catch(() => undefined);
}

/**
 * The Work centre with the helper answering (concept `f_work`): the header ("Agents",
 * "3 of 3 slots", and "Nothing needs you" or "One thing for you"), up to three lanes, slim
 * "Free slot" rows for the rest, and the shelf. With fewer than three lanes the free rows
 * stay slim and the lanes take the room (with a third line for the PR). With no lane at
 * all, one slim "All three slots free" row and `idle` (the focus timer and weather) fill
 * the centre. A stale answer says "updated N min ago" and dims the lanes.
 */
export function Lanes({ summary, stale, freshAt, now, idle }: { summary: OmniSummary; stale: boolean; freshAt: number | null; now: number; idle: ReactNode }) {
  const ask = headerAsk(summary);
  const n = summary.lanes.length;
  const free = freeSlots(summary);
  return (
    <div className={`centre lanes${stale ? ' stale' : ''}`} data-lanes={n} aria-label="Agents">
      <div className="lanes-hd">
        <div className="row lanes-hd-l">
          <span className="k">Agents</span>
          <span className="xs">{slotsText(summary)}</span>
          {stale && <span className="xs lanes-age">{ageText(freshAt, now)}</span>}
        </div>
        <div className={`row calm t-${ask.tone}`}>
          <i className="dot" aria-hidden="true" />
          <span>{ask.text}</span>
          {ask.more && <span className="xs">{ask.more}</span>}
        </div>
      </div>
      {summary.lanes.map((l) => (
        <Lane key={l.id} lane={l} canOpen={summary.linksAvailable} open={openSession} roomy={n < 3} />
      ))}
      {n === 0 ? (
        <>
          <FreeRow text={allFreeText(summary)} />
          <div className="lanes-idle">{idle}</div>
        </>
      ) : (
        Array.from({ length: free }, (_, i) => <FreeRow key={i} text="Free slot" />)
      )}
      <Shelf summary={summary} />
    </div>
  );
}
