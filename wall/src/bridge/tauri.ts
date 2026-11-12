import { invoke as tauriInvoke } from '@tauri-apps/api/core';

export type CommandArgs = Record<string, unknown>;
export type MockHandler = (args?: CommandArgs) => unknown | Promise<unknown>;

/** Mock table used in a plain browser. Tests and dev code fill it. */
export const mocks = new Map<string, MockHandler>();

export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export async function invoke<T>(command: string, args?: CommandArgs): Promise<T> {
  if (isTauri()) return tauriInvoke<T>(command, args);
  const handler = mocks.get(command);
  if (!handler) {
    throw new Error(`No mock registered for command "${command}" (not running inside Tauri)`);
  }
  return (await handler(args)) as T;
}
