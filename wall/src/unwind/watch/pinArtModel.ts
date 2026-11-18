/**
 * The one seam every pin picture passes through before it is drawn. It is the identity here; the development mock
 * replaces it to draw a picture from the address, so no review page or test loads a picture host.
 */
export const pinArt = {
  src: (address: string): string => address,
};

/** Addresses that failed to load this session: their pin falls back to the gradient and glyph, with no badge. */
const failed = new Set<string>();

export function artFailed(address: string): boolean {
  return failed.has(address);
}

export function markArtFailed(address: string): void {
  failed.add(address);
}

/** Tests only. */
export function resetArtFailed(): void {
  failed.clear();
}
