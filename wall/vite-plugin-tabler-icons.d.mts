import type { Plugin } from 'vite';
export const VIRTUAL_ID: string;
export function encodeIcon(nodes: [string, Record<string, string>][]): string;
export function encodeSet(set: Record<string, [string, Record<string, string>][]>): Record<string, string>;
export function tablerIconData(): Plugin;
