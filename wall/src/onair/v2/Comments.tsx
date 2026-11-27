import { IconClock, IconMessageCircle, IconStarFilled } from '@tabler/icons-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { tip } from '../../ui/HoverTip';
import { chatStale, type LiveChat, type LiveMessage } from '../ytlive';
import { useYtLive } from '../ytliveStore';
import { youtube } from '../../music/youtube';
import { ChannelField, ChannelLine } from './ChannelField';
import { Head } from './Tiles';
import { clockText } from './time';

type View = 'reading' | 'signed-out-card' | 'nochannel' | 'refused' | 'none' | 'scheduled' | 'chatoff' | 'live';

function readAgo(readAt: number | null, now: number): string {
  if (readAt === null) return 'YouTube';
  const s = Math.max(0, Math.round((now - readAt) / 1000));
  return `YouTube · read ${s < 60 ? `${s} s` : `${Math.floor(s / 60)} min`} ago`;
}

/** The letter and colour of the tile shown when a picture is missing or fails: the first letter or digit of the handle, and a hue taken from the whole handle. */
export function avatarTile(name: string): { letter: string; hue: number } {
  const chars = Array.from(name.replace(/^@/, ''));
  const letter = (chars.find((c) => /[\p{L}\p{N}]/u.test(c)) ?? chars[0] ?? '?').toUpperCase();
  let h = 0;
  for (const c of name) h = (h * 31 + (c.codePointAt(0) ?? 0)) % 360;
  return { letter, hue: h };
}

/** A round 40 px picture that fades in when it has loaded; a missing or broken one is a round tile with the handle's first letter. */
export function Avatar({ name, src }: { name: string; src: string | null | undefined }) {
  const [state, setState] = useState<'wait' | 'ok' | 'bad'>('wait');
  useEffect(() => setState('wait'), [src]);
  const tile = avatarTile(name);
  if (!src || state === 'bad') {
    return (
      <span className="oa2-cm-av oa2-cm-tile" aria-hidden="true" style={{ background: `hsl(${tile.hue} 45% 32%)` }}>
        {tile.letter}
      </span>
    );
  }
  return (
    <span className="oa2-cm-av" aria-hidden="true">
      <img src={src} alt="" width={40} height={40} decoding="async" loading="lazy" referrerPolicy="no-referrer" data-loaded={state === 'ok' ? 'true' : 'false'} onLoad={() => setState('ok')} onError={() => setState('bad')} />
    </span>
  );
}

