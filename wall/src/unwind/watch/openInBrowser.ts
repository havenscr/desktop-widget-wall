import { invoke } from '../../bridge/tauri';
import { validRef, type WatchRef } from './links';

/**
 * Ask the wall to open this item on its own site; the kind and id are checked here and again
 * in Rust, which builds the normal watch address. A video may also pass the whole seconds the
 * player last reported (`at`), which Rust checks and formats. Nothing else is ever sent.
 */
export async function openInBrowser(ref: WatchRef, at?: number | null): Promise<boolean> {
  if (!validRef({ kind: ref.kind, id: ref.id })) return false;
  const t = ref.kind === 'video' && typeof at === 'number' && Number.isFinite(at) ? Math.floor(at) : 0;
  try {
    await invoke('wall2_watch_open', t > 0 ? { kind: ref.kind, id: ref.id, at: t } : { kind: ref.kind, id: ref.id });
    return true;
  } catch {
    return false;
  }
}
