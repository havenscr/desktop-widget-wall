import { IconBrandSpotify, IconCalendar } from '@tabler/icons-react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { accountWords, clockText, needsSignIn, reasonLine, type MeetAccount } from '../meet/model';
import { useMeet, type MeetState } from '../meet/useMeet';
import { spotify, type SpotifyStatus } from '../music/spotify';
import { invoke } from '../bridge/tauri';
import { hover as hoverCard } from './hover';
import { useToolsStore } from './store';
import { calendarName } from './trouble';

type Tone = 'plain' | 'bad';
type OpenStatus = 'desktop' | 'browser-new-outlook' | 'browser-not-found' | 'browser-config' | 'desktop-config-typo';
type OpenStatusState = OpenStatus | 'failed' | null;

const openWords: Record<OpenStatus, { line: string; hint: string }> = {
  desktop: { line: 'Outlook on this PC', hint: 'Meetings open in classic Outlook when it is available.' },
  'browser-new-outlook': { line: 'the browser', hint: 'New Outlook has no way to open one meeting.' },
  'browser-not-found': { line: 'the browser', hint: 'Outlook was not found on this PC.' },
  'browser-config': { line: 'the browser', hint: 'This is set in meet.json.' },
  'desktop-config-typo': { line: 'Outlook on this PC', hint: 'meet.json has an unknown openIn value, so the desktop default is used.' },
};

function useOpenStatus(opened: number): OpenStatusState {
  const [status, setStatus] = useState<OpenStatusState>(null);
  useEffect(() => {
    let live = true;
    setStatus(null);
    void invoke<OpenStatus>('wall2_meet_open_status').then((value) => live && setStatus(value), () => live && setStatus('failed'));
    return () => {
      live = false;
    };
  }, [opened]);
  return status;
}

/** One account: an icon, its name, one line of state (amber when it needs attention) and at most one button. */
function Row({ icon, name, line, tone = 'plain', hover, children }: { icon: ReactNode; name: string; line: string; tone?: Tone; hover?: string; children?: ReactNode }) {
  return (
    <li className="tools-row tools-acct" {...(hover ? hoverCard(hover) : {})}>
      <span className="tools-ico">{icon}</span>
      <span className="tools-name">{name}</span>
      <span className={tone === 'bad' ? 'tools-line bad' : 'tools-line'}>{line}</span>
      {children}
    </li>
  );
}

function Btn({ label, onClick, cy, disabled }: { label: string; onClick: () => void; cy?: boolean; disabled?: boolean }) {
  return (
    <button type="button" className={cy ? 'tools-btn cy' : 'tools-btn'} disabled={disabled} onClick={onClick}>
      {label}
    </button>
  );
}

function CalendarRow({ a, m }: { a: MeetAccount; m: MeetState }) {
  const waiting = m.signingIn === a.id;
  const busy = m.signingIn !== null;
  const icon = <IconCalendar size={22} aria-hidden="true" />;
  const name = calendarName(a.label);
  if (waiting) {
    return (
      <Row icon={icon} name={name} line="Waiting for the browser" hover="Finish signing in in the browser window that opened.">
        <Btn label="Cancel" onClick={m.cancelSignIn} />
      </Row>
    );
  }
  const tried = a.state === 'unavailable' ? m.tried[a.id] : undefined;
  const hover = [reasonLine(a.reason) ?? (a.state === 'unavailable' ? a.reason : null), tried !== undefined ? `Last try ${clockText(tried)}` : null].filter(Boolean).join('\n');
  const bad = a.state === 'unavailable' || needsSignIn(a.state);
  const line = accountWords(a.state, a.reason);
  return (
    <Row icon={icon} name={name} line={line} tone={bad ? 'bad' : 'plain'} hover={hover || undefined}>
      {a.state === 'ok' && <Btn label="Sign out" disabled={busy} onClick={() => m.signOut(a.id)} />}
      {needsSignIn(a.state) && <Btn label="Sign in" cy disabled={busy} onClick={() => m.signIn(a.id)} />}
      {a.state === 'unavailable' && <Btn label="Try again" disabled={busy} onClick={m.refresh} />}
    </Row>
  );
}

/** Spotify's own state: not set up, signed out, connected, or waiting on the browser. */
function useSpotifyAccount(opened: number) {
  const [status, setStatus] = useState<SpotifyStatus | null>(null);
  const [failed, setFailed] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const mounted = useRef(false);
  const waitingRef = useRef(false);
  waitingRef.current = waiting;
  const read = useCallback(() => {
    spotify.status().then(
      (s) => {
        if (!mounted.current) return;
        setStatus(s);
        setFailed(false);
      },
      () => mounted.current && setFailed(true),
    );
  }, []);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      // Leaving with a sign-in waiting ends it, so the native side is never left waiting for a browser nobody will use.
      if (waitingRef.current) void spotify.cancelSignIn().catch(() => undefined);
    };
  }, [read]);
  useEffect(() => {
    read();
  }, [opened, read]);
  useEffect(() => {
    const focused = () => read();
    window.addEventListener('focus', focused);
    return () => window.removeEventListener('focus', focused);
  }, [read]);
  const signIn = () => {
    setNotice(null);
    setWaiting(true);
    spotify
      .signIn()
      .then(read, (e) => {
        const t = e instanceof Error ? e.message : String(e);
        if (mounted.current && t !== 'cancelled') setNotice('Spotify sign-in did not finish');
      })
      .finally(() => mounted.current && setWaiting(false));
  };
  const cancel = useCallback(() => void spotify.cancelSignIn().catch(() => undefined), []);
  const signOut = () => {
    setNotice(null);
    spotify.signOut().then(read, () => mounted.current && setNotice('Could not sign out of Spotify'));
  };
  return { status, failed, waiting, notice, read, signIn, cancel, signOut };
}

