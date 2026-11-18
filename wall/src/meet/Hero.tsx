import type { KeyboardEvent, MouseEvent } from 'react';
import { IconBulb, IconCalendarEvent, IconMoodSmile, IconVideo } from '@tabler/icons-react';
import { invoke } from '../bridge/tauri';
import type { DayEvent } from '../ribbon/model';
import { formatClock } from '../clock/format';
import { useSignalStore } from '../signals/store';
import { tip } from '../ui/HoverTip';
import { troubleLine } from '../tools/trouble';
import { KeyIcon } from '../work/keyIcons';
import { useLibGroups } from '../work/keyLibrary';
import { keyboardOnMouseKey, useKeyPress } from '../work/keyPress';
import { allKeys, type LibGroup } from '../work/libraryModel';
import { useBrief } from '../work/useBrief';
import { LightsChip } from '../studio/LightsChip';
import { HeroChip, TroubleLine } from './parts';
import {
  BROWSER_KEYS,
  BROWSER_TIP,
  LONG_TITLE,
  MUTE_TIP,
  calledByLine,
  callKeys,
  callLater,
  callWord,
  BEFORE_LATER,
  LATER_TIP,
  matchDayEvent,
  peopleBlock,
  ringOf,
  statusLine,
  type CallKeySpec,
  type LaterKeySpec,
} from './heroModel';
import { People } from './PersonCard';
import { joinIsUrgent, mayBeOutOfDate, type Meeting } from './model';
import type { MeetState } from './useMeet';

/** The ring: 120 px (drawn on a 164 grid, stroke 6), the number inside and its unit under it. */
const RING_PX = 120;

function Ring({ value, unit, frac, tone }: { value: number; unit: string; frac: number; tone: string }) {
  const d = 164;
  const stroke = 6;
  const r = d / 2 - stroke;
  const c = 2 * Math.PI * r;
  return (
    <div className="meet-ring-dial" data-tone={tone}>
      <svg width={RING_PX} height={RING_PX} viewBox={`0 0 ${d} ${d}`} aria-hidden="true">
        <circle cx={d / 2} cy={d / 2} r={r} fill="none" stroke="rgba(255,255,255,0.13)" strokeWidth={stroke} />
        <circle cx={d / 2} cy={d / 2} r={r} fill="none" className="meet-ring-arc" strokeWidth={stroke} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - frac)} />
      </svg>
      <div className="meet-ring-in">
        <span className="meet-ring-n">{value}</span>
        <span className="meet-ring-u">{unit}</span>
      </div>
    </div>
  );
}

/**
 * Props for a key that cannot run: out of the tab order, no click or Enter or Space action, and still a plain
 * button (not `disabled`) so the hover tooltip keeps working.
 */
const inertKey = {
  tabIndex: -1,
  'aria-disabled': 'true' as const,
  onClick: (e: { preventDefault: () => void }) => e.preventDefault(),
  onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === 'Enter' || e.key === ' ') e.preventDefault();
  },
};

/** A call key from the key library, sent the way the key deck sends it. */
function CallKey({ spec, groups, camera, kind, press, onKeyDown }: {
  spec: CallKeySpec;
  groups: LibGroup[] | null;
  camera: boolean;
  kind: 'teams' | 'zoom';
  press: ReturnType<typeof useKeyPress>['press'];
  onKeyDown: ReturnType<typeof useKeyPress>['onKeyDown'];
}) {
  const hit = groups ? allKeys(groups).get(spec.id) : undefined;
  const ok = !!hit && hit.key.runnable && hit.key.kind !== 'soon';
  const tone = spec.role === 'leave' ? ' red' : spec.role === 'camera' && camera ? ' cy' : '';
  const text = !groups ? 'Reading the key library' : !ok ? `The key library has no runnable key "${spec.id}"` : spec.role === 'mute' ? MUTE_TIP(kind) : spec.role === 'camera' ? `Sends ${hit.key.how} to ${hit.group.title}. On or off follows the camera signal; the wall cannot change it any other way.` : `${hit.key.label} (${hit.group.title}). Sends ${hit.key.how}.`;
  const where = { name: hit?.group.title ?? 'the call', general: false };
  return (
    <button
      type="button"
      className={`meet-key${tone}${ok ? '' : ' off'}`}
      aria-label={spec.label}
      data-role={spec.role}
      {...(ok
        ? {
            onKeyDown: onKeyDown(hit.key.action),
            onClick: (e: MouseEvent<HTMLButtonElement>) => {
              if (keyboardOnMouseKey(hit.key.action, e.detail)) return;
              void press(`meet:${spec.id}`, e.detail, { command: 'wall2_keys_send_library', args: { id: spec.id } }, spec.label, hit.key.action, where, false);
            },
          }
        : inertKey)}
      {...tip(text)}
    >
      <KeyIcon name={ok ? hit.key.icon : 'keyboard'} size={26} />
      <span>{spec.label}</span>
    </button>
  );
}


