import { invoke } from './tauri';

/** One dictation as Rust describes it: text only, never audio. `id` is Wispr Flow's own entry id. */
export interface Dictation {
  id: string;
  /** RFC 3339, or null when the stored time could not be read. */
  at: string | null;
  app: string;
  /** The cleaned text (the user's own edit when there is one). */
  clean: string;
  /** What was said, before the AI pass. */
  raw: string;
  words: number;
}

/** The words Rust answers with when it cannot give a list. */
export type DictationError = 'not-installed' | 'no-history' | 'changed' | 'busy' | 'failed';

/** Which text a copy puts on the clipboard. */
export type DictationText = 'clean' | 'raw';

/** The newest dictations, newest first. Rejects with one of the error words. */
export function readDictations(): Promise<Dictation[]> {
  return invoke<Dictation[]>('wall2_dictations');
}

/** Puts one dictation's text on the clipboard; Rust re-reads it by id, the page never sends the text. */
export function copyDictation(id: string, which: DictationText): Promise<void> {
  return invoke<void>('wall2_dictation_copy', { id, which });
}

/** The error word in a rejection; anything not recognised is `failed`. */
export function dictationError(e: unknown): DictationError {
  const word = e instanceof Error ? e.message : String(e);
  return word === 'not-installed' || word === 'no-history' || word === 'changed' || word === 'busy' ? word : 'failed';
}
