import { IconFolder } from '@tabler/icons-react';
import { invoke } from '../bridge/tauri';
import { hover } from '../tools/hover';
import { tip } from '../ui/HoverTip';
import { useBrief } from '../work/useBrief';
import { recentWhen, useRecentFiles } from './recent';

/** Words for a failed Open or Folder, by Rust's answer. */
function failure(e: unknown): string {
  const word = e instanceof Error ? e.message : String(e);
  return word === 'missing' ? 'File moved or deleted' : 'Could not do that';
}

/** The Shelf's Recent files card: the last five files opened, newest first. A row opens the file; its Folder button shows it in File Explorer. */
export function RecentCard() {
  const { status, items } = useRecentFiles();
  const [brief, show] = useBrief();
  const act = (command: 'wall2_recent_open' | 'wall2_recent_folder', id: string, done: string) => {
    invoke(command, { id }).then(
      () => show(done),
      (e: unknown) => show(failure(e)),
    );
  };

  let body;
  if (status === 'error') body = <p className="shelf-note">Recent files unavailable</p>;
  else if (status === 'ready' && items.length === 0) body = <p className="shelf-note">No recent files</p>;
  else if (status === 'loading') body = null;
  else {
    body = (
      <ul className="rf-rows">
        {items.map((f) => (
          <li key={f.id} className="rf-row">
            <button type="button" className="rf-open" onClick={() => act('wall2_recent_open', f.id, 'Opened')} {...hover(`Open "${f.name}" in its default app`)}>
              <span className="rf-name">{f.name}</span>
              <span className="rf-when">{recentWhen(f.modified)}</span>
            </button>
            <button type="button" className="rf-folder" aria-label={`Show ${f.name} in File Explorer`} onClick={() => act('wall2_recent_folder', f.id, 'Shown in File Explorer')} {...tip('Show in File Explorer')}>
              <IconFolder size={20} stroke={1.8} aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <section className="shelf-card rf-card" aria-label="Recent files">
      <div className="k">
        Recent files{' '}
        <span className="shelf-sub" role="status">
          {brief ?? (status === 'ready' && items.length > 0 ? `last ${items.length} opened` : 'last opened')}
        </span>
      </div>
      {body}
    </section>
  );
}
