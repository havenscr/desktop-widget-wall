import { IconBookmark, IconCheck, IconCircleDashed, IconClockPause, IconNotes, IconPlayerRecordFilled, IconPresentation, IconBroadcast } from '@tabler/icons-react';
import type { ReactNode } from 'react';
import { StudioBlock } from '../../studio/StudioBlock';
import { anyOn, summaryLine, viewOf, type Snapshot } from '../../studio/model';
import { canChange, useHome } from '../../studio/homeStore';
import type { Preset } from '../../studio/home';
import { useKeyLights } from '../../studio/store';
import { tip } from '../../ui/HoverTip';
import { useNextMeeting } from '../../work/useNextMeeting';
import { NotesCard } from '../NotesCard';
import { lengthLine, marksLine, whenLine, type LastOnAir } from '../lastOnAir';
import { clockText, elapsedMs, formatShowTime, startedLine } from '../model';
import { MODE_LABEL, type PageMode } from '../modes';
import { useOnAirStore } from '../store';
import { useYtLive } from '../ytliveStore';
import { Head } from './Tiles';

/** The notes of the first part are drawn large: one size, 26 px. */
const NOTES_SIZES = [26] as const;

/** The home app's preset names for each page (matched against the shown name, without case, spaces or punctuation). */
const PRESET_NAME: Record<PageMode, string> = { live: 'On air', rec: 'Recording', meet: 'Presenting' };

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** The preset the home app lists under this name, or undefined: the Get ready button is drawn only for one that exists. */
export function findPreset(presets: readonly Preset[] | undefined, mode: PageMode): Preset | undefined {
  const want = norm(PRESET_NAME[mode]);
  return presets?.find((p) => norm(p.label) === want);
}

/** The show timer with nothing on: its time (00:00 unless a stopped timer still holds one) and why it is not running. */
function IdleTimer({ now }: { now: number }) {
  const saved = useOnAirStore((s) => s.saved);
  const ms = elapsedMs(saved, now);
  const time = formatShowTime(ms);
  const nothing = !saved.running && ms === 0 && saved.firstStartAt === null;
  const sub = nothing ? 'Not started. It starts with a broadcast, a recording or a call.' : startedLine(saved, now);
  return (
    <div className="oa2-b oa2-timer oa2-idletimer" role="group" aria-label="Show timer">
      <Head label="Show timer" />
      <div className="oa-time-row">
        <span className="oa-time" data-running="false" role="timer" aria-label={`Show time ${time}`} {...tip('The timer is not running')}>
          {time}
        </span>
      </div>
      <div className="oa2-sub" {...tip(sub)}>
        {sub}
      </div>
    </div>
  );
}

/** The last time something was on air: how long, and how many marks, with Open marks.txt. */
function LastTime({ last, now }: { last: LastOnAir | null; now: number }) {
  const open = useOnAirStore((s) => s.open);
  return (
    <div className="oa2-b oa2-lastair" role="group" aria-label="Last time on air">
      <Head label="Last time on air" right={last ? whenLine(last.endedAt, now) : undefined} icon={<IconClockPause size={20} aria-hidden="true" />} />
      <div className="oa2-rows">
        {last ? (
          <>
            <div className="oa2-row" {...tip(`${MODE_LABEL[last.mode]} ended ${whenLine(last.endedAt, now)}`)}>
              <span className="oa2-row-t">
                <b>{lengthLine(last)}</b>
              </span>
            </div>
            <div className="oa2-row">
              <IconBookmark size={20} aria-hidden="true" />
              <span className="oa2-row-t">{marksLine(last.marks)}</span>
            </div>
          </>
        ) : (
          <div className="oa2-row">
            <span className="oa2-row-t">Nothing yet. It fills in when a show ends.</span>
          </div>
        )}
      </div>
      <button type="button" className="oa-btn sm oa2-open" onClick={() => void open('marks')} {...tip('Open marks.txt in the default editor: one line a mark, with the local time, the show time and the part')}>
        Open marks.txt
      </button>
    </div>
  );
}

/** One Get ready card: the page's name, what is next for it, what the button does, and the button when the home app has the preset. */
function ReadyCard({ mode, icon, next, onHold, className }: { mode: PageMode; icon: ReactNode; next: string; onHold: (m: PageMode) => void; className: string }) {
  const studio = useHome((s) => s.studio);
  const readWord = useHome((s) => s.readWord);
  const readDone = useHome((s) => s.readDone);
  const applying = useHome((s) => s.applying);
  const preset = findPreset(studio?.presets, mode);
  const may = canChange({ studio, readWord, readDone });
  const name = PRESET_NAME[mode];
  const label = MODE_LABEL[mode];
  return (
    <section className={`panel oa2-b oa2-ready ${className}`} aria-label={`Get ready for ${label}`}>
      <Head label={label === 'Live' ? 'Live on StreamYard' : label} icon={icon} />
      <div className="oa2-ready-next" {...tip(next)}>
        {next}
      </div>
      <div className="oa2-ready-does">{preset ? `Sets the lights to ${preset.label}.` : `Needs a home app preset named ${name}.`}</div>
      {preset && (
        <button
          type="button"
          className="oa-btn cy oa2-ready-go"
          aria-disabled={!may}
          aria-busy={applying === preset.id || undefined}
          onClick={
            may
              ? () => {
                  onHold(mode);
                  void useHome.getState().applyPreset(preset.id);
                }
              : undefined
          }
          {...tip(may ? `Set the lights to ${preset.label} and hold the ${label} page until you click Auto` : 'The home app is not answering, so the lights cannot be set from here')}
        >
          Get ready
        </button>
      )}
    </section>
  );
}

