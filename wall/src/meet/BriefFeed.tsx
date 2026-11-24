import { IconAddressBook, IconBrandTeams, IconChevronLeft, IconFile, IconFileText, IconFolder, IconMail } from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import { openBriefItem, type BriefOut } from '../bridge/meetBrief';
import { tip } from '../ui/HoverTip';
import { AskBox } from './AskBox';
import { AskPanel } from './AskPanel';
import { useBriefAsk } from './useBriefAsk';
import { NOT_CHECKED, ON_AIR_LINE, REFRESH_LINE, itemById, type BriefViewModel, type RowIcon } from './briefModel';

const ICONS: Record<RowIcon, typeof IconMail> = { mail: IconMail, chat: IconBrandTeams, file: IconFile, folder: IconFolder, crm: IconAddressBook, note: IconFileText };

/** The slim strip in the island's header: who, company, deal. Plain text, no tips (nothing from the brief goes in an attribute). */
function Strip({ view, onAir }: { view: BriefViewModel; onAir: boolean }) {
  if (onAir) return <span className="meet-brief-strip ellipsis">{ON_AIR_LINE}</span>;
  const parts = [view.strip.who, view.strip.company, view.strip.deal, view.strip.company ? null : view.strip.label].filter((s): s is string => !!s);
  return <span className="meet-brief-strip ellipsis">{parts.length > 0 ? parts.join(' · ') : 'Meeting brief'}</span>;
}

function Detail({ out, id, onBack }: { out: BriefOut; id: string; onBack: () => void }) {
  const item = itemById(out, id);
  const [fail, setFail] = useState(false);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) onBack();
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [onBack]);
  if (!item) return null;
  const open = () => {
    if (!item.openKey) return;
    setFail(false);
    openBriefItem(item.openKey).catch(() => setFail(true));
  };
  const when = item.when ? new Date(item.when).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : null;
  return (
    <div className="meet-brief-detail">
      <div className="meet-brief-dhd">
        <button type="button" className="meet-btn" onClick={onBack} {...tip('Back to the list (Escape)')}>
          <IconChevronLeft size={20} aria-hidden="true" />
          Back
        </button>
        {item.openKey && (
          <button type="button" className="meet-btn cy" onClick={open} {...tip('Open it in its own app')}>
            Open
          </button>
        )}
        {fail && <span className="meet-notice meet-xs">Could not open it</span>}
      </div>
      <div className="meet-brief-dtitle">{item.title}</div>
      <div className="meet-xs meet-brief-dmeta ellipsis">{[when, item.who].filter((s): s is string => !!s).join(' · ')}</div>
      {item.unverifiedSender && <span className="meet-brief-tag">{NOT_CHECKED}</span>}
      {item.preview && <div className="meet-brief-preview">{item.preview}</div>}
      {item.actions.length > 0 && (
        <ul className="meet-brief-acts">
          {item.actions.map((a, i) => (
            <li key={`${a}-${i}`}>{a}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * The island when the brief has history (look C): one ranked feed under a slim who / company / deal strip. A row opens a
 * detail over the feed, Back or Escape returns. While On Air is live the rows are not drawn. The text lives in state only. The foot holds the ask field; an answer opens a panel over the rows.
 */
export function BriefFeed({ out, view, onAir, retry, briefKey = null }: { out: BriefOut; view: BriefViewModel; onAir: boolean; retry?: () => void; briefKey?: string | null }) {
  const ask = useBriefAsk(briefKey, out.state === 'ready', onAir);
  const [detail, setDetail] = useState<string | null>(null);
  useEffect(() => {
    if (onAir) setDetail(null);
  }, [onAir]);
  const shown = detail !== null && !onAir && itemById(out, detail) ? detail : null;
  return (
    <section className="panel meet-island" aria-label="Meeting brief">
      <div className="meet-isl-hd">
        <span className="meet-isl-ico">
          <IconAddressBook size={22} stroke={1.8} aria-hidden="true" />
        </span>
        <Strip view={view} onAir={onAir} />
      </div>
      <div className="meet-isl-body meet-brief-body">
        {onAir ? null : ask.view ? (
          <AskPanel view={ask.view} onBack={ask.back} onClear={ask.clear} />
        ) : shown ? (
          <Detail out={out} id={shown} onBack={() => setDetail(null)} />
        ) : (
          <div className="meet-brief-list">
            {view.rows.map((r) => {
              const I = ICONS[r.icon];
              return (
                <button key={r.id} type="button" className="meet-brief-row" onClick={() => setDetail(r.id)}>
                  <I size={22} stroke={1.8} aria-hidden="true" />
                  <span className="meet-brief-title ellipsis">{r.title}</span>
                  <span className="meet-brief-sub ellipsis">{r.sub}</span>
                  <span className="meet-brief-when">{r.when}</span>
                </button>
              );
            })}
            {view.more > 0 && <div className="meet-xxs meet-dimline meet-brief-more">+ {view.more} more items</div>}
          </div>
        )}
      </div>
      <div className="meet-isl-foot">
        {view.stale && !onAir && (
          <>
            <span className="meet-brief-note meet-xs meet-dimline ellipsis">{REFRESH_LINE}</span>
            {retry && (
              <button type="button" className="meet-btn meet-retry" onClick={retry} {...tip('Read the brief again now')}>
                Retry
              </button>
            )}
          </>
        )}
        <AskBox ask={ask} />
      </div>
    </section>
  );
}
