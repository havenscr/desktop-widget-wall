import { IconCalendarEvent, IconNotes, IconVideo } from '@tabler/icons-react';
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
import { HeroChip, TroubleLine } from './parts';
import {
  BROWSER_KEYS,
  BROWSER_TIP,
  LONG_TITLE,
  MUTE_TIP,
  calledByLine,
  callKeys,
  callWord,
  initials,
  matchDayEvent,
  peopleBlock,
  ringOf,
  statusLine,
  type CallKeySpec,
} from './heroModel';
import { joinIsUrgent, mayBeOutOfDate, type Meeting } from './model';
import type { MeetState } from './useMeet';

/** The ring: 164 px, stroke 6, the number inside and its unit under it. */
function Ring({ value, unit, frac, tone }: { value: number; unit: string; frac: number; tone: string }) {
  const d = 164;
  const stroke = 6;
  const r = d / 2 - stroke;
  const c = 2 * Math.PI * r;
  return (
    <div className="meet-ring-dial" data-tone={tone}>
      <svg width={d} height={d} viewBox={`0 0 ${d} ${d}`} aria-hidden="true">
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
      aria-disabled={ok ? undefined : 'true'}
      data-role={spec.role}
      onKeyDown={onKeyDown(hit?.key.action ?? null)}
      onClick={(e) => {
        if (!ok || keyboardOnMouseKey(hit.key.action, e.detail)) return;
        void press(`meet:${spec.id}`, e.detail, { command: 'wall2_keys_send_library', args: { id: spec.id } }, spec.label, hit.key.action, where, false);
      }}
      {...tip(text)}
    >
      <KeyIcon name={ok ? hit.key.icon : 'keyboard'} size={30} />
      <span>{spec.label}</span>
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
    if (!specs) {
      return (
        <div className="meet-keys" aria-label="Call keys">
          {BROWSER_KEYS.map((k) => (
            <button key={k.role} type="button" className="meet-key off dashed" aria-label={k.label} aria-disabled="true" {...tip(BROWSER_TIP)}>
              <KeyIcon name={{ mute: 'mic', camera: 'video', share: 'screen-share', leave: 'phone-off' }[k.role]} size={30} />
              <span>{k.label}</span>
            </button>
          ))}
        </div>
      );
    }
    return (
      <div className="meet-keys" aria-label="Call keys">
        {specs.map((s) => (
          <CallKey key={s.id} spec={s} groups={groups} camera={call.camera} kind={call.kind as 'teams' | 'zoom'} press={press} onKeyDown={onKeyDown} />
        ))}
      </div>
    );
  }
  if (!meeting) return null;
  const urgent = joinIsUrgent(meeting, m.now);
  const canOpen = openKey !== undefined;
  if (!meeting.canJoin && !canOpen) {
    return (
      <div className="meet-keys" aria-label="Meeting keys">
        <span className="meet-key off dashed wide" role="note" {...tip('The calendar gave this meeting no join link, and Outlook cannot open it from here')}>
          No join link on this meeting
        </span>
      </div>
    );
  }
  return (
    <div className="meet-keys" aria-label="Meeting keys">
      {meeting.canJoin && (
        <button
          type="button"
          className={urgent ? 'meet-key join urgent' : 'meet-key join'}
          aria-label={`Join: ${meeting.title}`}
          onClick={() => m.join(meeting.key)}
          {...tip(urgent ? 'Join this meeting now' : 'Join this meeting. It starts later.')}
        >
          <IconVideo size={32} stroke={1.8} aria-hidden="true" />
          <span>Join</span>
        </button>
      )}
      {canOpen && (
        <button
          type="button"
          className="meet-key"
          aria-label="Open invite"
          onClick={() => void invoke('wall2_open_event', { key: openKey }).catch(() => undefined)}
          {...tip('Open this invite in Outlook')}
        >
          <IconCalendarEvent size={30} stroke={1.8} aria-hidden="true" />
          <span>Open invite</span>
        </button>
      )}
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
  const agenda = meeting?.details?.invite ?? null;
  const people = meeting ? peopleBlock(meeting.details) : null;
  const trouble = troubleLine(m.data?.accounts ?? []);
  const outOfDate = meeting ? mayBeOutOfDate(m.data?.accounts ?? []) : false;
  return (
    <div className="meet-hero" aria-label="Next meeting" data-tone={status.tone} data-plain={meeting ? undefined : 'true'}>
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
      <div className="meet-hero-below" data-trouble={trouble ? 'true' : undefined}>
        {by && (
          <div className="meet-by ellipsis" {...tip(by)}>
            {by}
          </div>
        )}
        {agenda && (
          <div className="meet-agenda" {...tip(agenda)}>
            <IconNotes size={22} stroke={1.8} aria-hidden="true" />
            <span>{agenda}</span>
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
      <Keys meeting={meeting} m={m} openKey={openKey} showBrief={showBrief} />
      {people && (
        <div className="meet-ppl" {...tip(`${people.head}. ${people.replies}. Names are in the island.`)}>
          <div className="meet-ppl-row">
            {people.circles.map((p, i) => (
              <span key={`${p.name}-${i}`} className="meet-ini" style={i ? { marginLeft: -8 } : undefined} {...tip(p.name)}>
                {initials(p.name)}
              </span>
            ))}
            {people.more > 0 && (
              <span className="meet-ini more" style={people.circles.length ? { marginLeft: -8 } : undefined}>
                +{people.more}
              </span>
            )}
          </div>
          <div className="meet-ppl-n">{people.head}</div>
          <div className="meet-ppl-r">{people.replies}</div>
        </div>
      )}
      <div className="meet-hero-last">
        {/* The recording chip stays while a key press line shows; the line sits beside it. */}
        <HeroChip />
        {brief ? (
          <span className="meet-brief" role="status" {...tip(brief)}>
            {brief}
          </span>
        ) : (
          <>
            {!call && <span className="meet-xxs">The wall switches to the call by itself when it starts.</span>}
            {m.notice && <span className="meet-notice meet-xxs">{m.notice}</span>}
          </>
        )}
      </div>
    </div>
  );
}
