import { IconCalendarEvent, IconCircleCheck, IconClock, IconMicrophoneOff, IconNotes, IconPhoneOff, IconScreenShare, IconUsers, IconVideo } from '@tabler/icons-react';
import { useCallback, useRef, type ReactNode } from 'react';
import { StudioBlock } from '../../studio/StudioBlock';
import type { Meeting } from '../../meet/model';
import type { CallKind, CallSignal } from '../../signals/model';
import { useSignalStore } from '../../signals/store';
import { tip } from '../../ui/HoverTip';
import { useMeetingFeed, useNextMeeting } from '../../work/useNextMeeting';
import { NotesCard } from '../NotesCard';
import { matchMeeting, minutesLeft, talkStart } from '../meetMatch';
import { useOnAirStore } from '../store';
import { takeClock } from '../takeModel';
import { Head, LibTile, MarkTile, OffTile, TileRow } from './Tiles';
import { clockText, windowText } from './time';
import { useDeckKeys } from './useDeckKeys';

/** The speaker notes' sizes: today's notes card sizes. */
const SPEAKER_SIZES = [36, 30, 26, 22] as const;

const KIND_WORD: Record<CallKind, string> = { teams: 'Teams', zoom: 'Zoom', browser: 'Browser' };

/** True until the shared calendar feed has answered once (an answer, a failure or "no calendar" all count). Nothing is said about a match before that. */
function useFeedPending(): boolean {
  return useMeetingFeed((s) => s.reads === 0 && s.asOf === null && !s.failed);
}

/** The meeting this call belongs to, from the shared calendar feed (empty while it is stale or failed). */
function useCallMeeting(call: CallSignal | null): Meeting | null {
  const meetings = useMeetingFeed((s) => s.meetings);
  const stale = useMeetingFeed((s) => s.feedStale);
  const failed = useMeetingFeed((s) => s.failed);
  return call ? matchMeeting(meetings, call.since, !stale && !failed) : null;
}

function TalkTimer({ now, call, meeting, pending }: { now: number; call: CallSignal | null; meeting: Meeting | null; pending: boolean }) {
  const start = call ? talkStart(meeting, call.since) : null;
  const ms = start === null ? 0 : Math.max(0, now - start);
  const time = takeClock(ms);
  const left = minutesLeft(meeting, now);
  let sub: ReactNode;
  let text: string;
  if (!call || start === null) sub = text = 'No call is on. The timer starts with the call.';
  else if (!meeting) sub = text = pending ? `Started ${clockText(start)}, when the call began.` : `Started ${clockText(start)}, when the call began. No end time known.`;
  else if (left === 0) sub = text = `Your calendar said it ended at ${clockText(Date.parse(meeting.end))}.`;
  else {
    const how = start === Date.parse(meeting.start) ? ' with the meeting' : ', when you joined';
    // Joined early: before the meeting's start the timer waits at 0:00 and the line says when it starts.
    const word = now < start ? 'Starts' : 'Started';
    text = `${word} ${clockText(start)}${how}. ${left} min left by your calendar.`;
    sub = (
      <>
        {word} {clockText(start)}
        {how}. <b>{left} min left</b> by your calendar.
      </>
    );
  }
  return (
    <div className="oa2-b oa2-timer oa2-talk" role="group" aria-label="Talk timer">
      <Head label="Talk timer" />
      <div className="oa-time-row">
        <span className="oa-time" data-running={call ? 'true' : 'false'} role="timer" aria-label={`Talk time ${time}`} {...tip(call ? 'Counts from the start of the meeting, or from when the call began if you joined late.' : 'No call is on')}>
          {time}
        </span>
      </div>
      <div className="oa2-sub" {...tip(text)}>
        {sub}
      </div>
    </div>
  );
}

function CallChips({ call }: { call: CallSignal | null }) {
  if (!call) {
    return (
      <div className="oa2-b oa2-chips oa2-callchips">
        <span className="oa2-chip" data-kind="stale">
          No call on
        </span>
      </div>
    );
  }
  return (
    <div className="oa2-b oa2-chips oa2-callchips">
      <span className="oa2-chip" data-kind="call">
        <i className="oa2-dot" data-mode="meet" aria-hidden="true" />
        {KIND_WORD[call.kind]} call on
        {call.camera && <span>camera on</span>}
        <span>mic on</span>
      </span>
    </div>
  );
}