/** Rows keep their place while the pointer is on the list; newest at the bottom. The list scrolls and stays on the newest row unless the viewer scrolled up; while rows are hidden above, the top edge fades (never a hard cut), so a row taller than the list is readable in full by scrolling. Long handles and long unbroken text wrap in full. */
function Rows({ messages, dim }: { messages: LiveMessage[]; dim: boolean }) {
  const list = useRef<HTMLDivElement | null>(null);
  const pinned = useRef(true);
  const [over, setOver] = useState(false);
  const [held, setHeld] = useState<LiveMessage[] | null>(null);
  const shown = over && held ? held : messages;
  const mark = () => {
    const el = list.current;
    if (!el) return;
    el.toggleAttribute('data-above', el.scrollTop > 0.5);
  };
  useLayoutEffect(() => {
    const el = list.current;
    if (!el) return;
    if (pinned.current) el.scrollTop = el.scrollHeight;
    mark();
  });
  // Fonts and the card's own size settle after the first paint; keep the newest row in view while pinned.
  useEffect(() => {
    const el = list.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      if (pinned.current) el.scrollTop = el.scrollHeight;
      mark();
    });
    ro.observe(el);
    for (const row of el.children) ro.observe(row);
    return () => ro.disconnect();
  }, [shown]);
  return (
    <div
      ref={list}
      className="oa2-cms"
      aria-label="Comments"
      role="log"
      data-dim={dim ? 'true' : 'false'}
      onScroll={(e) => {
        const el = e.currentTarget;
        pinned.current = el.scrollHeight - el.clientHeight - el.scrollTop < 2;
        mark();
      }}
      onPointerEnter={() => {
        setHeld(messages);
        setOver(true);
      }}
      onPointerLeave={() => setOver(false)}
    >
      {shown.map((m) => (
        <div key={m.id} className="oa2-cm" data-super={m.superChat ? 'true' : undefined} {...tip(`${m.name}: ${m.text}${m.superChat ? ` (Super Chat ${m.superChat})` : ''}`)}>
          <Avatar name={m.name} src={m.avatar} />
          <div className="oa2-cm-b">
            <span className="oa2-cm-n">{m.name}</span>
            {m.superChat && (
              <span className="oa2-cm-sc">
                <IconStarFilled size={14} aria-hidden="true" />
                {m.superChat}
              </span>
            )}
            <span className="oa2-cm-t">{m.text}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function Quiet({ icon, line, button }: { icon: React.ReactNode; line: string; button?: React.ReactNode }) {
  return (
    <div className="oa2-cq">
      {icon}
      <span className="oa2-cq-t" role="status">
        {line}
      </span>
      {button}
    </div>
  );
}

function pick(channelSet: boolean | null, state: string | null, chat: LiveChat | null, chatOn: boolean): View {
  if (state === null) return 'reading';
  if (state === 'signed-out') return 'signed-out-card';
  if (state === 'not-set-up' || channelSet === false) return 'nochannel';
  if (state === 'none') return 'none';
  if (state === 'scheduled') return 'scheduled';
  if (!chatOn) return 'chatoff';
  if (chat && chat.state === 'off' && chat.word !== null) return 'refused';
  return 'live';
}

/**
 * The comments card: the read-only YouTube chat while a show is live, and one quiet solid card with one line and one button when
 * it cannot be read (no channel, signed out, refused). The channel field lives here, not in Tools. Chat text is shown from memory
 * and never written anywhere.
 */
export function Comments({ now, style, action }: { now: number; style?: React.CSSProperties; action?: React.ReactNode }) {
  const channel = useYtLive((s) => s.channel);
  const status = useYtLive((s) => s.status);
  const chat = useYtLive((s) => s.chat);
  const readStatus = useYtLive((s) => s.readStatus);
  const readChat = useYtLive((s) => s.readChat);
  const [editing, setEditing] = useState(false);
  const view = pick(channel === null ? null : channel.set, status?.state ?? null, chat, status?.chat === true);
  const noShow = view !== 'live';
  const named = channel?.set === true;

  let body: React.ReactNode;
  let right: string | undefined;
  if (editing) {
    body = <ChannelField firstTime={!named} onClose={() => setEditing(false)} />;
  } else if (view === 'reading') {
    body = <Quiet icon={<IconClock size={22} aria-hidden="true" />} line="Reading YouTube" />;
  } else if (view === 'nochannel') {
    body = (
      <Quiet
        icon={<IconMessageCircle size={22} aria-hidden="true" />}
        line="Name your YouTube channel to show its comments here."
        button={
          <button type="button" className="oa-btn cy" onClick={() => setEditing(true)} {...tip('Pick the channel your shows go out on')}>
            Name channel
          </button>
        }
      />
    );
  } else if (view === 'signed-out-card') {
    body = (
      <Quiet
        icon={<IconMessageCircle size={22} aria-hidden="true" />}
        line="Sign in to YouTube to show comments here."
        button={
          <button type="button" className="oa-btn cy" onClick={() => void youtube.signIn().then(() => readStatus(true), () => {})} {...tip('Opens the YouTube sign-in. The wall only reads; it never posts.')}>
            Sign in
          </button>
        }
      />
    );
  } else if (view === 'refused') {
    body = (
      <Quiet
        icon={<IconMessageCircle size={22} aria-hidden="true" />}
        line="YouTube would not let the wall read this chat."
        button={
          <button type="button" className="oa-btn cy" onClick={() => void readChat()} {...tip('Ask YouTube again')}>
            Check again
          </button>
        }
      />
    );
  } else if (view === 'none') {
    body = <Quiet icon={<IconMessageCircle size={22} aria-hidden="true" />} line="No YouTube broadcast found. Comments show here when one goes live." />;
  } else if (view === 'scheduled') {
    const at = status?.scheduledAt ?? null;
    body = <Quiet icon={<IconClock size={22} aria-hidden="true" />} line={`Chat opens with the broadcast.${at !== null ? ` Scheduled for ${clockText(at)} on YouTube.` : ''} Comments show here once it is live.`} />;
  } else if (view === 'chatoff') {
    body = <Quiet icon={<IconMessageCircle size={22} aria-hidden="true" />} line="Chat is off for this broadcast" />;
  } else {
    const messages = chat?.messages ?? [];
    const stale = chat !== null && chatStale(chat, now);
    const quota = chat?.state === 'quota';
    const ended = chat?.state === 'ended';
    const dim = stale || quota || ended;
    right = quota && chat?.stoppedAt != null ? `YouTube · stopped ${clockText(chat.stoppedAt)}` : stale && chat?.readAt != null ? `YouTube · last read ${clockText(chat.readAt)}` : readAgo(chat?.readAt ?? null, now);
    let foot = 'YouTube only, read every 10 seconds.';
    let amber = false;
    if (quota) {
      foot = `Today's YouTube reads are used up. Comments stopped here${chat?.stoppedAt != null ? ` at ${clockText(chat.stoppedAt)}` : ''}.`;
      amber = true;
    } else if (ended) {
      foot = 'The broadcast ended. These are the last comments read.';
    } else if (stale && chat?.readAt != null) {
      const min = Math.max(1, Math.round((now - chat.readAt) / 60_000));
      foot = `YouTube has not answered for ${min} min. These are the last comments read.`;
      amber = true;
    }
    body = (
      <>
        {chat === null ? (
          <div className="oa2-cms oa2-cms-empty">Reading the chat</div>
        ) : messages.length === 0 && !dim ? (
          <div className="oa2-cms oa2-cms-empty">No comments yet. They show here within about 10 seconds of being posted.</div>
        ) : (
          <Rows messages={messages} dim={dim} />
        )}
        <div className="oa2-cfoot">
          <span className={`oa2-fine${amber ? ' amber' : ''}`} role="status">
            {foot}
          </span>
          {stale && !quota && (
            <button type="button" className="oa-btn sm" onClick={() => void useYtLive.getState().readStatus(true).then(readChat)} {...tip('Ask YouTube again now')}>
              Check again
            </button>
          )}
        </div>
      </>
    );
  }
  const showLine = noShow && named && !editing && view !== 'signed-out-card' && view !== 'reading';
  return (
    <section className="panel oa2-b oa2-comments" data-view={view} aria-label="Comments" style={style}>
      <Head label="Comments" right={right} icon={<IconMessageCircle size={20} aria-hidden="true" />} action={action} />
      {body}
      {showLine && <ChannelLine title={channel?.title ?? null} onChange={() => setEditing(true)} />}
    </section>
  );
}