function Row({ ok, children, action }: { ok: boolean; children: ReactNode; action?: ReactNode }) {
  return (
    <div className={`oa2-row${ok ? ' ok' : ''}`}>
      {ok ? <IconCheck size={20} aria-hidden="true" /> : <IconCircleDashed size={20} aria-hidden="true" />}
      <span className="oa2-row-t">{children}</span>
      {action}
    </div>
  );
}

/** Key lights and the lights preset: the two checks the wall can answer. The prompter and Do not disturb rows are not drawn. */
function Checklist({ onHold }: { onHold: (m: PageMode) => void }) {
  const left = useKeyLights((s) => s.left);
  const right = useKeyLights((s) => s.right);
  const status = useKeyLights((s) => s.status);
  const snap: Snapshot = { status, left, right };
  const studio = useHome((s) => s.studio);
  const readWord = useHome((s) => s.readWord);
  const readDone = useHome((s) => s.readDone);
  const may = canChange({ studio, readWord, readDone });
  const keys = summaryLine(snap);
  const keysOk = viewOf(snap) === 'live' && anyOn(snap);
  const active = studio?.presets.find((p) => p.active) ?? null;
  const onair = findPreset(studio?.presets, 'live');
  const showBtn = !active && onair !== undefined;
  return (
    <div className="oa2-b oa2-checklist" role="group" aria-label="Checklist">
      <Head label="Checklist" />
      <div className="oa2-rows">
        <Row ok={keysOk}>
          <span {...tip(keys.text)}>{keys.text}</span>
        </Row>
        <Row
          ok={active !== null}
          action={
            showBtn ? (
              <button
                type="button"
                className="oa-btn sm"
                aria-disabled={!may}
                onClick={
                  may
                    ? () => {
                        onHold('live');
                        void useHome.getState().applyPreset(onair.id);
                      }
                    : undefined
                }
                {...tip(may ? `Set the lights to ${onair.label} and hold the Live page until you click Auto` : 'The home app is not answering, so the lights cannot be set from here')}
              >
                {onair.label}
              </button>
            ) : undefined
          }
        >
          {!studio ? 'Lights preset: not known' : `Lights preset: ${active ? active.label : 'none'}`}
        </Row>
      </div>
    </div>
  );
}

/**
 * The page for nothing on air: the show timer idle, the last time on air, three Get ready cards, the
 * first part's notes, the checklist and the studio lights. Boxes are the ones the planned picture draws.
 */
export function IdlePage({ now, last, onHold }: { now: number; last: LastOnAir | null; onHold: (m: PageMode) => void }) {
  const status = useYtLive((s) => s.status);
  const meeting = useNextMeeting().joinable;
  const show = useOnAirStore((s) => s.show);
  const first = show?.state === 'ok' ? show.parts[0] : undefined;
  const liveNext = status?.state === 'scheduled' && status.scheduledAt !== null ? `Next: ${clockText(status.scheduledAt)} on YouTube` : 'No broadcast scheduled on YouTube';
  const meetNext = meeting ? `Next: ${meeting.title}, ${clockText(Date.parse(meeting.start))}` : 'No meeting with a join link';
  return (
    <>
      <IdleTimer now={now} />
      <LastTime last={last} now={now} />
      <ReadyCard mode="live" icon={<IconBroadcast size={20} aria-hidden="true" />} next={liveNext} onHold={onHold} className="oa2-ready-1" />
      <ReadyCard mode="rec" icon={<IconPlayerRecordFilled size={20} aria-hidden="true" />} next="No recorder running" onHold={onHold} className="oa2-ready-2" />
      <ReadyCard mode="meet" icon={<IconPresentation size={20} aria-hidden="true" />} next={meetNext} onHold={onHold} className="oa2-ready-3" />
      <NotesCard title="Next show notes" right={first?.name} sizes={NOTES_SIZES} icon={<IconNotes size={20} aria-hidden="true" />} className="oa2-idlenotes" index={0} />
      <Checklist onHold={onHold} />
      <div className="oa2-b oa2-lights-idle">
        <StudioBlock />
      </div>
    </>
  );
}
