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

/**
 * Test helper: a 2D context that accepts every call like `stubContext` and also writes each
 * method call and property set to `log`, one line each, in order. Gradients log their colour
 * stops. Two draws that make the same canvas calls produce equal logs.
 */
export function recordingContext(): { ctx: CanvasRenderingContext2D; log: string[] } {
  const log: string[] = [];
  let gradients = 0;
  const show = (v: unknown): string =>
    typeof v === 'object' && v !== null && 'id' in v ? `[${String((v as { id: unknown }).id)}]` : typeof v === 'object' ? '[object]' : String(v);
  const gradient = (kind: string) => (...args: unknown[]) => {
    const id = `${kind}${gradients++}`;
    log.push(`${kind}(${args.map(show).join(',')})=${id}`);
    return { id, addColorStop: (o: number, c: string) => void log.push(`${id}.stop(${o},${c})`) };
  };
  const methods: Record<string, unknown> = {
    createLinearGradient: gradient('linear'),
    createRadialGradient: gradient('radial'),
    createPattern: () => ({ id: 'pattern' }),
    createImageData: () => ({ data: new Uint8ClampedArray(160 * 160 * 4) }),
  };
  const ctx = new Proxy({} as Record<string, unknown>, {
    get: (store, key: string) => {
      if (key in store) return store[key];
      if (key in methods) return methods[key];
      return (...args: unknown[]) => void log.push(`${key}(${args.map(show).join(',')})`);
    },
    set: (store, key: string, value) => {
      store[key] = value;
      log.push(`${key}=${show(value)}`);
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, log };
}
