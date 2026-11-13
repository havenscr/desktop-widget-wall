import { invoke } from '../bridge/tauri';

/**
 * Opens a session in the OmniGent desktop app and brings its window forward on the main
 * monitor; with no id it only brings OmniGent forward. Rust checks the id against the last
 * good summary. A refusal changes nothing on the wall.
 */
export function focusSession(id?: string | null): void {
  invoke('wall2_focus_omnigent', { id: id ?? null }).catch(() => undefined);
}