function MeetingBlock({ now, call, meeting, pending }: { now: number; call: CallSignal | null; meeting: Meeting | null; pending: boolean }) {
  if (!call) {
    return (
      <div className="oa2-b oa2-meeting" role="group" aria-label="Presenting">
        <Head label="Presenting" right="no call" />
        <div className="oa2-title">No call is on</div>
        <div className="oa2-rows">
          <div className="oa2-row">
            <IconCalendarEvent size={20} aria-hidden="true" />
            <span className="oa2-row-t">This page was held by hand</span>
          </div>
        </div>
      </div>
    );
  }
  if (!meeting && pending) {
    // The calendar has not answered yet: only what the call itself says.
    return (
      <div className="oa2-b oa2-meeting" role="group" aria-label="Presenting">
        <Head label="Presenting" />
        <div className="oa2-title" {...tip(`A ${KIND_WORD[call.kind]} call is on`)}>
          A {KIND_WORD[call.kind]} call is on
        </div>
        <div className="oa2-rows">
          <div className="oa2-row ok">
            <IconCircleCheck size={20} aria-hidden="true" />
            <span className="oa2-row-t">On since {clockText(call.since)}</span>
          </div>
        </div>
      </div>
    );
  }
  if (!meeting) {
    return (
      <div className="oa2-b oa2-meeting" role="group" aria-label="Presenting">
        <Head label="Presenting" right="no calendar match" />
        <div className="oa2-title" {...tip(`A ${KIND_WORD[call.kind]} call is on`)}>
          A {KIND_WORD[call.kind]} call is on
        </div>
        <div className="oa2-rows">
          <div className="oa2-row">
            <IconCalendarEvent size={20} aria-hidden="true" />
            <span className="oa2-row-t">No meeting on your calendar matches it</span>
          </div>
          <div className="oa2-row">
            <IconClock size={20} aria-hidden="true" />
            <span className="oa2-row-t">Time left: not known. The timer counts up</span>
          </div>
          <div className="oa2-row ok">
            <IconCircleCheck size={20} aria-hidden="true" />
            <span className="oa2-row-t">On since {clockText(call.since)}</span>
          </div>
        </div>
      </div>
    );
  }
  const d = meeting.details;
  const invited = d ? d.people.length + d.peopleMore : null;
  return (
    <div className="oa2-b oa2-meeting" role="group" aria-label="Presenting">
      <Head label="Presenting" right="from your calendar" />
      <div className="oa2-title" {...tip(meeting.title)}>
        {meeting.title}
      </div>
      <div className="oa2-rows">
        <div className="oa2-row">
          <IconCalendarEvent size={20} aria-hidden="true" />
          <span className="oa2-row-t">{windowText(Date.parse(meeting.start), Date.parse(meeting.end), now)}</span>
        </div>
        {invited !== null && (
          <div className="oa2-row" {...tip(d?.calledBy ? `${invited} invited. Organiser: ${d.calledBy}` : `${invited} invited`)}>
            <IconUsers size={20} aria-hidden="true" />
            <span className="oa2-row-t">
              {invited} invited{d?.calledBy ? `. Organiser: ${d.calledBy}` : ''}
            </span>
          </div>
        )}
        <div className="oa2-row ok">
          <IconCircleCheck size={20} aria-hidden="true" />
          <span className="oa2-row-t">You joined at {clockText(call.since)}</span>
        </div>
      </div>
    </div>
  );
}

const BROWSER_OFF = 'The wall has no keys for a call in the browser';
const OFF_ROW = [
  { label: 'Mute', icon: IconMicrophoneOff },
  { label: 'Camera', icon: IconVideo },
  { label: 'Share screen', icon: IconScreenShare },
  { label: 'Leave', icon: IconPhoneOff },
] as const;

function CallKeys({ now, call, start }: { now: number; call: CallSignal | null; start: number | null }) {
  const keys = useDeckKeys();
  const mark = useOnAirStore((s) => s.mark);
  const marking = useOnAirStore((s) => s.marking);
  const kind = call?.kind;
  const lib = kind === 'teams' || kind === 'zoom' ? kind : null;
  const right = lib ? `sent to ${KIND_WORD[lib]}` : call ? 'no keys for a browser call' : 'no call is on';
  const offWhy = call ? BROWSER_OFF : 'No call is on';
  const talkMs = start === null ? 0 : Math.max(0, now - start);
  return (
    <div className="oa2-b oa2-callkeys" role="group" aria-label="Call keys">
      <Head label="Call keys" right={right} brief={keys.brief} />
      <TileRow keys={keys} cols={4}>
        {lib
          ? ['mute', 'camera', 'share', 'leave'].map((k) => <LibTile key={k} keys={keys} spec={{ id: `${lib}-${k}` }} />)
          : OFF_ROW.map((o) => <OffTile key={o.label} keys={keys} label={o.label} icon={o.icon} why={offWhy} />)}
      </TileRow>
      {keys.groups !== null && (
        <TileRow keys={keys} cols={3}>
          <MarkTile mark={mark} showMs={start === null ? undefined : talkMs} marking={marking} />
          <LibTile keys={keys} spec={{ id: 'snip' }} />
          <LibTile keys={keys} spec={{ id: 'strip-dark' }} />
        </TileRow>
      )}
    </div>
  );
}

/**
 * The Presenting page: the talk timer, the call chip, the meeting the call belongs to (from the calendar, or
 * plain words when none matches), the speaker notes, the call keys and the studio lights (today's block,
 * unchanged). The prompter's box, under the call keys, stays empty until its own pull request.
 */
export function PresentingPage({ now }: { now: number }) {
  const call = useSignalStore((s) => s.call);
  // The shared calendar feed reads while this page is open (the buddy keeps it too).
  const nowRef = useRef(now);
  nowRef.current = now;
  useNextMeeting(useCallback(() => nowRef.current, []));
  const meeting = useCallMeeting(call);
  const pending = useFeedPending();
  const start = call ? talkStart(meeting, call.since) : null;
  return (
    <>
      <TalkTimer now={now} call={call} meeting={meeting} pending={pending} />
      <CallChips call={call} />
      <MeetingBlock now={now} call={call} meeting={meeting} pending={pending} />
      <NotesCard title="Speaker notes" right="the call's chat cannot be read by the wall" sizes={SPEAKER_SIZES} icon={<IconNotes size={20} aria-hidden="true" />} className="oa2-speaker" />
      <CallKeys now={now} call={call} start={start} />
      {/* The prompter's box (wall 1920, 230, 620 by 104) is kept empty until the prompter's own pull request. */}
      <div className="oa2-b oa2-empty oa2-empty-prompter oa2-empty-meet" aria-hidden="true" />
      <div className="oa2-b oa2-lights-meet">
        <StudioBlock />
      </div>
    </>
  );
}
