/** Test helper: a 2D context that accepts every call. Gradients take colour stops; patterns and image data are inert. */
export function stubContext(): CanvasRenderingContext2D {
  const gradient = () => ({ addColorStop() {} });
  const methods: Record<string, unknown> = {
    createLinearGradient: gradient,
    createRadialGradient: gradient,
    createPattern: () => ({}),
    createImageData: () => ({ data: new Uint8ClampedArray(160 * 160 * 4) }),
  };
  return new Proxy({} as Record<string, unknown>, {
    get: (store, key: string) => (key in store ? store[key] : (methods[key] ?? (() => {}))),
    set: (store, key: string, value) => {
      store[key] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}
