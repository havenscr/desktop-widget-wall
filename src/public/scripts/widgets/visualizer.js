/* ================================================================
   MUSIC VISUALIZER WIDGET - MilkDrop + Circular
   Three.js based audio-reactive visualization
   Copyright (c) 2024-2025 Havens Consulting Inc. All Rights Reserved.
   Fingerprint: AE-WWD-8B4F2C1E | analyticendeavors.com
   ================================================================ */

(function() {
  let animationId = null;
  let isInitialized = false;
  let visualizerTauriAvailable = false;
  let audioSourceMode = 'demo'; // 'demo' or 'native'
  let currentDeviceId = 'demo';
  let nativeAudioInterval = null;
  let nativeSamples = [];
  let demoPhase = 0;

  // Visualizer display mode (milkdrop, circular)
  let currentDisplayMode = '';

  // Audio levels for visualization
  let audioLevels = { bass: 0, mid: 0, high: 0 };
  let smoothedLevels = { bass: 0, mid: 0, high: 0 };

  // MilkDrop shader visualizer
  let milkdropScene, milkdropCamera, milkdropRenderer, milkdropMesh;
  let milkdropTime = 0;

  // Circular visualizer (Three.js)
  let circularScene, circularCamera, circularRenderer;
  let circularCore, circularRing, circularGlowRing, circularTorus, circularParticles;
  let circularRingGeometry, circularWaveformGeometry, circularWaveformGlow;

  // Lazy initialization flags
  let circularInitialized = false;
  let milkdropInitialized = false;
  let poweraudioInitialized = false;

  // PowerAudio visualizer (the cute creature)
  let poweraudioViz = null;

  // Frame rate limiting (30fps for performance)
  const targetFPS = 30;
  const frameInterval = 1000 / targetFPS;
  let lastFrameTime = 0;

  // Background config (applies to all visualizer modes)
  let visualizerBgConfig = {
    background: 'none',
    customSvg: null,
    svgBlur: 0
  };

  // MilkDrop config
  let milkdropConfig = {
    speed: 1.0,
    intensity: 2.5,
    complexity: 6,
    glow: 0.2
  };

  // Circular config
  let circularConfig = {
    ringPoints: 64,
    glow: 0.6,
    rotation: 1.0,
    particles: 50,
    sensitivity: 1.5
  };

  // MilkDrop presets - 12 different shader effects
  let currentPresetIndex = 0;
  const milkdropPresets = [
    {
      name: 'Cosmic Swirl',
      shader: `
        uniform float time;
        uniform float bassLevel;
        uniform float midLevel;
        uniform float highLevel;
        uniform vec3 color1;
        uniform vec3 color2;
        uniform vec3 color3;
        uniform vec2 resolution;
        uniform float speed;
        uniform float intensity;
        uniform float complexity;
        uniform float glowAmount;

        void main() {
          vec2 uv = gl_FragCoord.xy / resolution;
          vec2 p = uv * 2.0 - 1.0;
          p.x *= resolution.x / resolution.y;
          float r = length(p);
          float a = atan(p.y, p.x);
          float t = time * speed;
          float freq = complexity;
          float swirl = sin(r * freq * 1.5 - t * 2.0 + bassLevel * 5.0 * intensity) * 0.5 + 0.5;
          float spiral = sin(a * freq + r * freq * 1.2 - t * 3.0) * 0.5 + 0.5;
          float pulse = sin(r * freq * 2.0 - t * 4.0 + midLevel * 8.0 * intensity) * 0.5 + 0.5;
          float wave1 = sin(r * freq * 3.0 - t * 2.0 + bassLevel * 10.0 * intensity);
          float wave2 = sin(r * freq * 2.5 + t * 1.5 - midLevel * 5.0 * intensity);
          float wave3 = cos(a * freq * 1.2 + t * 2.0 + highLevel * 6.0 * intensity);
          float k = sin(a * freq + sin(r * freq * 1.5 + t) * (1.0 + bassLevel * intensity));
          float pattern = swirl * 0.3 + spiral * 0.3 + pulse * 0.2 + k * 0.2;
          pattern += wave1 * 0.15 + wave2 * 0.15 + wave3 * 0.1;
          vec3 col = mix(color1, color2, pattern);
          col = mix(col, color3, sin(r * 5.0 + t) * 0.5 + 0.5);
          col *= 0.6 + bassLevel * 0.3 * intensity + midLevel * 0.2 * intensity;
          float vignette = 1.0 - r * 0.5;
          col *= vignette;
          col += color3 * bassLevel * glowAmount * (1.0 - r);
          gl_FragColor = vec4(col, 1.0);
        }
      `
    },
    {
      name: 'Plasma Tunnel',
      shader: `
        uniform float time;
        uniform float bassLevel;
        uniform float midLevel;
        uniform float highLevel;
        uniform vec3 color1;
        uniform vec3 color2;
        uniform vec3 color3;
        uniform vec2 resolution;
        uniform float speed;
        uniform float intensity;
        uniform float complexity;
        uniform float glowAmount;

        void main() {
          vec2 uv = gl_FragCoord.xy / resolution;
          vec2 p = uv * 2.0 - 1.0;
          p.x *= resolution.x / resolution.y;
          float t = time * speed;
          float r = length(p);
          float a = atan(p.y, p.x);
          float tunnel = 1.0 / (r + 0.1);
          float twist = a + tunnel * 0.5 + t;
          float plasma1 = sin(twist * complexity + t * 2.0 + bassLevel * 10.0 * intensity);
          float plasma2 = sin(tunnel * complexity * 2.0 - t * 3.0 + midLevel * 8.0 * intensity);
          float plasma3 = cos(twist * complexity * 0.5 + tunnel * 2.0 + highLevel * 6.0 * intensity);
          float pattern = (plasma1 + plasma2 + plasma3) / 3.0 * 0.5 + 0.5;
          vec3 col = mix(color1, color2, pattern);
          col = mix(col, color3, plasma3 * 0.5 + 0.5);
          col *= 0.5 + bassLevel * 0.4 * intensity + midLevel * 0.3 * intensity;
          col *= 1.0 - r * 0.3;
          col += color1 * bassLevel * glowAmount * 0.5;
          gl_FragColor = vec4(col, 1.0);
        }
      `
    },
    {
      name: 'Kaleidoscope',
      shader: `
        uniform float time;
        uniform float bassLevel;
        uniform float midLevel;
        uniform float highLevel;
        uniform vec3 color1;
        uniform vec3 color2;
        uniform vec3 color3;
        uniform vec2 resolution;
        uniform float speed;
        uniform float intensity;
        uniform float complexity;
        uniform float glowAmount;

        void main() {
          vec2 uv = gl_FragCoord.xy / resolution;
          vec2 p = uv * 2.0 - 1.0;
          p.x *= resolution.x / resolution.y;
          float t = time * speed;
          float a = atan(p.y, p.x);
          float segments = floor(complexity) + 2.0;
          a = mod(a, 3.14159 * 2.0 / segments);
          a = abs(a - 3.14159 / segments);
          float r = length(p);
          vec2 kp = vec2(cos(a), sin(a)) * r;
          float wave1 = sin(kp.x * 10.0 + t * 2.0 + bassLevel * 8.0 * intensity);
          float wave2 = sin(kp.y * 10.0 - t * 1.5 + midLevel * 6.0 * intensity);
          float wave3 = sin(r * 8.0 - t * 3.0 + highLevel * 4.0 * intensity);
          float pattern = (wave1 + wave2 + wave3) / 3.0 * 0.5 + 0.5;
          vec3 col = mix(color1, color2, pattern);
          col = mix(col, color3, wave3 * 0.5 + 0.5);
          col *= 0.6 + bassLevel * 0.35 * intensity;
          col *= 1.0 - r * 0.4;
          col += color2 * bassLevel * glowAmount * (1.0 - r * 0.5);
          gl_FragColor = vec4(col, 1.0);
        }
      `
    },
    {
      name: 'Electric Waves',
      shader: `
        uniform float time;
        uniform float bassLevel;
        uniform float midLevel;
        uniform float highLevel;
        uniform vec3 color1;
        uniform vec3 color2;
        uniform vec3 color3;
        uniform vec2 resolution;
        uniform float speed;
        uniform float intensity;
        uniform float complexity;
        uniform float glowAmount;

        void main() {
          vec2 uv = gl_FragCoord.xy / resolution;
          vec2 p = uv * 2.0 - 1.0;
          p.x *= resolution.x / resolution.y;
          float t = time * speed;
          float wave = sin(p.y * complexity * 2.0 + t * 3.0 + bassLevel * 10.0 * intensity) * 0.1;
          p.x += wave * (1.0 + midLevel * intensity);
          float lines = 0.0;
          for (float i = 0.0; i < 5.0; i++) {
            float offset = sin(t + i * 1.5) * 0.3;
            float lineY = (i - 2.0) * 0.3 + offset + sin(t * 2.0 + i) * highLevel * 0.2 * intensity;
            float dist = abs(p.y - lineY);
            lines += 0.02 / (dist + 0.02) * (0.5 + bassLevel * intensity);
          }
          float bg = sin(p.x * 5.0 + t) * sin(p.y * 5.0 - t) * 0.2 + 0.3;
          vec3 col = color1 * lines;
          col += color2 * bg;
          col = mix(col, color3, lines * 0.3);
          col += color3 * bassLevel * glowAmount * lines * 0.5;
          gl_FragColor = vec4(col, 1.0);
        }
      `
    },
    {
      name: 'Fractal Pulse',
      shader: `
        uniform float time;
        uniform float bassLevel;
        uniform float midLevel;
        uniform float highLevel;
        uniform vec3 color1;
        uniform vec3 color2;
        uniform vec3 color3;
        uniform vec2 resolution;
        uniform float speed;
        uniform float intensity;
        uniform float complexity;
        uniform float glowAmount;

        void main() {
          vec2 uv = gl_FragCoord.xy / resolution;
          vec2 p = uv * 2.0 - 1.0;
          p.x *= resolution.x / resolution.y;
          float t = time * speed;
          float zoom = 2.0 + sin(t + bassLevel * 5.0 * intensity) * 0.5;
          p *= zoom;
          vec2 z = p;
          float iterations = 0.0;
          for (float i = 0.0; i < 8.0; i++) {
            z = vec2(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y);
            z += p * 0.5;
            z += vec2(sin(t + midLevel * intensity), cos(t * 0.7 + highLevel * intensity)) * 0.3;
            if (length(z) > 4.0) break;
            iterations++;
          }
          float pattern = iterations / 8.0;
          pattern = sin(pattern * 3.14159 * 2.0 + t) * 0.5 + 0.5;
          vec3 col = mix(color1, color2, pattern);
          col = mix(col, color3, sin(iterations + t) * 0.5 + 0.5);
          col *= 0.5 + bassLevel * 0.4 * intensity + midLevel * 0.2 * intensity;
          col += color1 * bassLevel * glowAmount * pattern;
          gl_FragColor = vec4(col, 1.0);
        }
      `
    },
    {
      name: 'Spiral Galaxy',
      shader: `
        uniform float time;
        uniform float bassLevel;
        uniform float midLevel;
        uniform float highLevel;
        uniform vec3 color1;
        uniform vec3 color2;
        uniform vec3 color3;
        uniform vec2 resolution;
        uniform float speed;
        uniform float intensity;
        uniform float complexity;
        uniform float glowAmount;

        void main() {
          vec2 uv = gl_FragCoord.xy / resolution;
          vec2 p = uv * 2.0 - 1.0;
          p.x *= resolution.x / resolution.y;
          float t = time * speed * 0.5;
          float r = length(p);
          float a = atan(p.y, p.x);
          float arms = floor(complexity * 0.5) + 2.0;
          float spiral = sin(a * arms + r * 8.0 - t * 3.0 + bassLevel * 6.0 * intensity);
          spiral = pow(abs(spiral), 0.5) * sign(spiral);
          float core = exp(-r * 3.0) * (1.0 + bassLevel * 2.0 * intensity);
          float dust = sin(a * 20.0 + r * 15.0 + t) * sin(r * 10.0 - t * 2.0);
          dust = dust * 0.5 + 0.5;
          dust *= exp(-r * 2.0);
          float stars = fract(sin(dot(p * 50.0, vec2(12.9898, 78.233))) * 43758.5453);
          stars = step(0.98, stars) * (1.0 - r * 0.5);
          vec3 col = color1 * core;
          col += color2 * spiral * 0.5 * (1.0 - r * 0.3);
          col += color3 * dust * midLevel * intensity;
          col += vec3(stars) * highLevel;
          col += color1 * glowAmount * core * bassLevel;
          gl_FragColor = vec4(col, 1.0);
        }
      `
    },
    {
      name: 'Neon Grid',
      shader: `
        uniform float time;
        uniform float bassLevel;
        uniform float midLevel;
        uniform float highLevel;
        uniform vec3 color1;
        uniform vec3 color2;
        uniform vec3 color3;
        uniform vec2 resolution;
        uniform float speed;
        uniform float intensity;
        uniform float complexity;
        uniform float glowAmount;

        void main() {
          vec2 uv = gl_FragCoord.xy / resolution;
          vec2 p = uv * 2.0 - 1.0;
          p.x *= resolution.x / resolution.y;
          float t = time * speed;
          float perspective = 1.0 / (p.y + 1.5);
          vec2 grid = vec2(p.x * perspective * 3.0, perspective * 2.0 - t);
          float gridX = abs(fract(grid.x * complexity) - 0.5) * 2.0;
          float gridY = abs(fract(grid.y * complexity * 0.5) - 0.5) * 2.0;
          float lineX = smoothstep(0.9, 1.0, gridX);
          float lineY = smoothstep(0.9, 1.0, gridY);
          float lines = max(lineX, lineY);
          lines *= perspective * 0.5;
          lines *= 1.0 + bassLevel * 2.0 * intensity;
          float horizon = smoothstep(0.0, 0.3, p.y + 0.8);
          float sun = length(p - vec2(0.0, 0.3));
          sun = smoothstep(0.3, 0.0, sun) * (1.0 + midLevel * intensity);
          vec3 col = color1 * lines;
          col += color2 * sun * 0.5;
          col += color3 * horizon * 0.2;
          col += color1 * glowAmount * lines * bassLevel;
          col = mix(col, color3 * 0.1, 1.0 - horizon);
          gl_FragColor = vec4(col, 1.0);
        }
      `
    },
    {
      name: 'Liquid Mirror',
      shader: `
        uniform float time;
        uniform float bassLevel;
        uniform float midLevel;
        uniform float highLevel;
        uniform vec3 color1;
        uniform vec3 color2;
        uniform vec3 color3;
        uniform vec2 resolution;
        uniform float speed;
        uniform float intensity;
        uniform float complexity;
        uniform float glowAmount;

        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
        }

        float noise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
                     mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
        }

        void main() {
          vec2 uv = gl_FragCoord.xy / resolution;
          vec2 p = uv * 2.0 - 1.0;
          p.x *= resolution.x / resolution.y;
          float t = time * speed;
          vec2 distort = vec2(
            noise(p * complexity + t) * 2.0 - 1.0,
            noise(p * complexity + t + 100.0) * 2.0 - 1.0
          );
          distort *= 0.3 * (1.0 + bassLevel * intensity);
          vec2 reflected = p + distort;
          float ripple = sin(length(reflected) * 10.0 - t * 4.0 + midLevel * 5.0 * intensity);
          ripple = ripple * 0.5 + 0.5;
          float shimmer = noise(p * 20.0 + t * 2.0) * highLevel * intensity;
          vec3 col = mix(color1, color2, ripple);
          col = mix(col, color3, length(distort) * 2.0);
          col += shimmer * color3;
          col *= 0.7 + bassLevel * 0.3 * intensity;
          col += color1 * glowAmount * bassLevel * (1.0 - length(p) * 0.5);
          gl_FragColor = vec4(col, 1.0);
        }
      `
    },
    {
      name: 'Starburst',
      shader: `
        uniform float time;
        uniform float bassLevel;
        uniform float midLevel;
        uniform float highLevel;
        uniform vec3 color1;
        uniform vec3 color2;
        uniform vec3 color3;
        uniform vec2 resolution;
        uniform float speed;
        uniform float intensity;
        uniform float complexity;
        uniform float glowAmount;

        void main() {
          vec2 uv = gl_FragCoord.xy / resolution;
          vec2 p = uv * 2.0 - 1.0;
          p.x *= resolution.x / resolution.y;
          float t = time * speed;
          float r = length(p);
          float a = atan(p.y, p.x);
          float rays = floor(complexity * 2.0) + 8.0;
          float ray = abs(sin(a * rays + t * 2.0));
          ray = pow(ray, 3.0 + bassLevel * 5.0 * intensity);
          ray *= exp(-r * 2.0);
          float pulse = sin(r * 20.0 - t * 8.0 + bassLevel * 10.0 * intensity);
          pulse = pulse * 0.5 + 0.5;
          pulse *= exp(-r * 3.0);
          float core = exp(-r * 5.0) * (1.0 + bassLevel * 3.0 * intensity);
          float halo = exp(-r * 1.5) * midLevel * intensity * 0.5;
          vec3 col = color1 * ray * 2.0;
          col += color2 * pulse;
          col += color3 * core;
          col += color1 * halo;
          col += color2 * glowAmount * core * bassLevel;
          gl_FragColor = vec4(col, 1.0);
        }
      `
    },
    {
      name: 'Waveform Rings',
      shader: `
        uniform float time;
        uniform float bassLevel;
        uniform float midLevel;
        uniform float highLevel;
        uniform vec3 color1;
        uniform vec3 color2;
        uniform vec3 color3;
        uniform vec2 resolution;
        uniform float speed;
        uniform float intensity;
        uniform float complexity;
        uniform float glowAmount;

        void main() {
          vec2 uv = gl_FragCoord.xy / resolution;
          vec2 p = uv * 2.0 - 1.0;
          p.x *= resolution.x / resolution.y;
          float t = time * speed;
          float r = length(p);
          float a = atan(p.y, p.x);
          float rings = 0.0;
          for (float i = 0.0; i < 5.0; i++) {
            float ringR = 0.2 + i * 0.15;
            float audio = (i < 2.0) ? bassLevel : (i < 4.0) ? midLevel : highLevel;
            float wave = sin(a * (complexity + i * 2.0) + t * (2.0 + i) + audio * 5.0 * intensity);
            float dist = abs(r - ringR - wave * 0.05 * (1.0 + audio * intensity));
            rings += smoothstep(0.02, 0.0, dist) * (1.0 + audio * intensity);
          }
          float core = exp(-r * 8.0) * (1.0 + bassLevel * 2.0 * intensity);
          vec3 col = color1 * rings * 0.5;
          col += color2 * core;
          col = mix(col, color3, rings * 0.2);
          col += color1 * glowAmount * rings * bassLevel * 0.3;
          gl_FragColor = vec4(col, 1.0);
        }
      `
    },
    {
      name: 'Plasma Ball',
      shader: `
        uniform float time;
        uniform float bassLevel;
        uniform float midLevel;
        uniform float highLevel;
        uniform vec3 color1;
        uniform vec3 color2;
        uniform vec3 color3;
        uniform vec2 resolution;
        uniform float speed;
        uniform float intensity;
        uniform float complexity;
        uniform float glowAmount;

        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
        }

        void main() {
          vec2 uv = gl_FragCoord.xy / resolution;
          vec2 p = uv * 2.0 - 1.0;
          p.x *= resolution.x / resolution.y;
          float t = time * speed;
          float r = length(p);
          float a = atan(p.y, p.x);
          float bolts = 0.0;
          for (float i = 0.0; i < 6.0; i++) {
            float angle = i * 1.047 + t * 0.5 + sin(t + i) * 0.5;
            vec2 boltDir = vec2(cos(angle), sin(angle));
            float boltDist = abs(dot(p, vec2(-boltDir.y, boltDir.x)));
            float along = dot(p, boltDir);
            float jitter = hash(vec2(floor(along * 20.0 + t * 10.0), i)) * 0.1;
            boltDist += jitter;
            float bolt = smoothstep(0.08, 0.0, boltDist);
            bolt *= smoothstep(0.0, 0.3, along) * smoothstep(1.0, 0.3, along);
            bolt *= 1.0 + bassLevel * 2.0 * intensity;
            bolts += bolt;
          }
          float sphere = smoothstep(0.3, 0.0, r) * 0.5;
          float glow = exp(-r * 2.0) * (0.3 + midLevel * 0.3 * intensity);
          vec3 col = color1 * bolts;
          col += color2 * sphere;
          col += color3 * glow;
          col += color1 * glowAmount * bolts * bassLevel * 0.5;
          gl_FragColor = vec4(col, 1.0);
        }
      `
    },
    {
      name: 'Northern Lights',
      shader: `
        uniform float time;
        uniform float bassLevel;
        uniform float midLevel;
        uniform float highLevel;
        uniform vec3 color1;
        uniform vec3 color2;
        uniform vec3 color3;
        uniform vec2 resolution;
        uniform float speed;
        uniform float intensity;
        uniform float complexity;
        uniform float glowAmount;

        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
        }

        float noise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
                     mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
        }

        void main() {
          vec2 uv = gl_FragCoord.xy / resolution;
          vec2 p = uv * 2.0 - 1.0;
          p.x *= resolution.x / resolution.y;
          float t = time * speed * 0.3;
          float aurora = 0.0;
          for (float i = 0.0; i < 4.0; i++) {
            float y = p.y + 0.3 + i * 0.1;
            float wave = noise(vec2(p.x * complexity + t + i * 10.0, t * 0.5)) * 0.3;
            wave += sin(p.x * 3.0 + t * 2.0 + i) * 0.1 * (1.0 + bassLevel * intensity);
            float band = smoothstep(0.15, 0.0, abs(y - wave));
            band *= 1.0 + ((i < 2.0) ? bassLevel : midLevel) * intensity;
            aurora += band * (1.0 - i * 0.2);
          }
          float stars = hash(floor(p * 100.0));
          stars = step(0.99, stars) * highLevel;
          vec3 col = mix(color1, color2, aurora);
          col = mix(col, color3, aurora * 0.5);
          col *= aurora;
          col += vec3(stars) * 0.5;
          col += color1 * glowAmount * aurora * bassLevel * 0.3;
          vec3 sky = mix(vec3(0.02, 0.01, 0.05), vec3(0.0, 0.02, 0.05), uv.y);
          col += sky * (1.0 - aurora * 0.5);
          gl_FragColor = vec4(col, 1.0);
        }
      `
    }
  ];

  // Check if running in Tauri
  function checkTauriAvailable() {
    return typeof window.__TAURI__ !== 'undefined';
  }

  // Get theme colors from CSS variables
  function getThemeColors() {
    const style = getComputedStyle(document.body);
    return {
      primary: style.getPropertyValue('--vis-color-1').trim() || '#00B8B8',
      secondary: style.getPropertyValue('--vis-color-2').trim() || '#009999',
      accent: style.getPropertyValue('--vis-color-3').trim() || '#4dfff3',
      glow: style.getPropertyValue('--accent-primary').trim() || '#00B8B8'
    };
  }

  // Convert hex color to Three.js Color
  function hexToThreeColor(hex) {
    return new THREE.Color(hex);
  }

  // ================================================================
  // MILKDROP SHADER VISUALIZER
  // ================================================================

  const milkdropVertexShader = `
    void main() {
      gl_Position = vec4(position, 1.0);
    }
  `;

  function getCurrentPresetShader() {
    return milkdropPresets[currentPresetIndex].shader;
  }

  function switchMilkdropPreset(index) {
    if (index < 0 || index >= milkdropPresets.length) {
      index = 0;
    }

    currentPresetIndex = index;
    const preset = milkdropPresets[index];
    console.log('Visualizer: Switching to preset:', preset.name);

    if (milkdropMesh && milkdropScene) {
      const container = document.getElementById('milkdrop-container');
      const pixelRatio = milkdropRenderer ? milkdropRenderer.getPixelRatio() : 1;
      const width = container ? container.clientWidth : 400;
      const height = container ? container.clientHeight : 300;
      const colors = getThemeColors();

      const newMaterial = new THREE.ShaderMaterial({
        vertexShader: milkdropVertexShader,
        fragmentShader: preset.shader,
        uniforms: {
          time: { value: milkdropMesh.material.uniforms.time.value },
          bassLevel: { value: milkdropMesh.material.uniforms.bassLevel.value },
          midLevel: { value: milkdropMesh.material.uniforms.midLevel.value },
          highLevel: { value: milkdropMesh.material.uniforms.highLevel.value },
          color1: { value: hexToThreeColor(colors.primary) },
          color2: { value: hexToThreeColor(colors.secondary) },
          color3: { value: hexToThreeColor(colors.accent) },
          resolution: { value: new THREE.Vector2(width * pixelRatio, height * pixelRatio) },
          speed: { value: milkdropConfig.speed },
          intensity: { value: milkdropConfig.intensity },
          complexity: { value: milkdropConfig.complexity },
          glowAmount: { value: milkdropConfig.glow }
        }
      });

      milkdropMesh.material.dispose();
      milkdropMesh.material = newMaterial;

      const presetSelect = document.getElementById('vis-config-md-preset');
      if (presetSelect && presetSelect.value !== String(index)) {
        presetSelect.value = String(index);
      }

      try {
        localStorage.setItem('milkdrop-preset-index', String(index));
      } catch (e) {}
    }
  }

  function nextMilkdropPreset() {
    const nextIndex = (currentPresetIndex + 1) % milkdropPresets.length;
    switchMilkdropPreset(nextIndex);
  }

  function prevMilkdropPreset() {
    const prevIndex = (currentPresetIndex - 1 + milkdropPresets.length) % milkdropPresets.length;
    switchMilkdropPreset(prevIndex);
  }

  function randomMilkdropPreset() {
    let randomIndex;
    do {
      randomIndex = Math.floor(Math.random() * milkdropPresets.length);
    } while (randomIndex === currentPresetIndex && milkdropPresets.length > 1);
    switchMilkdropPreset(randomIndex);
  }

  function initMilkdropVisualizer() {
    console.log('Visualizer: Initializing MilkDrop...');

    const container = document.getElementById('milkdrop-container');
    if (!container) {
      console.error('Visualizer: MilkDrop container not found');
      return false;
    }

    if (typeof THREE === 'undefined') {
      console.error('Visualizer: Three.js not loaded for MilkDrop');
      return false;
    }

    const placeholder = container.querySelector('.milkdrop-placeholder');
    if (placeholder) {
      placeholder.style.display = 'none';
    }

    let width = container.clientWidth;
    let height = container.clientHeight;

    if (width === 0 || height === 0) {
      width = 400;
      height = 300;
    }

    milkdropScene = new THREE.Scene();
    milkdropCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    const pixelRatio = Math.min(window.devicePixelRatio, 2);

    milkdropRenderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance'
    });
    milkdropRenderer.setSize(width, height);
    milkdropRenderer.setPixelRatio(pixelRatio);

    milkdropRenderer.domElement.style.display = 'block';
    milkdropRenderer.domElement.style.width = '100%';
    milkdropRenderer.domElement.style.height = '100%';
    milkdropRenderer.domElement.style.position = 'absolute';
    milkdropRenderer.domElement.style.top = '0';
    milkdropRenderer.domElement.style.left = '0';

    container.appendChild(milkdropRenderer.domElement);

    const colors = getThemeColors();

    try {
      const savedPreset = localStorage.getItem('milkdrop-preset-index');
      if (savedPreset !== null) {
        currentPresetIndex = Math.min(Math.max(0, parseInt(savedPreset, 10)), milkdropPresets.length - 1);
      }
    } catch (e) {}

    const geometry = new THREE.PlaneGeometry(2, 2);
    const material = new THREE.ShaderMaterial({
      vertexShader: milkdropVertexShader,
      fragmentShader: getCurrentPresetShader(),
      uniforms: {
        time: { value: 0 },
        bassLevel: { value: 0 },
        midLevel: { value: 0 },
        highLevel: { value: 0 },
        color1: { value: hexToThreeColor(colors.primary) },
        color2: { value: hexToThreeColor(colors.secondary) },
        color3: { value: hexToThreeColor(colors.accent) },
        resolution: { value: new THREE.Vector2(width * pixelRatio, height * pixelRatio) },
        speed: { value: milkdropConfig.speed },
        intensity: { value: milkdropConfig.intensity },
        complexity: { value: milkdropConfig.complexity },
        glowAmount: { value: milkdropConfig.glow }
      }
    });

    milkdropMesh = new THREE.Mesh(geometry, material);
    milkdropScene.add(milkdropMesh);

    // Fix sizing bug: Force resize after a short delay
    setTimeout(() => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w > 0 && h > 0 && milkdropRenderer) {
        const pr = milkdropRenderer.getPixelRatio();
        milkdropRenderer.setSize(w, h);
        if (milkdropMesh && milkdropMesh.material.uniforms) {
          milkdropMesh.material.uniforms.resolution.value.set(w * pr, h * pr);
        }
      }
    }, 100);

    const resizeObserver = new ResizeObserver(() => {
      if (!container || !milkdropRenderer) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w === 0 || h === 0) return;

      const pr = milkdropRenderer.getPixelRatio();
      milkdropRenderer.setSize(w, h);
      if (milkdropMesh && milkdropMesh.material.uniforms) {
        milkdropMesh.material.uniforms.resolution.value.set(w * pr, h * pr);
      }
    });
    resizeObserver.observe(container);

    console.log('Visualizer: MilkDrop initialized successfully');
    return true;
  }

  function updateMilkdropColors() {
    if (!milkdropMesh || !milkdropMesh.material.uniforms) return;

    const colors = getThemeColors();
    milkdropMesh.material.uniforms.color1.value = hexToThreeColor(colors.primary);
    milkdropMesh.material.uniforms.color2.value = hexToThreeColor(colors.secondary);
    milkdropMesh.material.uniforms.color3.value = hexToThreeColor(colors.accent);
  }

  function renderMilkdrop(time) {
    if (!milkdropRenderer || !milkdropScene || !milkdropCamera) return;

    milkdropTime = time * 0.001;

    if (milkdropMesh && milkdropMesh.material.uniforms) {
      milkdropMesh.material.uniforms.time.value = milkdropTime;
      milkdropMesh.material.uniforms.bassLevel.value = smoothedLevels.bass;
      milkdropMesh.material.uniforms.midLevel.value = smoothedLevels.mid;
      milkdropMesh.material.uniforms.highLevel.value = smoothedLevels.high;
    }

    milkdropRenderer.render(milkdropScene, milkdropCamera);
  }

  // ================================================================
  // CIRCULAR VISUALIZER
  // ================================================================

  function initCircularVisualizer() {
    console.log('Visualizer: Initializing Circular...');

    const container = document.getElementById('circular-container');
    if (!container) {
      console.error('Visualizer: Circular container not found');
      return false;
    }

    if (typeof THREE === 'undefined') {
      console.error('Visualizer: Three.js not loaded');
      return false;
    }

    const placeholder = container.querySelector('.circular-placeholder');
    if (placeholder) {
      placeholder.style.display = 'none';
    }

    let width = container.clientWidth;
    let height = container.clientHeight;

    if (width === 0 || height === 0) {
      width = 400;
      height = 300;
    }

    // Scene setup
    circularScene = new THREE.Scene();
    circularCamera = new THREE.PerspectiveCamera(60, width / height, 0.1, 1000);
    circularCamera.position.z = 5;

    const pixelRatio = Math.min(window.devicePixelRatio, 2);

    circularRenderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance'
    });
    circularRenderer.setSize(width, height);
    circularRenderer.setPixelRatio(pixelRatio);
    circularRenderer.setClearColor(0x000000, 0);

    circularRenderer.domElement.style.display = 'block';
    circularRenderer.domElement.style.width = '100%';
    circularRenderer.domElement.style.height = '100%';
    circularRenderer.domElement.style.position = 'absolute';
    circularRenderer.domElement.style.top = '0';
    circularRenderer.domElement.style.left = '0';

    container.appendChild(circularRenderer.domElement);

    const colors = getThemeColors();

    // Center glowing core (responds to bass)
    const coreGeometry = new THREE.SphereGeometry(0.4, 32, 32);
    const coreMaterial = new THREE.MeshBasicMaterial({
      color: colors.primary,
      transparent: true,
      opacity: 0.9
    });
    circularCore = new THREE.Mesh(coreGeometry, coreMaterial);
    circularScene.add(circularCore);

    // Frequency ring (connected line that responds to audio)
    const ringPoints = circularConfig.ringPoints;
    const ringPositions = new Float32Array(ringPoints * 3);

    for (let i = 0; i < ringPoints; i++) {
      const angle = (i / ringPoints) * Math.PI * 2;
      ringPositions[i * 3] = Math.cos(angle) * 1.5;
      ringPositions[i * 3 + 1] = Math.sin(angle) * 1.5;
      ringPositions[i * 3 + 2] = 0;
    }

    circularRingGeometry = new THREE.BufferGeometry();
    circularRingGeometry.setAttribute('position', new THREE.BufferAttribute(ringPositions, 3));

    // Main connected ring (LineLoop closes the loop automatically)
    const ringMaterial = new THREE.LineBasicMaterial({
      color: colors.accent,
      transparent: true,
      opacity: 0.95,
      linewidth: 2
    });
    circularRing = new THREE.LineLoop(circularRingGeometry, ringMaterial);
    circularScene.add(circularRing);

    // Secondary glow ring (slightly larger, lower opacity for glow effect)
    const glowRingPositions = new Float32Array(ringPoints * 3);
    for (let i = 0; i < ringPoints; i++) {
      const angle = (i / ringPoints) * Math.PI * 2;
      glowRingPositions[i * 3] = Math.cos(angle) * 1.5;
      glowRingPositions[i * 3 + 1] = Math.sin(angle) * 1.5;
      glowRingPositions[i * 3 + 2] = 0;
    }
    const glowRingGeometry = new THREE.BufferGeometry();
    glowRingGeometry.setAttribute('position', new THREE.BufferAttribute(glowRingPositions, 3));
    const glowRingMaterial = new THREE.LineBasicMaterial({
      color: colors.accent,
      transparent: true,
      opacity: 0.3,
      linewidth: 4
    });
    circularGlowRing = new THREE.LineLoop(glowRingGeometry, glowRingMaterial);
    circularGlowRing.userData.geometry = glowRingGeometry;
    circularScene.add(circularGlowRing);

    // Outer waveform ring (thick tube with waveform - multiple layers for thickness)
    const waveformPoints = 128;
    const waveformRadius = 2.2;
    const tubeThickness = 0.12; // Half-thickness of the tube

    // Create multiple layers to simulate a thick tube
    const waveformLayers = [];
    const layerOffsets = [-tubeThickness, -tubeThickness * 0.5, 0, tubeThickness * 0.5, tubeThickness];
    const layerOpacities = [0.2, 0.4, 0.8, 0.4, 0.2];

    layerOffsets.forEach((offset, layerIndex) => {
      const positions = new Float32Array(waveformPoints * 3);
      for (let i = 0; i < waveformPoints; i++) {
        const angle = (i / waveformPoints) * Math.PI * 2;
        const r = waveformRadius + offset;
        positions[i * 3] = Math.cos(angle) * r;
        positions[i * 3 + 1] = Math.sin(angle) * r;
        positions[i * 3 + 2] = 0;
      }

      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

      const material = new THREE.LineBasicMaterial({
        color: colors.secondary,
        transparent: true,
        opacity: layerOpacities[layerIndex],
        linewidth: 2
      });

      const line = new THREE.LineLoop(geometry, material);
      line.userData.geometry = geometry;
      line.userData.offset = offset;
      circularScene.add(line);
      waveformLayers.push(line);
    });

    // Store the center layer as main reference, and all layers for animation
    circularWaveformGeometry = waveformLayers[2].userData.geometry; // Center layer
    circularTorus = waveformLayers[2]; // Main reference
    circularWaveformGlow = { layers: waveformLayers }; // Store all layers

    // Particle system (orbiting particles)
    const particleCount = circularConfig.particles;
    const particlePositions = new Float32Array(particleCount * 3);
    const particleSpeeds = new Float32Array(particleCount);
    const particleAngles = new Float32Array(particleCount);
    const particleRadii = new Float32Array(particleCount);

    for (let i = 0; i < particleCount; i++) {
      particleAngles[i] = Math.random() * Math.PI * 2;
      particleRadii[i] = 1.0 + Math.random() * 1.5;
      particleSpeeds[i] = 0.5 + Math.random() * 1.0;

      particlePositions[i * 3] = Math.cos(particleAngles[i]) * particleRadii[i];
      particlePositions[i * 3 + 1] = Math.sin(particleAngles[i]) * particleRadii[i];
      particlePositions[i * 3 + 2] = (Math.random() - 0.5) * 0.5;
    }

    const particleGeometry = new THREE.BufferGeometry();
    particleGeometry.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3));
    particleGeometry.userData = { speeds: particleSpeeds, angles: particleAngles, radii: particleRadii };

    const particleMaterial = new THREE.PointsMaterial({
      size: 0.08,
      color: colors.accent,
      transparent: true,
      opacity: 0.6,
      blending: THREE.AdditiveBlending
    });
    circularParticles = new THREE.Points(particleGeometry, particleMaterial);
    circularScene.add(circularParticles);

    // Fix sizing bug: Force resize after a short delay
    setTimeout(() => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w > 0 && h > 0 && circularRenderer) {
        circularCamera.aspect = w / h;
        circularCamera.updateProjectionMatrix();
        circularRenderer.setSize(w, h);
      }
    }, 100);

    // Handle resize
    const resizeObserver = new ResizeObserver(() => {
      if (!container || !circularRenderer) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w === 0 || h === 0) return;

      circularCamera.aspect = w / h;
      circularCamera.updateProjectionMatrix();
      circularRenderer.setSize(w, h);
    });
    resizeObserver.observe(container);

    console.log('Visualizer: Circular visualizer initialized successfully');
    return true;
  }

  function updateCircularColors() {
    if (!circularCore) return;

    const colors = getThemeColors();
    circularCore.material.color.set(colors.primary);
    if (circularParticles) circularParticles.material.color.set(colors.accent);

    // Update blue ring colors (vertex colors)
    if (circularRing && circularRingGeometry) {
      const colorAttr = circularRingGeometry.attributes.color;
      const color = new THREE.Color(colors.accent);
      for (let i = 0; i < colorAttr.count; i++) {
        colorAttr.setXYZ(i, color.r, color.g, color.b);
      }
      colorAttr.needsUpdate = true;
    }

    // Update blue glow ring color
    if (circularGlowRing && circularGlowRing.material) {
      circularGlowRing.material.color.set(colors.accent);
    }

    // Update purple waveform layers color
    if (circularWaveformGlow && circularWaveformGlow.layers) {
      circularWaveformGlow.layers.forEach(layer => {
        if (layer && layer.material) {
          layer.material.color.set(colors.secondary);
        }
      });
    }
  }

  function renderCircular(time) {
    if (!circularRenderer || !circularScene || !circularCamera) return;

    const t = time * 0.001;
    const rotSpeed = circularConfig.rotation;
    const sens = circularConfig.sensitivity;

    // Update core size with bass (enhanced with sensitivity)
    if (circularCore) {
      const bassScale = 0.4 + smoothedLevels.bass * 0.6 * sens;
      circularCore.scale.setScalar(bassScale);
      circularCore.material.opacity = 0.7 + smoothedLevels.bass * 0.3 * sens;
      // Subtle pulse rotation
      circularCore.rotation.z += smoothedLevels.bass * 0.02 * sens;
    }

    // Update frequency ring with rubber band / elastic stretch effects
    if (circularRing && circularRingGeometry) {
      const positions = circularRingGeometry.attributes.position.array;
      const ringPoints = circularConfig.ringPoints;
      const sens = circularConfig.sensitivity;

      // Dynamic stretch parameters - bass creates asymmetric bulges
      const stretchX = 1.0 + smoothedLevels.bass * 0.4 * sens; // Horizontal stretch
      const stretchY = 1.0 + smoothedLevels.mid * 0.3 * sens;  // Vertical stretch
      const wobble = smoothedLevels.high * 0.3 * sens;          // High-freq wobble

      for (let i = 0; i < ringPoints; i++) {
        const angle = (i / ringPoints) * Math.PI * 2;

        // Rubber band effect - different points stretch at different rates
        const pointPhase = angle + t * 0.5;
        const bassWarp = Math.sin(pointPhase * 2) * smoothedLevels.bass * 0.8 * sens;
        const midPulse = Math.cos(pointPhase * 3 - t) * smoothedLevels.mid * 0.5 * sens;
        const highSpike = Math.sin(pointPhase * 6 + t * 2) * smoothedLevels.high * 0.4 * sens;

        // Base radius with elastic deformation
        const baseRadius = 1.5;
        const elasticRadius = baseRadius + bassWarp + midPulse + highSpike;

        // Apply asymmetric stretch (rubber band being pulled)
        const stretchedX = Math.cos(angle) * elasticRadius * stretchX;
        const stretchedY = Math.sin(angle) * elasticRadius * stretchY;

        // Add high-frequency wobble
        const wobbleOffset = Math.sin(angle * 8 + t * 4) * wobble;

        positions[i * 3] = stretchedX + Math.cos(angle) * wobbleOffset;
        positions[i * 3 + 1] = stretchedY + Math.sin(angle) * wobbleOffset;
      }
      circularRingGeometry.attributes.position.needsUpdate = true;

      // Update glow ring to follow with slight lag (elastic follow)
      if (circularGlowRing && circularGlowRing.userData.geometry) {
        const glowPositions = circularGlowRing.userData.geometry.attributes.position.array;
        for (let i = 0; i < ringPoints; i++) {
          // Glow follows but slightly larger and with offset for "bounce" effect
          const glowScale = 1.08 + smoothedLevels.bass * 0.05 * sens;
          glowPositions[i * 3] = positions[i * 3] * glowScale;
          glowPositions[i * 3 + 1] = positions[i * 3 + 1] * glowScale;
        }
        circularGlowRing.userData.geometry.attributes.position.needsUpdate = true;
        circularGlowRing.rotation.z = circularRing.rotation.z;
      }

      // Rotate ring - speed increases with audio energy
      const audioEnergy = (smoothedLevels.bass + smoothedLevels.mid + smoothedLevels.high) / 3;
      circularRing.rotation.z += (0.002 + audioEnergy * 0.012 * sens) * rotSpeed;
    }

    // Update outer waveform ring (thick tube) with audio samples
    if (circularWaveformGlow && circularWaveformGlow.layers) {
      const waveformPoints = 128;
      const baseRadius = 2.2;
      const tubeThickness = 0.12;

      // Get audio samples for waveform visualization
      const samples = nativeSamples.length > 0 ? nativeSamples : [];
      const sampleStep = samples.length > 0 ? samples.length / waveformPoints : 1;

      // Calculate waveform amplitudes for each point
      const waveAmplitudes = new Float32Array(waveformPoints);
      for (let i = 0; i < waveformPoints; i++) {
        const angle = (i / waveformPoints) * Math.PI * 2;

        let sampleValue = 0;
        if (samples.length > 0) {
          const sampleIndex = Math.floor(i * sampleStep) % samples.length;
          sampleValue = samples[sampleIndex] || 0;
        }

        // Fallback animation when no audio
        const fallbackWave = Math.sin(angle * 8 + t * 3) * smoothedLevels.mid * 0.4 +
                            Math.sin(angle * 12 - t * 2) * smoothedLevels.high * 0.3 +
                            Math.cos(angle * 4 + t * 1.5) * smoothedLevels.bass * 0.25;

        waveAmplitudes[i] = samples.length > 0 ? sampleValue * 0.8 * sens : fallbackWave * sens;
      }

      // Update all layers of the thick waveform tube
      const layerOffsets = [-tubeThickness, -tubeThickness * 0.5, 0, tubeThickness * 0.5, tubeThickness];
      circularWaveformGlow.layers.forEach((layer, layerIndex) => {
        const positions = layer.userData.geometry.attributes.position.array;
        const layerOffset = layerOffsets[layerIndex];

        for (let i = 0; i < waveformPoints; i++) {
          const angle = (i / waveformPoints) * Math.PI * 2;
          const radius = baseRadius + layerOffset + waveAmplitudes[i];

          positions[i * 3] = Math.cos(angle) * radius;
          positions[i * 3 + 1] = Math.sin(angle) * radius;
        }
        layer.userData.geometry.attributes.position.needsUpdate = true;

        // Rotate all layers together
        layer.rotation.z += (0.001 + smoothedLevels.mid * 0.005 * sens) * rotSpeed;
      });

      // Adjust center layer opacity based on audio level
      if (circularTorus) {
        circularTorus.material.opacity = 0.6 + smoothedLevels.mid * 0.4 * sens;
      }
    }

    // Update particles (with sensitivity)
    if (circularParticles && circularParticles.geometry.userData) {
      const positions = circularParticles.geometry.attributes.position.array;
      const { speeds, angles, radii } = circularParticles.geometry.userData;

      for (let i = 0; i < speeds.length; i++) {
        angles[i] += speeds[i] * 0.01 * rotSpeed * (1 + smoothedLevels.high * 0.8 * sens);
        const r = radii[i] + smoothedLevels.bass * 0.5 * sens;
        positions[i * 3] = Math.cos(angles[i]) * r;
        positions[i * 3 + 1] = Math.sin(angles[i]) * r;
        positions[i * 3 + 2] = Math.sin(angles[i] * 2 + t) * 0.4 * sens;
      }
      circularParticles.geometry.attributes.position.needsUpdate = true;
      circularParticles.material.opacity = 0.4 + smoothedLevels.high * 0.5 * sens;
    }

    circularRenderer.render(circularScene, circularCamera);
  }

  // ================================================================
  // POWERAUDIO VISUALIZER (Cute Creature)
  // ================================================================

  function initPowerAudioVisualizer() {
    console.log('Visualizer: Initializing PowerAudio...');

    const container = document.getElementById('poweraudio-container');
    if (!container) {
      console.error('Visualizer: PowerAudio container not found');
      return false;
    }

    if (typeof PowerAudio === 'undefined' || typeof PIXI === 'undefined') {
      console.error('Visualizer: PowerAudio or PIXI.js not loaded');
      return false;
    }

    const placeholder = container.querySelector('.poweraudio-placeholder');
    if (placeholder) {
      placeholder.style.display = 'none';
    }

    const colors = getThemeColors();

    try {
      poweraudioViz = new PowerAudio.Viz({
        container: container,
        themeColors: {
          primary: colors.primary,
          secondary: colors.secondary,
          accent: colors.accent
        }
      });

      // Apply saved config settings
      applyPowerAudioConfig();

      // Add click handler to make creature flip
      container.addEventListener('click', () => {
        if (poweraudioViz) {
          poweraudioViz.flip();
        }
      });

      console.log('Visualizer: PowerAudio initialized successfully');
      return true;
    } catch (e) {
      console.error('Visualizer: Failed to initialize PowerAudio:', e);
      return false;
    }
  }

  function updatePowerAudioColors() {
    if (!poweraudioViz) return;

    const colors = getThemeColors();
    poweraudioViz.setThemeColors({
      primary: colors.primary,
      secondary: colors.secondary,
      accent: colors.accent
    });
  }

  function renderPowerAudio() {
    if (!poweraudioViz) return;

    // Feed raw audio levels - PowerAudio applies sensitivity internally
    poweraudioViz.updateAudioLevels(
      smoothedLevels.bass,
      smoothedLevels.mid,
      smoothedLevels.high
    );
  }

  // ================================================================
  // AUDIO PROCESSING
  // ================================================================

  function getDemoAudioLevels() {
    demoPhase += 0.015; // Slower animation

    // Gentle breathing effect - much calmer
    const breathe = (Math.sin(demoPhase * 0.3) + 1) * 0.5; // 0 to 1, slowly

    const bass = breathe * 0.15;
    const mid = breathe * 0.1;
    const high = breathe * 0.08;

    return {
      bass: Math.min(1, Math.max(0, bass)),
      mid: Math.min(1, Math.max(0, mid)),
      high: Math.min(1, Math.max(0, high))
    };
  }

  function processNativeSamples() {
    if (nativeSamples.length === 0) {
      return getDemoAudioLevels();
    }

    const len = nativeSamples.length;
    const bassRange = Math.floor(len * 0.15);
    const midRange = Math.floor(len * 0.35);

    let bassSum = 0, midSum = 0, highSum = 0;

    for (let i = 0; i < bassRange; i++) {
      bassSum += Math.abs(nativeSamples[i]);
    }
    for (let i = bassRange; i < midRange; i++) {
      midSum += Math.abs(nativeSamples[i]);
    }
    for (let i = midRange; i < len; i++) {
      highSum += Math.abs(nativeSamples[i]);
    }

    return {
      bass: Math.min(1, (bassSum / bassRange) * 3),
      mid: Math.min(1, (midSum / (midRange - bassRange)) * 2.5),
      high: Math.min(1, (highSum / (len - midRange)) * 2)
    };
  }

  // ================================================================
  // ANIMATION LOOP
  // ================================================================

  let lastAnimateLogTime = 0;

  function animate(currentTime) {
    // Stop loop entirely when hidden (saves CPU)
    if (document.hidden) {
      animationId = null;
      return;
    }

    // Schedule next frame
    animationId = requestAnimationFrame(animate);

    // Frame rate limiting - skip render if not enough time has passed (30fps target)
    if (currentTime - lastFrameTime < frameInterval) return;
    lastFrameTime = currentTime - ((currentTime - lastFrameTime) % frameInterval);

    let raw;
    if (audioSourceMode === 'native' && nativeSamples.length > 0) {
      raw = processNativeSamples();
      // Log periodically to show we're using native audio
      if (currentTime - lastAnimateLogTime > 3000) {
        console.log(`Visualizer: Using NATIVE audio, samples=${nativeSamples.length}, bass=${raw.bass.toFixed(3)}, mid=${raw.mid.toFixed(3)}, high=${raw.high.toFixed(3)}`);
        lastAnimateLogTime = currentTime;
      }
    } else {
      raw = getDemoAudioLevels();
      // Log when falling back to demo mode
      if (currentTime - lastAnimateLogTime > 5000 && audioSourceMode === 'native') {
        console.log(`Visualizer: audioSourceMode=${audioSourceMode} but nativeSamples.length=${nativeSamples.length}, falling back to demo`);
        lastAnimateLogTime = currentTime;
      }
    }

    const smoothing = 0.15;
    smoothedLevels.bass += (raw.bass - smoothedLevels.bass) * smoothing;
    smoothedLevels.mid += (raw.mid - smoothedLevels.mid) * smoothing;
    smoothedLevels.high += (raw.high - smoothedLevels.high) * smoothing;

    switch (currentDisplayMode) {
      case 'circular':
        renderCircular(currentTime);
        break;
      case 'milkdrop':
        renderMilkdrop(currentTime);
        break;
      case 'poweraudio':
      default:
        renderPowerAudio();
        break;
    }
  }

  // ================================================================
  // DEVICE HANDLING
  // ================================================================

  async function fetchAudioDevices() {
    if (!visualizerTauriAvailable) return [];

    try {
      const { invoke } = window.__TAURI__.tauri;
      const devices = await invoke('list_audio_devices');
      return devices || [];
    } catch (e) {
      console.log('Failed to fetch audio devices:', e);
      return [];
    }
  }

  // Store devices for system-default resolution
  let cachedLoopbackDevices = [];

  // Track system-default mode for automatic device switching
  let isSystemDefaultMode = false;
  let currentWindowsDefaultName = null;
  let systemDefaultPollInterval = null;
  let lastRecoveryAttempt = 0; // Timestamp of last auto-recovery attempt

  // Get the actual Windows default output device name from the system
  async function getWindowsDefaultDevice() {
    if (!visualizerTauriAvailable) return null;
    try {
      const { invoke } = window.__TAURI__.tauri;
      const deviceName = await invoke('get_default_output_device');
      return deviceName;
    } catch (e) {
      console.log('Failed to get Windows default device:', e);
      return null;
    }
  }

  // Get the loopback device ID for the Windows default output device directly from Rust
  // This is more reliable than name matching - Rust knows exactly which device to use
  async function getDefaultLoopbackDevice() {
    if (!visualizerTauriAvailable) return null;
    try {
      const { invoke } = window.__TAURI__.tauri;
      const deviceId = await invoke('get_default_loopback_device');
      console.log('Visualizer: Rust returned default loopback device:', deviceId);
      return deviceId;
    } catch (e) {
      console.log('Failed to get default loopback device:', e);
      return null;
    }
  }

  // Find the loopback device matching the Windows default output
  function findLoopbackForDefaultDevice(windowsDefaultName) {
    if (!windowsDefaultName || cachedLoopbackDevices.length === 0) {
      console.log('Visualizer: No default name or no cached devices');
      return null;
    }

    const normalizedDefault = windowsDefaultName.toLowerCase().trim();
    console.log('Visualizer: Looking for loopback match for:', normalizedDefault);
    console.log('Visualizer: Available loopbacks:', cachedLoopbackDevices.map(d => d.name).join(', '));

    // Score each device and return the best match
    // Higher score = better match
    let bestMatch = null;
    let bestScore = 0;

    for (const device of cachedLoopbackDevices) {
      const loopbackName = device.name.toLowerCase().replace(' (loopback)', '').trim();
      let score = 0;
      let matchType = '';

      // Exact match (highest priority)
      if (normalizedDefault === loopbackName) {
        score = 100;
        matchType = 'exact';
      }
      // Substring match (high priority)
      else if (normalizedDefault.includes(loopbackName) || loopbackName.includes(normalizedDefault)) {
        score = 80;
        matchType = 'substring';
      }
      // Specific hardware identifier match (medium-high priority)
      else if (normalizedDefault.includes('realtek') && loopbackName.includes('realtek')) {
        score = 70;
        matchType = 'realtek keyword';
      }
      else if (normalizedDefault.includes('soundcore') && loopbackName.includes('soundcore')) {
        score = 70;
        matchType = 'soundcore keyword';
      }
      else if (normalizedDefault.includes('headphone') && loopbackName.includes('headphone')) {
        score = 60;
        matchType = 'headphone keyword';
      }
      // Generic speaker match (low priority - only if no better match)
      else if (normalizedDefault.includes('speaker') && loopbackName.includes('speaker') &&
               !loopbackName.includes('nvidia') && !loopbackName.includes('krisp') &&
               !loopbackName.includes('virtual') && !loopbackName.includes('cable')) {
        score = 30;
        matchType = 'speaker keyword (non-virtual)';
      }

      if (score > bestScore) {
        bestScore = score;
        bestMatch = device;
        console.log(`Visualizer: New best match: ${device.name} (score=${score}, type=${matchType})`);
      }
    }

    if (bestMatch) {
      console.log(`Visualizer: Best match selected: ${bestMatch.name} (score=${bestScore})`);
    } else {
      console.log('Visualizer: No matching loopback device found for:', normalizedDefault);
    }

    return bestMatch;
  }

  // Start polling for system default changes
  function startSystemDefaultPolling() {
    if (systemDefaultPollInterval) return;
    console.log('Visualizer: Starting system default polling');

    systemDefaultPollInterval = setInterval(async () => {
      if (!isSystemDefaultMode) return;

      const newDefaultName = await getWindowsDefaultDevice();

      if (newDefaultName && newDefaultName !== currentWindowsDefaultName) {
        console.log(`Visualizer: Windows default changed from "${currentWindowsDefaultName}" to "${newDefaultName}"`);
        currentWindowsDefaultName = newDefaultName;

        // Get the new loopback device ID directly from Rust
        const newLoopbackId = await getDefaultLoopbackDevice();
        if (newLoopbackId) {
          console.log(`Visualizer: Switching to new default device: ${newLoopbackId}`);
          await stopNativeCapture();
          const success = await startNativeCapture(newLoopbackId);
          if (success) {
            currentDeviceId = newLoopbackId;
            updateVisualizerLabel('System Default');
          }
        } else {
          console.log('Visualizer: Could not get new default loopback device');
        }
      }
    }, 2000); // Check every 2 seconds
  }

  // Stop polling for system default changes
  function stopSystemDefaultPolling() {
    if (systemDefaultPollInterval) {
      clearInterval(systemDefaultPollInterval);
      systemDefaultPollInterval = null;
    }
  }

  // Auto-recover when audio samples stop flowing in system-default mode
  async function handleSystemDefaultRecovery() {
    const now = Date.now();
    const cooldownMs = 4000; // 4 second cooldown between recovery attempts

    if (now - lastRecoveryAttempt < cooldownMs) {
      console.log('Visualizer: Recovery cooldown active, skipping');
      return;
    }

    lastRecoveryAttempt = now;
    console.log('Visualizer: Attempting auto-recovery for system default...');

    // Use direct Rust API to get the exact loopback device ID
    const defaultLoopbackId = await getDefaultLoopbackDevice();
    if (defaultLoopbackId) {
      console.log(`Visualizer: Recovery - restarting capture on ${defaultLoopbackId}`);
      await stopNativeCapture();
      const success = await startNativeCapture(defaultLoopbackId);
      if (success) {
        currentDeviceId = defaultLoopbackId;
        // Update the tracked device name
        const newDefaultName = await getWindowsDefaultDevice();
        if (newDefaultName) {
          currentWindowsDefaultName = newDefaultName;
        }
        updateVisualizerLabel('System Default');
        console.log('Visualizer: Auto-recovery successful');
      } else {
        console.log('Visualizer: Auto-recovery failed to start capture');
      }
    } else {
      console.log('Visualizer: Recovery - could not get default loopback device');
    }
  }

  async function populateDeviceSelector() {
    const select = document.getElementById('visualizer-device-select');
    if (!select) return;

    // Start with System Default as first option, then Demo Mode
    select.innerHTML = `
      <option value="system-default">System Default</option>
      <option value="demo">Demo Mode</option>
    `;

    if (!visualizerTauriAvailable) return;

    const devices = await fetchAudioDevices();

    const inputs = devices.filter(d => d.is_input && !d.is_loopback);
    const loopbacks = devices.filter(d => d.is_loopback);
    cachedLoopbackDevices = loopbacks; // Cache for system-default resolution
    console.log('Visualizer: Found', loopbacks.length, 'loopback devices:', loopbacks.map(d => d.name).join(', '));

    if (inputs.length > 0) {
      const inputGroup = document.createElement('optgroup');
      inputGroup.label = 'Input Devices';
      inputs.forEach(device => {
        const option = document.createElement('option');
        option.value = device.id;
        option.textContent = device.name;
        inputGroup.appendChild(option);
      });
      select.appendChild(inputGroup);
    }

    if (loopbacks.length > 0) {
      const loopbackGroup = document.createElement('optgroup');
      loopbackGroup.label = 'System Audio (Loopback)';
      loopbacks.forEach(device => {
        const option = document.createElement('option');
        option.value = device.id;
        option.textContent = device.name;
        loopbackGroup.appendChild(option);
      });
      select.appendChild(loopbackGroup);
    }

    // Restore saved device selection or default to system-default
    const savedDevice = localStorage.getItem('visualizer-device');
    if (savedDevice && select.querySelector(`option[value="${savedDevice}"]`)) {
      select.value = savedDevice;
    } else {
      select.value = 'system-default';
    }

    return select.value;
  }

  async function startNativeCapture(deviceId) {
    if (!visualizerTauriAvailable) return false;

    try {
      const { invoke } = window.__TAURI__.tauri;
      await invoke('start_audio_capture', { deviceId });

      if (nativeAudioInterval) clearInterval(nativeAudioInterval);
      let sampleCount = 0;
      let lastLogTime = Date.now();
      let zeroSampleCount = 0;
      const captureStartTime = Date.now(); // Track when capture started
      const startupImmunityMs = 3000; // Don't trigger recovery for first 3 seconds

      nativeAudioInterval = setInterval(async () => {
        try {
          const samples = await invoke('get_audio_samples');
          if (samples && samples.length > 0) {
            nativeSamples = samples;
            sampleCount += samples.length;
            zeroSampleCount = 0; // Reset zero counter when we get data

            // Log every 2 seconds
            const now = Date.now();
            if (now - lastLogTime > 2000) {
              const maxSample = Math.max(...samples.map(Math.abs));
              console.log(`Visualizer: Received ${sampleCount} samples, max level: ${maxSample.toFixed(4)}`);
              sampleCount = 0;
              lastLogTime = now;
            }
          } else {
            zeroSampleCount++;
            const timeSinceStart = Date.now() - captureStartTime;

            // Log if we've had many consecutive zero-sample polls
            if (zeroSampleCount === 50) {
              console.log('Visualizer: Warning - no samples received for ~1 second');
            } else if (zeroSampleCount === 100 && isSystemDefaultMode && timeSinceStart > startupImmunityMs) {
              // Auto-recover in system-default mode when samples stop flowing
              // But only after startup immunity period to avoid false triggers
              console.log('Visualizer: No samples for ~1.6 seconds in system-default mode, triggering recovery');
              zeroSampleCount = 0; // Reset to prevent repeated triggers
              handleSystemDefaultRecovery();
            } else if (zeroSampleCount === 200) {
              console.log('Visualizer: Warning - no samples received for ~3 seconds, capture may have stopped');
            }
          }
        } catch (e) {
          console.error('Audio sample fetch error:', e);
        }
      }, 16);

      // Log capture status after a short delay
      setTimeout(async () => {
        try {
          const status = await invoke('get_audio_status');
          console.log('Visualizer: Capture status - capturing:', status[0], 'device:', status[1]);
        } catch (e) {
          console.error('Visualizer: Failed to get capture status:', e);
        }
      }, 500);

      return true;
    } catch (e) {
      console.log('Failed to start native audio capture:', e);
      return false;
    }
  }

  async function stopNativeCapture() {
    if (nativeAudioInterval) {
      clearInterval(nativeAudioInterval);
      nativeAudioInterval = null;
    }
    nativeSamples = [];

    if (!visualizerTauriAvailable) return;

    try {
      const { invoke } = window.__TAURI__.tauri;
      await invoke('stop_audio_capture');
    } catch (e) {
      console.log('Failed to stop native audio capture:', e);
    }
  }

  function updateVisualizerLabel(text) {
    const label = document.getElementById('visualizer-source-label');
    if (label) label.textContent = text;
  }

  // Debounce device changes to prevent rapid switching
  let deviceChangeTimeout = null;
  let lastDeviceChangeTime = 0;

  async function handleDeviceChange(deviceId, savePreference = true) {
    const now = Date.now();
    console.log(`Visualizer: handleDeviceChange called with deviceId=${deviceId}, timeSinceLast=${now - lastDeviceChangeTime}ms`);

    // Debounce - ignore rapid device changes (within 500ms)
    if (now - lastDeviceChangeTime < 500 && lastDeviceChangeTime > 0) {
      console.log('Visualizer: Ignoring rapid device change (debounced)');
      return;
    }
    lastDeviceChangeTime = now;

    await stopNativeCapture();
    stopSystemDefaultPolling();

    // Save preference (but not for auto-init calls)
    if (savePreference) {
      localStorage.setItem('visualizer-device', deviceId);
    }

    // Resolve system-default to actual device
    let actualDeviceId = deviceId;
    isSystemDefaultMode = (deviceId === 'system-default');

    if (deviceId === 'system-default') {
      console.log('Visualizer: Resolving system-default...');

      // Use direct Rust API to get the exact loopback device ID - no guessing needed
      const defaultLoopbackId = await getDefaultLoopbackDevice();
      if (defaultLoopbackId) {
        actualDeviceId = defaultLoopbackId;
        console.log('Visualizer: System Default resolved directly to:', defaultLoopbackId);

        // Also get the device name for tracking/display
        const windowsDefault = await getWindowsDefaultDevice();
        if (windowsDefault) {
          currentWindowsDefaultName = windowsDefault;
        }
      } else {
        // Fallback if Rust API unavailable
        console.warn('Visualizer: Could not get default loopback device from Rust, using demo mode');
        actualDeviceId = 'demo';
      }
    }

    currentDeviceId = actualDeviceId;

    if (actualDeviceId === 'demo') {
      audioSourceMode = 'demo';
      updateVisualizerLabel('Demo Mode');
      isSystemDefaultMode = false;
      return;
    }

    if (visualizerTauriAvailable) {
      const success = await startNativeCapture(actualDeviceId);
      if (success) {
        audioSourceMode = 'native';
        // Show "System Default" label if using system-default, otherwise show device name
        if (deviceId === 'system-default') {
          updateVisualizerLabel('System Default');
          // Start polling for device changes when in system-default mode
          startSystemDefaultPolling();
        } else {
          const select = document.getElementById('visualizer-device-select');
          const selectedOption = select?.options[select.selectedIndex];
          updateVisualizerLabel(selectedOption?.textContent || 'Native Audio');
        }
      } else {
        audioSourceMode = 'demo';
        updateVisualizerLabel('Demo Mode (fallback)');
        document.getElementById('visualizer-device-select').value = 'demo';
        isSystemDefaultMode = false;
      }
    }
  }

  function setupDeviceControls() {
    const select = document.getElementById('visualizer-device-select');
    const refreshBtn = document.getElementById('visualizer-refresh-btn');

    // Prevent dropdown close issues by stopping propagation
    select?.addEventListener('mousedown', (e) => e.stopPropagation());
    select?.addEventListener('click', (e) => e.stopPropagation());

    select?.addEventListener('change', (e) => {
      handleDeviceChange(e.target.value);
    });

    refreshBtn?.addEventListener('click', () => {
      populateDeviceSelector();
    });
  }

  // ================================================================
  // MODE SWITCHING
  // ================================================================

  function switchDisplayMode(mode) {
    console.log(`Visualizer: switchDisplayMode called with mode=${mode}, currentMode=${currentDisplayMode}`);

    if (mode === currentDisplayMode) {
      return;
    }

    const modes = ['poweraudio', 'milkdrop', 'circular'];
    if (!modes.includes(mode)) {
      console.warn('Visualizer: Invalid mode:', mode);
      return;
    }

    currentDisplayMode = mode;

    // Update mode visibility
    modes.forEach(m => {
      const modeEl = document.getElementById(`visualizer-mode-${m}`);
      if (modeEl) {
        modeEl.style.display = m === mode ? 'block' : 'none';
      }
    });

    // Update config panel section visibility
    modes.forEach(m => {
      const configSection = document.getElementById(`config-mode-${m}`);
      if (configSection) {
        configSection.style.display = m === mode ? 'block' : 'none';
      }
    });

    // Lazy initialize visualizers on first switch
    if (mode === 'poweraudio' && !poweraudioInitialized) {
      poweraudioInitialized = initPowerAudioVisualizer();
    } else if (mode === 'circular' && !circularInitialized) {
      circularInitialized = initCircularVisualizer();
    } else if (mode === 'milkdrop' && !milkdropInitialized) {
      milkdropInitialized = initMilkdropVisualizer();
    }

    // Pause/resume PowerAudio based on mode to save CPU
    if (poweraudioViz && poweraudioViz.stage) {
      if (mode === 'poweraudio') {
        // Resume PowerAudio when switching to it
        poweraudioViz.stage.resume();
        poweraudioViz.lastUpdateDate = new Date();
        setTimeout(() => {
          poweraudioViz.stage.resize();
        }, 50);
      } else {
        // Pause PowerAudio when switching away (saves significant CPU)
        poweraudioViz.stage.pause();
      }
    }

    // Update navigation dots
    const dots = document.querySelectorAll('.visualizer-nav-dots .nav-dot');
    dots.forEach(dot => {
      const dotMode = dot.getAttribute('data-mode');
      dot.classList.toggle('active', dotMode === mode);
    });

    try {
      localStorage.setItem('visualizer-display-mode', mode);
    } catch (e) {}
  }

  function setupModeNavigation() {
    const dotsContainer = document.getElementById('visualizer-nav-dots');
    if (dotsContainer) {
      dotsContainer.addEventListener('click', (e) => {
        const dot = e.target.closest('.nav-dot');
        if (dot) {
          const mode = dot.getAttribute('data-mode');
          switchDisplayMode(mode);
        }
      });
    } else {
      setTimeout(setupModeNavigation, 200);
      return;
    }

    const dots = document.querySelectorAll('.visualizer-nav-dots .nav-dot');
    dots.forEach(dot => {
      dot.addEventListener('click', (e) => {
        e.stopPropagation();
        const mode = dot.getAttribute('data-mode');
        switchDisplayMode(mode);
      });
    });

    try {
      const saved = localStorage.getItem('visualizer-display-mode');
      if (saved && ['poweraudio', 'milkdrop', 'circular'].includes(saved)) {
        switchDisplayMode(saved);
      } else {
        switchDisplayMode('poweraudio');
      }
    } catch (e) {
      switchDisplayMode('poweraudio');
    }

    setupVisualizerKeyboard();
  }

  function setupVisualizerKeyboard() {
    const widget = document.getElementById('visualizer-widget');
    if (!widget) return;

    widget.setAttribute('tabindex', '0');

    widget.addEventListener('click', () => {
      widget.focus();
    });

    widget.addEventListener('keydown', (e) => {
      if (currentDisplayMode !== 'milkdrop') return;

      switch (e.code) {
        case 'Space':
          e.preventDefault();
          nextMilkdropPreset();
          break;
        case 'ArrowRight':
          e.preventDefault();
          nextMilkdropPreset();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          prevMilkdropPreset();
          break;
        case 'KeyR':
          e.preventDefault();
          randomMilkdropPreset();
          break;
      }
    });
  }

  // ================================================================
  // THEME OBSERVER
  // ================================================================

  function setupThemeObserver() {
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.attributeName === 'data-theme') {
          updatePowerAudioColors();
          updateMilkdropColors();
          updateCircularColors();
        }
      }
    });

    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ['data-theme']
    });
  }

  // ================================================================
  // CONFIG PANEL
  // ================================================================

  const defaultMilkdropConfig = {
    speed: 1.0,
    intensity: 2.5,
    complexity: 6,
    glow: 0.2
  };

  const defaultCircularConfig = {
    ringPoints: 64,
    glow: 0.6,
    rotation: 1.0,
    particles: 50,
    sensitivity: 1.5
  };

  // PowerAudio config (Creature) - User preferred defaults (midpoint values)
  const defaultPowerAudioConfig = {
    fps: 30,
    colorVariation: true,
    sensitivity: 1.0,
    movementSpeed: 0.2,
    spikeHeight: 0.8,
    nodeCount: 20,
    lineOpacity: 0.5,
    sporeFrequency: 0.3,
    sporeChance: 0.3,
    sporeFadeTime: 0.5,
    creatureSize: 1.0
  };

  let poweraudioConfig = { ...defaultPowerAudioConfig };

  function loadVisualizerConfig() {
    try {
      // Load background config
      const savedBg = localStorage.getItem('visualizer-bg-config');
      if (savedBg) {
        visualizerBgConfig = { ...visualizerBgConfig, ...JSON.parse(savedBg) };
      }
      const savedMilkdrop = localStorage.getItem('visualizer-milkdrop-config');
      if (savedMilkdrop) {
        milkdropConfig = { ...defaultMilkdropConfig, ...JSON.parse(savedMilkdrop) };
      }
      const savedCircular = localStorage.getItem('visualizer-circular-config');
      if (savedCircular) {
        circularConfig = { ...defaultCircularConfig, ...JSON.parse(savedCircular) };
      }
      const savedPowerAudio = localStorage.getItem('visualizer-poweraudio-config');
      if (savedPowerAudio) {
        poweraudioConfig = { ...defaultPowerAudioConfig, ...JSON.parse(savedPowerAudio) };
      }
    } catch (e) {
      console.warn('Failed to load visualizer config:', e);
    }
    // Apply background after loading
    applyVisualizerBackground(visualizerBgConfig.background);
  }

  function saveVisualizerBgConfig() {
    try {
      localStorage.setItem('visualizer-bg-config', JSON.stringify(visualizerBgConfig));
    } catch (e) {
      console.warn('Failed to save visualizer background config:', e);
    }
  }

  function applyVisualizerBackground(bgType) {
    const widget = document.querySelector('.widget-visualizer');
    if (widget) {
      if (bgType && bgType !== 'none') {
        widget.setAttribute('data-bg', bgType);
        if (bgType === 'svg') {
          if (visualizerBgConfig.customSvg) {
            widget.style.setProperty('--visualizer-custom-svg', `url("${visualizerBgConfig.customSvg}")`);
          }
          const blurVal = visualizerBgConfig.svgBlur ?? 0;
          widget.style.setProperty('--visualizer-svg-blur', `${blurVal}px`);
          widget.style.setProperty('--visualizer-svg-blur-scale', blurVal * 0.007);
        }
      } else {
        widget.removeAttribute('data-bg');
        widget.style.removeProperty('--visualizer-custom-svg');
        widget.style.removeProperty('--visualizer-svg-blur');
        widget.style.removeProperty('--visualizer-svg-blur-scale');
      }
    }
  }

  function updateVisualizerBgUI() {
    const currentBg = visualizerBgConfig.background || 'none';
    const radio = document.querySelector(`input[name="visualizer-bg"][value="${currentBg}"]`);
    if (radio) radio.checked = true;

    const svgUpload = document.getElementById('visualizer-svg-upload');
    if (svgUpload) {
      svgUpload.style.display = currentBg === 'svg' ? 'block' : 'none';
    }

    // Initialize blur controls
    const blurSlider = document.getElementById('visualizer-blur-slider');
    const blurInput = document.getElementById('visualizer-blur-input');
    if (blurSlider && blurInput) {
      const blurVal = visualizerBgConfig.svgBlur ?? 0;
      blurSlider.value = blurVal;
      blurInput.value = blurVal;
    }

    const preview = document.getElementById('visualizer-svg-preview');
    if (preview && visualizerBgConfig.customSvg) {
      preview.innerHTML = `<img src="${visualizerBgConfig.customSvg}" alt="SVG Preview" style="max-width: 100%; max-height: 40px; border-radius: 4px;">`;
    } else if (preview) {
      preview.innerHTML = '';
    }
  }

  function savePowerAudioConfig() {
    try {
      localStorage.setItem('visualizer-poweraudio-config', JSON.stringify(poweraudioConfig));
    } catch (e) {}
  }

  function applyPowerAudioConfig() {
    if (!poweraudioViz) return;

    // Apply all config values to PowerAudio
    Object.entries(poweraudioConfig).forEach(([key, value]) => {
      poweraudioViz.setConfig(key, value);
    });
  }

  function updatePowerAudioConfigUI() {
    // Color variation toggle
    const colorToggle = document.getElementById('vis-config-pa-colorful');
    if (colorToggle) {
      colorToggle.classList.toggle('active', poweraudioConfig.colorVariation);
      colorToggle.setAttribute('data-value', String(poweraudioConfig.colorVariation));
    }

    // Sliders
    const sliders = {
      'vis-config-pa-fps': poweraudioConfig.fps,
      'vis-config-pa-sensitivity': poweraudioConfig.sensitivity,
      'vis-config-pa-speed': poweraudioConfig.movementSpeed,
      'vis-config-pa-spikeheight': poweraudioConfig.spikeHeight,
      'vis-config-pa-nodecount': poweraudioConfig.nodeCount,
      'vis-config-pa-lineopacity': poweraudioConfig.lineOpacity,
      'vis-config-pa-sporefreq': poweraudioConfig.sporeFrequency,
      'vis-config-pa-sporechance': poweraudioConfig.sporeChance,
      'vis-config-pa-sporefade': poweraudioConfig.sporeFadeTime,
      'vis-config-pa-size': poweraudioConfig.creatureSize
    };

    Object.entries(sliders).forEach(([id, value]) => {
      const slider = document.getElementById(id);
      const valueEl = document.getElementById(`${id}-value`);
      if (slider) slider.value = value;
      if (valueEl) valueEl.textContent = value;
    });
  }

  function saveMilkdropConfig() {
    try {
      localStorage.setItem('visualizer-milkdrop-config', JSON.stringify(milkdropConfig));
    } catch (e) {}
  }

  function saveCircularConfig() {
    try {
      localStorage.setItem('visualizer-circular-config', JSON.stringify(circularConfig));
    } catch (e) {}
  }

  function applyMilkdropConfig() {
    if (milkdropMesh && milkdropMesh.material.uniforms) {
      milkdropMesh.material.uniforms.speed.value = milkdropConfig.speed;
      milkdropMesh.material.uniforms.intensity.value = milkdropConfig.intensity;
      milkdropMesh.material.uniforms.complexity.value = milkdropConfig.complexity;
      milkdropMesh.material.uniforms.glowAmount.value = milkdropConfig.glow;
    }
  }

  function applyCircularConfig() {
    // Ring points requires reinit, handled in render
  }

  function updateMilkdropConfigUI() {
    const sliders = {
      'vis-config-md-speed': milkdropConfig.speed,
      'vis-config-md-intensity': milkdropConfig.intensity,
      'vis-config-md-complexity': milkdropConfig.complexity,
      'vis-config-md-glow': milkdropConfig.glow
    };

    Object.entries(sliders).forEach(([id, value]) => {
      const slider = document.getElementById(id);
      const valueEl = document.getElementById(`${id}-value`);
      if (slider) slider.value = value;
      if (valueEl) valueEl.textContent = value;
    });
  }

  function updateCircularConfigUI() {
    const sliders = {
      'vis-config-circular-points': circularConfig.ringPoints,
      'vis-config-circular-glow': circularConfig.glow,
      'vis-config-circular-sensitivity': circularConfig.sensitivity,
      'vis-config-circular-rotation': circularConfig.rotation,
      'vis-config-circular-particles': circularConfig.particles
    };

    Object.entries(sliders).forEach(([id, value]) => {
      const slider = document.getElementById(id);
      const valueEl = document.getElementById(`${id}-value`);
      if (slider) slider.value = value;
      if (valueEl) valueEl.textContent = value;
    });
  }

  function updateConfigUI() {
    updateVisualizerBgUI();
    updateMilkdropConfigUI();
    updateCircularConfigUI();
    updatePowerAudioConfigUI();
  }

  function setupConfigPanel() {
    const configBtn = document.getElementById('visualizer-config-btn');
    const configPanel = document.getElementById('visualizer-config-panel');

    loadVisualizerConfig();
    updateConfigUI();

    configBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      configPanel?.classList.toggle('active');
    });

    // Fix: Don't close panel when clicking inside widget/visualizer
    document.addEventListener('click', (e) => {
      if (configPanel?.classList.contains('active')) {
        const isInsidePanel = configPanel.contains(e.target);
        const isConfigBtn = e.target === configBtn || configBtn?.contains(e.target);
        const isInsideWidget = e.target.closest('.widget-visualizer');

        if (!isInsidePanel && !isConfigBtn && !isInsideWidget) {
          configPanel.classList.remove('active');
        }
      }
    });

    // Background config handlers
    document.querySelectorAll('input[name="visualizer-bg"]').forEach(radio => {
      radio.addEventListener('change', (e) => {
        const bgType = e.target.value;
        visualizerBgConfig.background = bgType;
        const svgUpload = document.getElementById('visualizer-svg-upload');
        if (svgUpload) {
          svgUpload.style.display = bgType === 'svg' ? 'block' : 'none';
        }
        applyVisualizerBackground(bgType);
        saveVisualizerBgConfig();
      });
    });

    // SVG file input handler
    const svgInput = document.getElementById('visualizer-svg-input');
    svgInput?.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (file && file.type === 'image/svg+xml') {
        if (file.size > 500 * 1024) {
          alert('SVG file too large. Please use a file under 500KB.');
          e.target.value = '';
          return;
        }
        const reader = new FileReader();
        reader.onload = (ev) => {
          visualizerBgConfig.customSvg = ev.target.result;
          const preview = document.getElementById('visualizer-svg-preview');
          if (preview) {
            preview.innerHTML = `<img src="${ev.target.result}" alt="SVG Preview" style="max-width: 100%; max-height: 40px; border-radius: 4px;">`;
          }
          applyVisualizerBackground(visualizerBgConfig.background);
          saveVisualizerBgConfig();
        };
        reader.readAsDataURL(file);
      }
    });

    // SVG clear button
    document.getElementById('visualizer-svg-clear')?.addEventListener('click', () => {
      visualizerBgConfig.customSvg = null;
      const preview = document.getElementById('visualizer-svg-preview');
      if (preview) preview.innerHTML = '';
      const fileInput = document.getElementById('visualizer-svg-input');
      if (fileInput) fileInput.value = '';
      applyVisualizerBackground(visualizerBgConfig.background);
      saveVisualizerBgConfig();
    });

    // Blur slider/input sync
    const blurSlider = document.getElementById('visualizer-blur-slider');
    const blurInput = document.getElementById('visualizer-blur-input');
    blurSlider?.addEventListener('input', () => {
      if (blurInput) blurInput.value = blurSlider.value;
      visualizerBgConfig.svgBlur = parseInt(blurSlider.value) || 0;
      applyVisualizerBackground(visualizerBgConfig.background);
      saveVisualizerBgConfig();
    });
    blurInput?.addEventListener('input', () => {
      let val = parseInt(blurInput.value) || 0;
      val = Math.max(0, Math.min(30, val));
      blurInput.value = val;
      if (blurSlider) blurSlider.value = val;
      visualizerBgConfig.svgBlur = val;
      applyVisualizerBackground(visualizerBgConfig.background);
      saveVisualizerBgConfig();
    });

    // MilkDrop config sliders
    const milkdropSliders = [
      { id: 'vis-config-md-speed', key: 'speed' },
      { id: 'vis-config-md-intensity', key: 'intensity' },
      { id: 'vis-config-md-complexity', key: 'complexity' },
      { id: 'vis-config-md-glow', key: 'glow' }
    ];

    milkdropSliders.forEach(({ id, key }) => {
      const slider = document.getElementById(id);
      const valueDisplay = document.getElementById(`${id}-value`);
      slider?.addEventListener('input', (e) => {
        const value = parseFloat(e.target.value);
        milkdropConfig[key] = value;
        if (valueDisplay) valueDisplay.textContent = value;
        applyMilkdropConfig();
        saveMilkdropConfig();
      });
    });

    // MilkDrop preset dropdown
    const presetSelect = document.getElementById('vis-config-md-preset');
    if (presetSelect) {
      presetSelect.value = String(currentPresetIndex);
      // Prevent dropdown close issues
      presetSelect.addEventListener('mousedown', (e) => e.stopPropagation());
      presetSelect.addEventListener('click', (e) => e.stopPropagation());
      presetSelect.addEventListener('change', (e) => {
        const index = parseInt(e.target.value, 10);
        switchMilkdropPreset(index);
      });
    }

    // Circular config sliders
    const circularSliders = [
      { id: 'vis-config-circular-points', key: 'ringPoints' },
      { id: 'vis-config-circular-glow', key: 'glow' },
      { id: 'vis-config-circular-sensitivity', key: 'sensitivity' },
      { id: 'vis-config-circular-rotation', key: 'rotation' },
      { id: 'vis-config-circular-particles', key: 'particles' }
    ];

    circularSliders.forEach(({ id, key }) => {
      const slider = document.getElementById(id);
      const valueDisplay = document.getElementById(`${id}-value`);
      slider?.addEventListener('input', (e) => {
        const value = parseFloat(e.target.value);
        circularConfig[key] = value;
        if (valueDisplay) valueDisplay.textContent = value;
        applyCircularConfig();
        saveCircularConfig();
      });
    });

    // PowerAudio config (Creature)
    const colorToggle = document.getElementById('vis-config-pa-colorful');
    colorToggle?.addEventListener('click', () => {
      const isActive = colorToggle.classList.toggle('active');
      poweraudioConfig.colorVariation = isActive;
      colorToggle.setAttribute('data-value', String(isActive));
      if (poweraudioViz) {
        poweraudioViz.setConfig('colorVariation', isActive);
      }
      savePowerAudioConfig();
    });

    // FPS slider - special handling (updates targetFPS directly)
    const fpsSlider = document.getElementById('vis-config-pa-fps');
    const fpsValueDisplay = document.getElementById('vis-config-pa-fps-value');
    fpsSlider?.addEventListener('input', (e) => {
      const fps = parseInt(e.target.value);
      poweraudioConfig.fps = fps;
      if (fpsValueDisplay) fpsValueDisplay.textContent = fps;
      // Apply directly to PowerAudio stage
      if (poweraudioViz?.stage) {
        poweraudioViz.stage.targetFPS = fps;
        poweraudioViz.stage.frameInterval = 1000 / fps;
      }
      savePowerAudioConfig();
    });

    const powerAudioSliders = [
      { id: 'vis-config-pa-sensitivity', key: 'sensitivity' },
      { id: 'vis-config-pa-speed', key: 'movementSpeed' },
      { id: 'vis-config-pa-spikeheight', key: 'spikeHeight' },
      { id: 'vis-config-pa-nodecount', key: 'nodeCount' },
      { id: 'vis-config-pa-lineopacity', key: 'lineOpacity' },
      { id: 'vis-config-pa-sporefreq', key: 'sporeFrequency' },
      { id: 'vis-config-pa-sporechance', key: 'sporeChance' },
      { id: 'vis-config-pa-sporefade', key: 'sporeFadeTime' },
      { id: 'vis-config-pa-size', key: 'creatureSize' }
    ];

    powerAudioSliders.forEach(({ id, key }) => {
      const slider = document.getElementById(id);
      const valueDisplay = document.getElementById(`${id}-value`);
      slider?.addEventListener('input', (e) => {
        const value = parseFloat(e.target.value);
        poweraudioConfig[key] = value;
        if (valueDisplay) valueDisplay.textContent = value;
        if (poweraudioViz) {
          poweraudioViz.setConfig(key, value);
        }
        savePowerAudioConfig();
      });
    });

    // Reset buttons
    document.getElementById('vis-config-reset-milkdrop')?.addEventListener('click', () => {
      milkdropConfig = { ...defaultMilkdropConfig };
      updateMilkdropConfigUI();
      applyMilkdropConfig();
      saveMilkdropConfig();
    });

    document.getElementById('vis-config-reset-circular')?.addEventListener('click', () => {
      circularConfig = { ...defaultCircularConfig };
      updateCircularConfigUI();
      applyCircularConfig();
      saveCircularConfig();
    });

    document.getElementById('vis-config-reset-poweraudio')?.addEventListener('click', () => {
      console.log('Visualizer: Resetting PowerAudio to defaults:', defaultPowerAudioConfig);
      // Clear localStorage first
      localStorage.removeItem('visualizer-poweraudio-config');
      poweraudioConfig = { ...defaultPowerAudioConfig };
      updatePowerAudioConfigUI();
      applyPowerAudioConfig();
      savePowerAudioConfig();
    });
  }

  // ================================================================
  // INITIALIZATION
  // ================================================================

  function initVisualizer() {
    visualizerTauriAvailable = checkTauriAvailable();
    console.log('Visualizer: Init called, Tauri available:', visualizerTauriAvailable);

    const widget = document.getElementById('visualizer-widget');
    const fallback = document.getElementById('visualizer-fallback');

    if (!widget) {
      console.error('Visualizer: Widget not found');
      return;
    }

    if (typeof THREE === 'undefined') {
      console.error('Visualizer: Three.js not loaded');
      if (fallback) {
        fallback.style.display = 'flex';
        const span = fallback.querySelector('span');
        if (span) span.textContent = 'Three.js library not loaded';
      }
      return;
    }

    console.log('Visualizer: Three.js version', THREE.REVISION);

    const tryInit = async () => {
      const width = widget.clientWidth;
      const height = widget.clientHeight;

      if (width > 0 && height > 0) {
        console.log('Visualizer: Widget has dimensions, setting up...');

        // Load saved config BEFORE setting up mode navigation (which may init PowerAudio)
        loadVisualizerConfig();

        setupConfigPanel();
        setupThemeObserver();
        setupDeviceControls();

        // setupModeNavigation will restore saved mode and initialize the appropriate visualizer
        // Don't override with milkdrop after this!
        setupModeNavigation();

        isInitialized = true;

        // Start animation immediately
        animate(0);

        // Restart animation when document becomes visible
        document.addEventListener('visibilitychange', () => {
          if (!document.hidden && !animationId && isInitialized) {
            lastFrameTime = performance.now();
            animate(performance.now());
          }
        });

        // Populate devices and auto-connect to saved preference (or system-default)
        setTimeout(async () => {
          const selectedDevice = await populateDeviceSelector();
          if (selectedDevice) {
            // Auto-connect without saving (since we're restoring saved preference)
            await handleDeviceChange(selectedDevice, false);
          }
        }, 1000);
      } else {
        console.log('Visualizer: Waiting for widget dimensions...');
        setTimeout(tryInit, 100);
      }
    };

    setTimeout(tryInit, 500);
  }

  function cleanupVisualizer() {
    if (animationId) {
      cancelAnimationFrame(animationId);
      animationId = null;
    }

    stopNativeCapture();

    // Cleanup MilkDrop
    if (milkdropRenderer) {
      milkdropRenderer.dispose();
    }
    if (milkdropMesh) {
      milkdropMesh.geometry.dispose();
      milkdropMesh.material.dispose();
    }
    milkdropScene = null;
    milkdropCamera = null;
    milkdropRenderer = null;
    milkdropMesh = null;
    milkdropInitialized = false;

    // Cleanup PowerAudio
    if (poweraudioViz) {
      poweraudioViz.destroy();
      poweraudioViz = null;
    }
    poweraudioInitialized = false;

    // Cleanup Circular
    if (circularRenderer) {
      circularRenderer.dispose();
    }
    if (circularCore) {
      circularCore.geometry.dispose();
      circularCore.material.dispose();
    }
    if (circularRing) {
      circularRing.geometry.dispose();
      circularRing.material.dispose();
    }
    if (circularTorus) {
      circularTorus.geometry.dispose();
      circularTorus.material.dispose();
    }
    if (circularParticles) {
      circularParticles.geometry.dispose();
      circularParticles.material.dispose();
    }
    circularScene = null;
    circularCamera = null;
    circularRenderer = null;
    circularCore = null;
    circularRing = null;
    circularTorus = null;
    circularParticles = null;
    circularRingGeometry = null;
    circularInitialized = false;

    isInitialized = false;
  }

  // Export for settings panel
  window.setVisualizerMode = handleDeviceChange;
  window.setVisualizerDisplayMode = switchDisplayMode;

  // Handle page unload
  window.addEventListener('beforeunload', cleanupVisualizer);

  // Auto-initialize (with HMR protection)
  if (!window._visualizerInitialized) {
    window._visualizerInitialized = true;
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initVisualizer);
    } else {
      initVisualizer();
    }
  } else {
    console.log('Visualizer: Already initialized, skipping (HMR reload?)');
  }
})();
