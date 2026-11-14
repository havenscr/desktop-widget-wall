import { IconBrandSpotify, IconBrandYoutube, IconCalendar, IconSettings } from '@tabler/icons-react';
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { accountWords, clockText, needsSignIn, reasonLine, type MeetAccount } from '../meet/model';
import { useMeet, type MeetState } from '../meet/useMeet';
import { spotify, type SpotifyStatus } from '../music/spotify';
import { youtube, type YoutubeLink, type YoutubeStatus } from '../music/youtube';
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

function Btn({ label, onClick, cy, disabled, hover, icon }: { label: string; onClick: () => void; cy?: boolean; disabled?: boolean; hover?: string; icon?: ReactNode }) {
  const cls = ['tools-btn', cy ? 'cy' : '', icon ? 'ico' : ''].filter(Boolean).join(' ');
  return (
    <button type="button" className={cls} disabled={disabled} aria-label={icon ? label : undefined} onClick={onClick} {...(hover ? hoverCard(hover) : {})}>
      {icon ?? label}
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

/** What a YouTube sign-in that did not finish says, by the fixed word Rust sent. `null`: nothing to add (the row says it). */
function youtubeNotice(word: string): string | null {
  if (word === 'cancelled' || word === 'setup broken') return null;
  if (word === 'denied') return 'YouTube sign-in was refused';
  if (word === 'timed-out') return 'YouTube sign-in timed out';
  if (word === 'busy') return 'Google is busy, try again in a minute';
  if (word === 'down') return 'Could not reach Google';
  return 'YouTube sign-in did not finish';
}

/** What a refused Save says, by the fixed word Rust sent. */
function setupError(word: string): string {
  if (word === 'invalid') return 'That is not a Desktop app client. Check both values.';
  if (word === 'sign out first') return 'Sign out of YouTube first.';
  return 'Could not save the setup.';
}

/** YouTube's own state: not set up, signed out, signed in, or waiting on the browser, plus the Set up form. */
function useYoutubeAccount(opened: number) {
  const [status, setStatus] = useState<YoutubeStatus | null>(null);
  const [failed, setFailed] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const mounted = useRef(false);
  const waitingRef = useRef(false);
  waitingRef.current = waiting;
  const read = useCallback(() => {
    youtube.status().then(
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
      if (waitingRef.current) void youtube.cancelSignIn().catch(() => undefined);
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
    setEditing(false);
    setWaiting(true);
    youtube
      .signIn()
      .then(read, (e) => {
        const word = e instanceof Error ? e.message : String(e);
        if (!mounted.current) return;
        setNotice(youtubeNotice(word));
        read();
      })
      .finally(() => mounted.current && setWaiting(false));
  };
  const cancel = useCallback(() => void youtube.cancelSignIn().catch(() => undefined), []);
  const signOut = () => {
    setNotice(null);
    youtube.signOut().then(read, () => mounted.current && setNotice('Could not sign out of YouTube'));
  };
  const openLink = (kind: YoutubeLink) => {
    youtube.openLink(kind).catch(() => mounted.current && setNotice('Could not open the link'));
  };
  const saved = () => {
    setEditing(false);
    setNotice(null);
    read();
  };
  // The client was refused: said in words under the row, because the row's own line is one short phrase.
  const brokenHint = !waiting && !failed && !editing && status?.reason === 'setup broken' ? (status.signedIn ? 'Google refused this setup. Sign out, then set it up again.' : 'Google refused this setup. Set it up again.') : null;
  return { status, failed, waiting, notice, editing, brokenHint, setEditing, read, signIn, cancel, signOut, openLink, saved };
}

/**
 * The Set up form: a client id and a client secret, held in this component's state only and
 * cleared after Save whatever the answer. Nothing reads either value back from Rust.
 */
function YoutubeSetup({ onSaved, onCancel }: { onSaved: () => void; onCancel: () => void }) {
  const [id, setId] = useState('');
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );
  const ready = id.trim() !== '' && secret.trim() !== '';
  const save = () => {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    youtube.setClient(id, secret).then(
      () => {
        if (!mounted.current) return;
        setId('');
        setSecret('');
        setBusy(false);
        onSaved();
      },
      (e) => {
        if (!mounted.current) return;
        setId('');
        setSecret('');
        setBusy(false);
        setError(setupError(e instanceof Error ? e.message : String(e)));
      },
    );
  };
  const enter = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') save();
  };
  const common = { autoComplete: 'off', spellCheck: false, autoCorrect: 'off', autoCapitalize: 'off', disabled: busy, onKeyDown: enter } as const;
  return (
    <li className="tools-yt-form" aria-label="YouTube setup">
      <label className="tools-yt-field">
        <span>Client ID</span>
        <input {...common} type="text" className="tools-input" value={id} onChange={(e) => setId(e.target.value)} {...hoverCard("The Client ID of your Google Cloud Desktop app client. It ends in .apps.googleusercontent.com.")} />
      </label>
      <label className="tools-yt-field">
        <span>Client secret</span>
        <input {...common} type="password" className="tools-input" value={secret} onChange={(e) => setSecret(e.target.value)} {...hoverCard('The client secret of the same client. It shows as dots and is never shown again.')} />
      </label>
      <div className="tools-yt-actions">
        <Btn label="Save" cy disabled={!ready || busy} onClick={save} hover="Keeps both values in Windows' credential store." />
        <Btn label="Cancel" disabled={busy} onClick={onCancel} hover="Closes the form without saving." />
      </div>
      <div className={error ? 'tools-yt-hint bad' : 'tools-yt-hint'} role={error ? 'alert' : undefined}>
        {error ?? "From your own Google Cloud project. Kept in Windows' credential store, never in a file."}
      </div>
    </li>
  );
}

function YoutubeRow({ yt, blocked }: { yt: ReturnType<typeof useYoutubeAccount>; blocked: boolean }) {
  const icon = <IconBrandYoutube size={22} aria-hidden="true" />;
  const row = (line: string, tone: Tone, hover: string | undefined, buttons: ReactNode) => (
    <Row icon={icon} name="YouTube" line={line} tone={tone} hover={hover}>
      {buttons}
    </Row>
  );
  const setUp = (cy: boolean) => <Btn label="Set up" cy={cy} disabled={blocked} onClick={() => yt.setEditing(true)} hover="Opens the form for your Google Cloud client id and secret." />;
  const change = <Btn label="Change setup" icon={<IconSettings size={20} aria-hidden="true" />} disabled={blocked} onClick={() => yt.setEditing(true)} hover="Replace the client id and secret. Works only while signed out." />;
  const signInButton = <Btn label="Sign in" cy disabled={blocked} onClick={yt.signIn} hover="Opens Google's sign-in in your browser." />;
  if (yt.waiting) {
    return row('Waiting for the browser', 'plain', 'Finish signing in in the browser window that opened.', <Btn label="Cancel" onClick={yt.cancel} hover="Stops waiting for the browser." />);
  }
  if (yt.failed) {
    return row('Could not check', 'bad', 'The YouTube status did not come back.', <Btn label="Retry" onClick={yt.read} hover="Asks again." />);
  }
  const s = yt.status;
  if (!s) return <Row icon={icon} name="YouTube" line="Checking" />;
  if (s.reason === 'failed') {
    return row(s.setup ? 'Could not read the saved sign-in' : 'Could not check', 'bad', 'Windows did not hand back what the wall stored.', <Btn label="Retry" onClick={yt.read} hover="Asks again." />);
  }
  // The client was refused (a wrong secret, or a client that is not a Desktop app): only a new setup fixes it.
  if (s.reason === 'setup broken') {
    return row('Setup broken', 'bad', yt.brokenHint ?? undefined, s.signedIn ? <Btn label="Sign out" disabled={blocked} onClick={yt.signOut} hover="Signs out and tells Google to forget this sign-in." /> : setUp(true));
  }
  if (!s.setup) return row('Not set up', 'plain', 'Needs a Google Cloud Desktop app client. Setup takes about ten minutes, once.', yt.editing ? null : setUp(true));
  if (s.signedIn) return row('Signed in', 'plain', undefined, <Btn label="Sign out" disabled={blocked} onClick={yt.signOut} hover="Signs out and tells Google to forget this sign-in." />);
  const again = s.reason === 'sign in again';
  return row(again ? 'Sign in again' : 'Signed out', again ? 'bad' : 'plain', again ? 'Google ended the saved sign-in.' : undefined, yt.editing ? null : (<>{change}{signInButton}</>));
}

/** Under the YouTube row: the two links YouTube API Services asks for. The page sends only a kind word. */
function YoutubeLinks({ openLink }: { openLink: (kind: YoutubeLink) => void }) {
  return (
    <li className="tools-yt-links">
      <span>Uses YouTube API Services:</span>
      <span className="tools-yt-pair">
        <button type="button" className="tools-link" onClick={() => openLink('youtube-terms')} {...hoverCard("Opens YouTube's Terms of Service in your browser.")}>
          YouTube Terms
        </button>
        ,
      </span>
      <button type="button" className="tools-link" onClick={() => openLink('google-privacy')} {...hoverCard("Opens Google's Privacy Policy in your browser.")}>
        Google Privacy Policy
      </button>
    </li>
  );
}

/**
 * Accounts: each calendar account, Spotify and YouTube, with Sign in or Sign out. Twitch has no sign-in
 * yet, so it has no row (never a button that does nothing).
 */
export function Accounts() {
  const m = useMeet(true);
  const opened = useToolsStore((s) => s.opened);
  const sp = useSpotifyAccount(opened);
  const yt = useYoutubeAccount(opened);
  const accounts = m.data?.accounts ?? [];
  const openStatus = useOpenStatus(opened);
  const openLine = openStatus === 'failed' ? 'Could not check' : openStatus ? openWords[openStatus].line : 'Checking';
  const openHint = openStatus === 'failed'
    ? 'The wall could not ask Windows how meetings open. It will ask again when Tools opens.'
    : openStatus ? openWords[openStatus].hint : 'Checking how meetings open.';
  const blocked = m.signingIn !== null || sp.waiting || yt.waiting;
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
  useEffect(() => {
    setWaiting('youtube', yt.waiting, yt.cancel);
    return () => setWaiting('youtube', false);
  }, [yt.waiting, yt.cancel, setWaiting]);
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
        <YoutubeRow yt={yt} blocked={blocked} />
        {yt.brokenHint && <li className="tools-yt-hint bad">{yt.brokenHint}</li>}
        {yt.editing && <YoutubeSetup onSaved={yt.saved} onCancel={() => yt.setEditing(false)} />}
        <YoutubeLinks openLink={yt.openLink} />
      </ul>
      {(m.notice || sp.notice || yt.notice) && <div className="tools-note bad">{m.notice ?? sp.notice ?? yt.notice}</div>}
    </>
  );
}
