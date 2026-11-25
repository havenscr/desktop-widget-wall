import { SHADER_CAP, type SkyColours } from './palette';
import type { SkyStyle } from './settings';

/**
 * The animated sky's two fragment programs, ported from the picked prototypes. Both draw the sky above
 * the horizon only, share one canvas, one WebGL context, one full screen triangle and one set of
 * uniforms, and switching style swaps the program bound (`setStyle`), never the context.
 *
 * The output is premultiplied (the canvas default): colour with alpha at its brightest channel, so
 * the browser's plain alpha compositing over the sky below gives nearly the prototypes' screen blend.
 * A soft ceiling (`SHADER_CAP`, the same number the legibility check reads) keeps any drift of the
 * form from making a bright patch.
 */
export const VERTEX = 'attribute vec2 a; void main(){ gl_Position = vec4(a, 0.0, 1.0); }';

const HEAD = [
  'precision highp float;',
  'uniform vec2 u_res; uniform float u_t; uniform vec3 u_a; uniform vec3 u_b; uniform vec3 u_c; uniform float u_gain; uniform float u_hz;',
  'float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }',
  'float noise(vec2 p){ vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);',
  '  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y); }',
  'float fbm(vec2 p){ float v = 0.0; float a = 0.5; for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.03 + vec2(17.1, 9.2); a *= 0.5; } return v; }',
].join('\n');

/** The end of every program: gain, the soft ceiling, then premultiplied alpha. */
const TAIL = [
  `const float CAP = ${SHADER_CAP.toFixed(3)};`,
  'vec4 finish(vec3 col){ col = max(col * u_gain, 0.0); col = CAP * (1.0 - exp(-col / CAP));',
  '  return vec4(col, max(col.r, max(col.g, col.b))); }',
].join('\n');

export const FRAGMENT: Record<SkyStyle, string> = {
  // Soft vertical curtains that sway and fold. `y` is 0 at the page's horizon and 1 at the top of the sky.
  aurora: [
    'void main(){ vec2 uv = gl_FragCoord.xy / u_res; float x = uv.x * 5.07; float y = (uv.y - u_hz) / (1.0 - u_hz); vec3 col = vec3(0.0);',
    '  for (int i = 0; i < 3; i++) { float fi = float(i);',
    '    float bend = fbm(vec2(x * 0.35 + fi * 3.1, u_t * 0.02 + fi));',
    '    float base = 0.2 + 0.13 * fi + 0.4 * (bend - 0.5);',
    '    float xx = x + 0.35 * sin(y * 2.0 + u_t * 0.05 + fi * 2.0);',
    '    float rays = noise(vec2(xx * 9.0 + fi * 7.0, u_t * 0.06 + fi * 3.0)) * 0.6 + noise(vec2(xx * 31.0, u_t * 0.11 + fi)) * 0.4;',
    '    float h = y - base;',
    '    float env = smoothstep(-0.03, 0.04, h) * exp(-max(h, 0.0) * (2.6 + 3.2 * rays));',
    '    float band = smoothstep(0.38, 0.72, fbm(vec2(x * 0.6 + fi * 5.0 - u_t * 0.015, fi * 2.0 + u_t * 0.01)));',
    '    vec3 c = mix(u_a, u_b, clamp(h * 2.4, 0.0, 1.0)); c = mix(c, u_c, clamp(h * 3.2 - 0.8, 0.0, 1.0));',
    '    col += c * env * band * (0.4 + 0.8 * rays); }',
    '  col *= smoothstep(0.0, 0.06, y);',
    '  gl_FragColor = finish(col * 0.9); }',
  ].join('\n'),
  // Slow liquid colour, like ink turning in water. It thins toward the horizon so the ridge sits on a quiet band.
  wash: [
    'void main(){ vec2 uv = gl_FragCoord.xy / u_res; float y = clamp((uv.y - u_hz) / (1.0 - u_hz), 0.0, 1.0);',
    '  vec2 p = vec2(uv.x * 5.07, y) * 1.3; float t = u_t * 0.03;',
    '  vec2 q = vec2(fbm(p + vec2(0.0, t)), fbm(p + vec2(5.2, 1.3) - t));',
    '  vec2 r = vec2(fbm(p + 3.0 * q + vec2(1.7, 9.2) + 0.6 * t), fbm(p + 3.0 * q + vec2(8.3, 2.8) - 0.5 * t));',
    '  float f = fbm(p + 3.0 * r);',
    '  vec3 col = mix(u_a, u_b, clamp(f * f * 2.6, 0.0, 1.0));',
    '  col = mix(col, u_c, clamp(length(q) * 1.1 - 0.35, 0.0, 1.0) * 0.85);',
    '  col *= 0.12 + 2.2 * f * f * f + 0.55 * r.x * r.x;',
    '  col *= mix(1.0, 0.6, y) * mix(0.55, 1.0, smoothstep(0.0, 0.3, y));',
    '  gl_FragColor = finish(col * 0.8); }',
  ].join('\n'),
};

/** The full source of a style's fragment program. */
export const fragmentSource = (style: SkyStyle): string => `${HEAD}\n${TAIL}\n${FRAGMENT[style]}`;