/** A key of the deck that does nothing yet: dashed, dim, out of the tab order, and a click or Enter or Space does nothing. */
function LaterKey({ k }: { k: LaterKeySpec }) {
  return (
    <button type="button" className="meet-key later" aria-label={k.label} data-later="true" {...inertKey} {...tip(LATER_TIP)}>
      {k.icon === 'smile' ? <IconMoodSmile size={26} stroke={1.8} aria-hidden="true" /> : <KeyIcon name={k.icon} size={26} />}
      <span>{k.label}</span>
    </button>
  );
}

/** The keys under the title: Join and Open invite before a call, the four call keys during one. */
function Keys({ meeting, m, openKey, showBrief }: { meeting: Meeting | undefined; m: MeetState; openKey: string | undefined; showBrief: (t: string) => void }) {
  const call = useSignalStore((s) => s.call);
  const { groups } = useLibGroups();
  const { press, onKeyDown } = useKeyPress(showBrief, () => undefined);
  if (call) {
    const specs = callKeys(call.kind, call.camera);
    const later = callLater(call.kind).map((k) => <LaterKey key={k.label} k={k} />);
    if (!specs) {
      return (
        <div className="meet-keys" aria-label="Call keys">
          {BROWSER_KEYS.map((k) => (
            <button key={k.role} type="button" className="meet-key off dashed" aria-label={k.label} {...inertKey} {...tip(BROWSER_TIP)}>
              <KeyIcon name={{ mute: 'mic', camera: 'video', share: 'screen-share', leave: 'phone-off' }[k.role]} size={26} />
              <span>{k.label}</span>
            </button>
          ))}
          {later}
        </div>
      );
    }
    return (
      <div className="meet-keys" aria-label="Call keys">
        {specs.map((s) => (
          <CallKey key={s.id} spec={s} groups={groups} camera={call.camera} kind={call.kind as 'teams' | 'zoom'} press={press} onKeyDown={onKeyDown} />
        ))}
        {later}
      </div>
    );
  }
  if (!meeting) return null;
  const urgent = joinIsUrgent(meeting, m.now);
  const canOpen = openKey !== undefined;
  const later = BEFORE_LATER.map((k) => <LaterKey key={k.label} k={k} />);
  if (!meeting.canJoin && !canOpen) {
    return (
      <div className="meet-keys" aria-label="Meeting keys">
        <span className="meet-key off dashed wide" role="note" {...tip('The calendar gave this meeting no join link, and Outlook cannot open it from here')}>
          No join link on this meeting
        </span>
        {later}
      </div>
    );
  }
  // Positions 1 and 2 are Join and Open invite; one that does not apply leaves its place empty, so the rest stay put.
  return (
    <div className="meet-keys" aria-label="Meeting keys">
      {meeting.canJoin ? (
        <button
          type="button"
          className={urgent ? 'meet-key join urgent' : 'meet-key join'}
          aria-label={`Join: ${meeting.title}`}
          onClick={() => m.join(meeting.key)}
          {...tip(urgent ? 'Join this meeting now' : 'Join this meeting. It starts later.')}
        >
          <IconVideo size={26} stroke={1.8} aria-hidden="true" />
          <span>Join</span>
        </button>
      ) : (
        <span className="meet-key-gap" aria-hidden="true" />
      )}
      {canOpen ? (
        <button
          type="button"
          className="meet-key"
          aria-label="Open invite"
          onClick={() => void invoke('wall2_open_event', { key: openKey }).catch(() => undefined)}
          {...tip('Open this invite in Outlook')}
        >
          <IconCalendarEvent size={26} stroke={1.8} aria-hidden="true" />
          <span>Open invite</span>
        </button>
      ) : (
        <span className="meet-key-gap" aria-hidden="true" />
      )}
      {later}
    </div>
  );
}