function SpotifyRow({ sp, blocked }: { sp: ReturnType<typeof useSpotifyAccount>; blocked: boolean }) {
  const icon = <IconBrandSpotify size={22} aria-hidden="true" />;
  if (sp.waiting) {
    return (
      <Row icon={icon} name="Spotify" line="Waiting for the browser" hover="Finish signing in in the browser window that opened.">
        <Btn label="Cancel" onClick={sp.cancel} />
      </Row>
    );
  }
  if (sp.failed) {
    return (
      <Row icon={icon} name="Spotify" line="Could not check" tone="bad" hover="The Spotify status did not come back.">
        <Btn label="Retry" onClick={sp.read} />
      </Row>
    );
  }
  if (!sp.status) return <Row icon={icon} name="Spotify" line="Checking" />;
  if (!sp.status.setup) {
    return <Row icon={icon} name="Spotify" line="Not set up" hover="Add spotify.json to the app's config folder, then open Tools again." />;
  }
  if (sp.status.signedIn) {
    return (
      <Row icon={icon} name="Spotify" line="Connected">
        <Btn label="Sign out" disabled={blocked} onClick={sp.signOut} />
      </Row>
    );
  }
  if (sp.status.reason === 'failed') {
    return (
      <Row icon={icon} name="Spotify" line="Could not read the saved sign-in" tone="bad">
        <Btn label="Retry" onClick={sp.read} />
      </Row>
    );
  }
  return (
    <Row icon={icon} name="Spotify" line="Not connected" hover={sp.status.reason ?? undefined}>
      <Btn label="Sign in" cy disabled={blocked} onClick={sp.signIn} />
    </Row>
  );
}

/**
 * Accounts: each calendar account and Spotify, with Sign in or Sign out. Twitch has no sign-in
 * yet, so it has no row (never a button that does nothing).
 */
export function Accounts() {
  const m = useMeet(true);
  const opened = useToolsStore((s) => s.opened);
  const sp = useSpotifyAccount(opened);
  const accounts = m.data?.accounts ?? [];
  const openStatus = useOpenStatus(opened);
  const openLine = openStatus === 'failed' ? 'Could not check' : openStatus ? openWords[openStatus].line : 'Checking';
  const openHint = openStatus === 'failed'
    ? 'The wall could not ask Windows how meetings open. It will ask again when Tools opens.'
    : openStatus ? openWords[openStatus].hint : 'Checking how meetings open.';
  const blocked = m.signingIn !== null || sp.waiting;
  const setWaiting = useToolsStore((s) => s.setWaiting);
  const note = useToolsStore((s) => s.note);
  const clearNote = useToolsStore((s) => s.clearNote);
  // The drawer holds its idle close while a sign-in waits, and cancels it when closed on purpose.
  const calendarWaiting = m.signingIn !== null;
  useEffect(() => {
    setWaiting('calendar', calendarWaiting, m.cancelSignIn);
    return () => setWaiting('calendar', false);
  }, [calendarWaiting, m.cancelSignIn, setWaiting]);
  useEffect(() => {
    setWaiting('spotify', sp.waiting, sp.cancel);
    return () => setWaiting('spotify', false);
  }, [sp.waiting, sp.cancel, setWaiting]);
  // "Sign-in cancelled" shows for a few seconds after the drawer was closed on a waiting sign-in.
  useEffect(() => {
    if (!note) return;
    const id = setTimeout(clearNote, 6000);
    return () => clearTimeout(id);
  }, [note, clearNote]);
  let calendars: ReactNode;
  if (accounts.length > 0) {
    calendars = accounts.map((a) => <CalendarRow key={a.id} a={a} m={m} />);
  } else if (m.status === 'unconfigured') {
    calendars = <Row icon={<IconCalendar size={22} aria-hidden="true" />} name="Calendar" line="Not set up" hover="Setup steps are in the Wall 2 README, section Meet." />;
  } else if (m.status === 'invalid') {
    calendars = <Row icon={<IconCalendar size={22} aria-hidden="true" />} name="Calendar" line="meet.json is not valid" tone="bad" hover="See the Meet section of the Wall 2 README." />;
  } else if (m.status === 'error') {
    calendars = (
      <Row icon={<IconCalendar size={22} aria-hidden="true" />} name="Calendar" line="Could not be read" tone="bad">
        <Btn label="Try again" onClick={m.refresh} />
      </Row>
    );
  } else {
    calendars = <Row icon={<IconCalendar size={22} aria-hidden="true" />} name="Calendar" line="Checking" />;
  }
  return (
    <>
      {note && <div className="tools-note bad">{note}</div>}
      <ul className="tools-list" aria-label="Accounts">
        {calendars}
        <Row icon={<IconCalendar size={22} aria-hidden="true" />} name="Meetings open in:" line={openLine} hover={openHint} />
        <SpotifyRow sp={sp} blocked={blocked} />
      </ul>
      {(m.notice || sp.notice) && <div className="tools-note bad">{m.notice ?? sp.notice}</div>}
    </>
  );
}