const STYLES: readonly SkyStyle[] = ['wash', 'aurora'];
const UNIFORMS = ['u_res', 'u_t', 'u_a', 'u_b', 'u_c', 'u_gain', 'u_hz'] as const;
type UniformName = (typeof UNIFORMS)[number];

export interface SkyShader {
  /** Bind the style's program. The context and the triangle stay. */
  setStyle: (style: SkyStyle) => void;
  /** Size the drawing buffer and the viewport. */
  resize: (width: number, height: number) => void;
  /** Draw one frame at time `t` (seconds): the colours, the total gain, and the horizon as a fraction of the canvas height up from its foot. */
  draw: (t: number, colours: SkyColours, gain: number, horizon: number) => void;
  /** Release the programs and the buffer. */
  dispose: () => void;
}

/**
 * The one context for the whole app. `lost` is called if the browser takes it away (the sky then turns itself off for the session).
 * Returns null when no context can be made or a program does not compile.
 */
export function createShader(canvas: HTMLCanvasElement, lost: () => void): SkyShader | null {
  let gl: WebGLRenderingContext | null = null;
  try {
    gl = canvas.getContext('webgl', { antialias: false, alpha: true, premultipliedAlpha: true, depth: false, stencil: false, preserveDrawingBuffer: false, powerPreference: 'low-power' }) as WebGLRenderingContext | null;
  } catch {
    gl = null;
  }
  if (!gl) return null;
  const g = gl;
  const compile = (type: number, source: string): WebGLShader | null => {
    const s = g.createShader(type);
    if (!s) return null;
    g.shaderSource(s, source);
    g.compileShader(s);
    if (g.getShaderParameter(s, g.COMPILE_STATUS)) return s;
    g.deleteShader(s);
    return null;
  };
  const vs = compile(g.VERTEX_SHADER, VERTEX);
  const programs = {} as Record<SkyStyle, WebGLProgram>;
  const locs = {} as Record<SkyStyle, Record<UniformName, WebGLUniformLocation | null>>;
  const shaders: WebGLShader[] = vs ? [vs] : [];
  const made: WebGLProgram[] = [];
  let buffer: WebGLBuffer | null = null;
  // Whatever was made before a failure is released, so a failed start leaves nothing behind.
  const release = () => {
    for (const p of made) g.deleteProgram(p);
    for (const sh of shaders) g.deleteShader(sh);
    if (buffer) g.deleteBuffer(buffer);
  };
  for (const style of STYLES) {
    const fs = compile(g.FRAGMENT_SHADER, fragmentSource(style));
    if (fs) shaders.push(fs);
    const p = vs && fs ? g.createProgram() : null;
    if (!vs || !fs || !p) {
      release();
      return null;
    }
    made.push(p);
    g.attachShader(p, vs);
    g.attachShader(p, fs);
    g.bindAttribLocation(p, 0, 'a');
    g.linkProgram(p);
    if (!g.getProgramParameter(p, g.LINK_STATUS)) {
      release();
      return null;
    }
    programs[style] = p;
    const l = {} as Record<UniformName, WebGLUniformLocation | null>;
    for (const name of UNIFORMS) l[name] = g.getUniformLocation(p, name);
    locs[style] = l;
  }
  // One full screen triangle. No buffer is a failure: the sky stays off.
  buffer = g.createBuffer();
  if (!buffer) {
    release();
    return null;
  }
  g.bindBuffer(g.ARRAY_BUFFER, buffer);
  g.bufferData(g.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), g.STATIC_DRAW);
  g.enableVertexAttribArray(0);
  g.vertexAttribPointer(0, 2, g.FLOAT, false, 0, 0);
  g.disable(g.DEPTH_TEST);
  g.disable(g.BLEND);
  g.clearColor(0, 0, 0, 0);

  let style: SkyStyle = 'wash';
  let width = canvas.width;
  let height = canvas.height;
  g.useProgram(programs[style]);
  const onLost = (e: Event) => {
    e.preventDefault();
    lost();
  };
  canvas.addEventListener('webglcontextlost', onLost);

  return {
    setStyle: (next) => {
      if (next === style) return;
      style = next;
      g.useProgram(programs[style]);
    },
    resize: (w, h) => {
      width = w;
      height = h;
      if (canvas.width !== w) canvas.width = w;
      if (canvas.height !== h) canvas.height = h;
      g.viewport(0, 0, w, h);
    },
    draw: (t, c, gain, horizon) => {
      const u = locs[style];
      g.clear(g.COLOR_BUFFER_BIT);
      g.uniform2f(u.u_res, width, height);
      g.uniform1f(u.u_t, t);
      g.uniform3f(u.u_a, c.a[0], c.a[1], c.a[2]);
      g.uniform3f(u.u_b, c.b[0], c.b[1], c.b[2]);
      g.uniform3f(u.u_c, c.c[0], c.c[1], c.c[2]);
      g.uniform1f(u.u_gain, gain);
      g.uniform1f(u.u_hz, horizon);
      g.drawArrays(g.TRIANGLES, 0, 3);
    },
    dispose: () => {
      canvas.removeEventListener('webglcontextlost', onLost);
      for (const style of STYLES) g.deleteProgram(programs[style]);
      for (const s of shaders) g.deleteShader(s);
      g.deleteBuffer(buffer);
      // The context itself is left to go with its canvas: losing it here would make the next mount's getContext (a strict mode remount in development) return a dead one.
    },
  };
}
