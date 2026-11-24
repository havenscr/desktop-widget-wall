import { describe, expect, it, vi } from 'vitest';
import { createSkyColours } from './palette';
import { FRAGMENT, createShader, fragmentSource } from './shader';

/** A stand-in for the browser's graphics context that records what the shell asks of it. */
function stubGl(opts: { compiles?: boolean; buffer?: boolean } = {}) {
  const calls: Record<string, number> = {};
  const count = (n: string) => (calls[n] = (calls[n] ?? 0) + 1);
  const sources: string[] = [];
  const programs: object[] = [];
  const used: object[] = [];
  const lose = vi.fn();
  const gl: Record<string, unknown> = {
    VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, COMPILE_STATUS: 3, LINK_STATUS: 4, ARRAY_BUFFER: 5, STATIC_DRAW: 6, FLOAT: 7, DEPTH_TEST: 8, BLEND: 9, TRIANGLES: 10, COLOR_BUFFER_BIT: 11,
    createShader: () => ({}),
    shaderSource: (_s: unknown, src: string) => sources.push(src),
    compileShader: () => count('compile'),
    getShaderParameter: () => opts.compiles !== false,
    createProgram: () => {
      const p = {};
      programs.push(p);
      return p;
    },
    attachShader: () => {}, bindAttribLocation: () => {}, linkProgram: () => {},
    getProgramParameter: () => true,
    getUniformLocation: (_p: unknown, name: string) => name,
    createBuffer: () => (opts.buffer === false ? null : {}), bindBuffer: () => {}, bufferData: () => {}, enableVertexAttribArray: () => {}, vertexAttribPointer: () => {},
    disable: () => {}, clearColor: () => {}, viewport: () => {}, clear: () => {},
    useProgram: (p: object) => {
      used.push(p);
      count('useProgram');
    },
    uniform1f: () => count('uniform'), uniform2f: () => count('uniform'), uniform3f: () => count('uniform'),
    drawArrays: () => count('draw'),
    deleteProgram: () => count('deleteProgram'), deleteShader: () => count('deleteShader'), deleteBuffer: () => count('deleteBuffer'),
    getExtension: () => ({ loseContext: lose }),
  };
  return { gl, calls, sources, programs, used, lose };
}

function canvasWith(gl: unknown) {
  const getContext = vi.fn(() => gl);
  const el = document.createElement('canvas');
  (el as unknown as { getContext: unknown }).getContext = getContext;
  return { el, getContext };
}

describe('sky shader', () => {
  it('compiles both programs from sources that name every uniform and the shared ceiling', () => {
    const s = stubGl();
    const { el } = canvasWith(s.gl);
    expect(createShader(el, () => {})).not.toBeNull();
    // One vertex shader and two fragment programs.
    expect(s.sources).toHaveLength(3);
    for (const style of ['wash', 'aurora'] as const) {
      const src = fragmentSource(style);
      expect(src).toContain(FRAGMENT[style]);
      for (const u of ['u_res', 'u_t', 'u_a', 'u_b', 'u_c', 'u_gain', 'u_hz', 'CAP']) expect(src).toContain(u);
    }
  });

  it('returns null when there is no context or a program does not compile', () => {
    expect(createShader(canvasWith(null).el, () => {})).toBeNull();
    expect(createShader(canvasWith(stubGl({ compiles: false }).gl).el, () => {})).toBeNull();
  });

  it('a missing buffer is a failure, and whatever was made before a failure is released', () => {
    const s = stubGl({ buffer: false });
    expect(createShader(canvasWith(s.gl).el, () => {})).toBeNull();
    expect(s.calls.deleteProgram).toBe(2);
    expect(s.calls.deleteShader).toBe(3);
    const c = stubGl({ compiles: false });
    expect(createShader(canvasWith(c.gl).el, () => {})).toBeNull();
    expect(c.calls.deleteProgram ?? 0).toBe(0);
  });

  it('sets each uniform once per draw and makes one context for any number of draws and style swaps', () => {
    const s = stubGl();
    const { el, getContext } = canvasWith(s.gl);
    const sh = createShader(el, () => {})!;
    sh.resize(320, 64);
    const before = s.calls.uniform ?? 0;
    sh.draw(1, createSkyColours(), 0.5, 0.2);
    expect((s.calls.uniform ?? 0) - before).toBe(7);
    sh.setStyle('aurora');
    sh.draw(2, createSkyColours(), 0.5, 0.2);
    sh.setStyle('wash');
    expect(s.calls.draw).toBe(2);
    expect(getContext).toHaveBeenCalledTimes(1);
  });

  it('setStyle swaps the program and does nothing for the style already bound', () => {
    const s = stubGl();
    const sh = createShader(canvasWith(s.gl).el, () => {})!;
    const before = s.calls.useProgram;
    sh.setStyle('wash');
    expect(s.calls.useProgram).toBe(before);
    sh.setStyle('aurora');
    expect(s.calls.useProgram).toBe(before + 1);
    expect(s.used[s.used.length - 1]).toBe(s.programs[1]);
  });

  it('dispose releases the programs and the buffer, and stops listening for its loss', () => {
    const s = stubGl();
    const lost = vi.fn();
    const { el } = canvasWith(s.gl);
    const sh = createShader(el, lost)!;
    el.dispatchEvent(new Event('webglcontextlost'));
    expect(lost).toHaveBeenCalledTimes(1);
    sh.dispose();
    expect(s.calls.deleteProgram).toBe(2);
    expect(s.calls.deleteBuffer).toBe(1);
    expect(s.lose).not.toHaveBeenCalled();
    el.dispatchEvent(new Event('webglcontextlost'));
    expect(lost).toHaveBeenCalledTimes(1);
  });
});