/**
 * The hero: the meeting that is next or running, large at the left, with its ring, keys and people. With no
 * `meeting` it is a plain call (an ad hoc call, or the calendar cannot be read): the status, the time, the four
 * keys and nothing else, under "Call in progress".
 */
export function Hero({ m, meeting, label, events }: { m: MeetState; meeting: Meeting | undefined; label: string; events: readonly DayEvent[] }) {
  const call = useSignalStore((s) => s.call);
  const [brief, showBrief] = useBrief();
  const openKey = meeting ? matchDayEvent(meeting, events)?.key : undefined;
  const status = meeting ? statusLine(meeting, m.now, call) : { text: call ? `In call, ${callWord(call.kind)}` : 'Call', tone: 'call' as const };
  const ring = meeting ? ringOf(meeting, m.now, call !== null) : null;
  const clock = formatClock(new Date(m.now));
  const title = meeting?.title ?? 'Call in progress';
  const long = title.length > LONG_TITLE;
  const by = meeting ? calledByLine(meeting.details, label) : null;
  const people = meeting ? peopleBlock(meeting.details) : null;
  const trouble = troubleLine(m.data?.accounts ?? []);
  const outOfDate = meeting ? mayBeOutOfDate(m.data?.accounts ?? []) : false;
  const meetingId = meeting ? `${meeting.accountId}|${meeting.start}|${meeting.end}|${meeting.title}` : '';
  return (
    <div className="meet-hero deck" aria-label="Next meeting" data-tone={status.tone} data-plain={meeting ? undefined : 'true'}>
      <div className="meet-hero-st">
        <span className="meet-st" data-tone={status.tone}>
          <i aria-hidden="true" />
          {status.text}
        </span>
        <span className="meet-time" {...tip('The time now')}>
          {clock.time}
          <small>{clock.meridiem}</small>
        </span>
      </div>
      <div className="meet-hero-title" data-long={long ? 'true' : undefined} {...tip(title)}>
        {title}
      </div>
      <div className="meet-hero-left">
        <div className="meet-hero-below" data-trouble={trouble ? 'true' : undefined}>
          {by && (
            <div className="meet-by" {...tip(by)}>
              {by}
            </div>
          )}
          {trouble ? <TroubleLine text={trouble} /> : outOfDate && <div className="meet-stale">may be out of date</div>}
        </div>
        {ring && (
          <div className="meet-ring" {...tip(ring.unit.endsWith('to go') ? 'Time until this meeting starts. The ring fills for the last 30 minutes.' : ring.unit.endsWith('over') ? 'This meeting has ended and the call is still on. The number is the time over.' : 'Time left in this meeting. The ring is the share of the meeting still to go.')}>
            <Ring value={ring.value} unit={ring.unit} frac={ring.frac} tone={ring.tone} />
            <span className="meet-ring-under">{ring.under}</span>
          </div>
        )}
        {!call && <span className="meet-xxs meet-switch">The wall switches to the call by itself when it starts.</span>}
      </div>
      <Keys meeting={meeting} m={m} openKey={openKey} showBrief={showBrief} />
      {people && <People people={people} meetingId={meetingId} />}
      <div className="meet-hero-last">
        {/* The recording chip stays while a key press line shows; the line sits under the chips. */}
        <HeroChip />
        {call ? (
          <LightsChip where="meet" />
        ) : (
          <span className="meet-chip-later" aria-disabled="true" {...tip(LATER_TIP)}>
            <IconBulb size={18} aria-hidden="true" />
            Lights: later
          </span>
        )}
      </div>
      {(brief || m.notice) && (
        <div className="meet-hero-line">
          {brief ? (
            <span className="meet-brief" role="status" {...tip(brief)}>
              {brief}
            </span>
          ) : (
            <span className="meet-notice meet-xxs">{m.notice}</span>
          )}
        </div>
      )}
    </div>
  );
}
