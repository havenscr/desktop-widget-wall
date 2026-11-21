import { IconCamera, IconCopy, IconExternalLink, IconFolder, IconPhoto, IconVideo } from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import { invoke } from '../bridge/tauri';
import { hover } from '../tools/hover';
import { useBrief } from '../work/useBrief';
import { formatSize, formatWhen, kindWord, SHOWN, trimThumbs, useCaptures, useThumb, type Capture, type CaptureAction } from './captures';

const GONE = 'File moved or deleted';

/** Words for a failed Open, Copy or Folder, by Rust's answer. */
function failure(e: unknown): string {
  const word = e instanceof Error ? e.message : String(e);
  return word === 'missing' ? GONE : 'Could not do that';
}

const DONE: Record<CaptureAction, string> = { open: 'Opened', copy: 'Copied to the clipboard', folder: 'Shown in File Explorer' };

/** A capture's picture, or a tile that says why there is none. `w` and `h` are the box in design pixels. */
function Pic({ c, w, h, large }: { c: Capture; w: number; h: number; large: boolean }) {
  const thumb = useThumb(c);
  const style = { width: w, height: h };
  if (thumb.state === 'ready') return <img className="cap-img" src={thumb.src} alt="" width={w} height={h} style={style} draggable={false} />;
  const icon = c.kind === 'video' ? <IconVideo size={large ? 56 : 28} stroke={1.6} aria-hidden="true" /> : <IconPhoto size={large ? 56 : 28} stroke={1.6} aria-hidden="true" />;
  let words = '';
  if (!c.exists) words = GONE;
  else if (thumb.state === 'big') words = 'Too big to preview';
  else if (thumb.state === 'failed') words = 'No preview';
  return (
    <span className={`cap-tile${c.kind === 'video' ? ' video' : ''}`} style={style}>
      {icon}
      {large && words ? <span className="cap-tile-note">{words}</span> : null}
    </span>
  );
}

function Badge({ c }: { c: Capture }) {
  const word = kindWord(c);
  return word ? <span className={`cap-badge ${c.kind}`}>{word}</span> : null;
}

/** The Shelf's Captures card (look B): the picked capture large, the others as rows, newest first. */
export function CapturesCard() {
  const { status, items } = useCaptures();
  const [picked, setPicked] = useState<string | null>(null);
  const [brief, show] = useBrief();
  const shown = items.slice(0, SHOWN);
  const big = shown.find((c) => c.id === picked) ?? shown[0];
  const rows = shown.filter((c) => c !== big);
  useEffect(() => trimThumbs(shown.map((c) => c.id)), [items]); // eslint-disable-line react-hooks/exhaustive-deps

  const act = (c: Capture, action: CaptureAction) => {
    invoke('wall2_captures_act', { id: c.id, action }).then(
      () => show(DONE[action]),
      (e: unknown) => show(failure(e)),
    );
  };

  let body;
  if (status === 'notfound') body = <p className="shelf-note">ShareX history not found on this PC</p>;
  else if (status === 'error') body = <p className="shelf-note">Could not read the ShareX history</p>;
  else if (status === 'ready' && !big) body = <p className="shelf-note">No captures yet. Use the keys beside this card.</p>;
  else if (!big) body = null;
  else {
    const name = big.title || big.fileName;
    const when = formatWhen(big.time);
    const line = [big.app, when, big.exists ? formatSize(big.size) : ''].filter(Boolean).join(' · ');
    body = (
      <div className="cap-hero">
        <div className="cap-big">
          <div className="cap-pic-wrap">
            {big.exists ? (
              <button type="button" className="cap-pic" onClick={() => act(big, 'open')} {...hover(`Open "${name}" in its app`)}>
                <Pic c={big} w={392} h={220} large />
              </button>
            ) : (
              <div className="cap-pic gone" {...hover(GONE)}>
                <Pic c={big} w={392} h={220} large />
              </div>
            )}
            <Badge c={big} />
          </div>
          <div className="cap-bt">
            <b {...hover(name)}>{name}</b>
            <span {...hover(line || big.fileName)}>{big.exists ? line : GONE}</span>
          </div>
          {big.exists ? (
            <div className="cap-acts">
              <button type="button" className="cap-act" onClick={() => act(big, 'copy')} {...hover('Copy this capture to the clipboard as a file, ready to paste into a chat, an email or a folder')}>
                <IconCopy size={20} stroke={1.8} aria-hidden="true" />
                Copy
              </button>
              <button type="button" className="cap-act" onClick={() => act(big, 'open')} {...hover('Open this capture in its default app')}>
                <IconExternalLink size={20} stroke={1.8} aria-hidden="true" />
                Open
              </button>
              <button type="button" className="cap-act" onClick={() => act(big, 'folder')} {...hover('Show this capture in File Explorer')}>
                <IconFolder size={20} stroke={1.8} aria-hidden="true" />
                Folder
              </button>
            </div>
          ) : null}
          <p className="cap-brief" role="status">
            {brief ?? ''}
          </p>
        </div>
        <div className="cap-rows" role="group" aria-label="Earlier captures">
          {rows.map((c) => {
            const word = kindWord(c);
            const when = formatWhen(c.time);
            const detail = c.exists ? [when, word].filter(Boolean).join(' · ') : GONE;
            const label = c.app || c.title || c.fileName;
            return (
              <button
                key={c.id}
                type="button"
                className={`cap-row${c.exists ? '' : ' gone'}`}
                onClick={() => setPicked(c.id)}
                {...hover(c.exists ? `Show "${c.title || c.fileName}" large` : `${GONE}. Show it large.`)}
              >
                <Pic c={c} w={96} h={54} large={false} />
                <span className="cap-rt">
                  <b>{label}</b>
                  <span>{detail}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <section className="shelf-card shelf-captures" aria-label="Captures">
      <div className="k">
        <IconCamera size={22} stroke={1.8} aria-hidden="true" /> Captures <span className="shelf-sub">ShareX, newest first</span>
      </div>
      {body}
    </section>
  );
}
