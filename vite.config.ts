import { defineConfig } from 'vite';
import mkcert from 'vite-plugin-mkcert';

export default defineConfig({
  plugins: [mkcert()],
  // Use src as the root directory for plain HTML/CSS/JS
  root: 'src',

  // Prevent Vite from obscuring Rust errors
  clearScreen: false,

  // Tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    https: true, // Required for Twitch embed
    watch: {
      // Ignore Tauri source files
      ignored: ['**/src-tauri/**'],
    },
  },

  // Env variables starting with TAURI_ are available in the client
  envPrefix: ['VITE_', 'TAURI_'],

  build: {
    // Output to dist folder (relative to project root, not src)
    outDir: '../dist',
    emptyOutDir: true,
    // Tauri uses Chromium on Windows and WebKit on macOS and Linux
    target: process.env.TAURI_PLATFORM === 'windows' ? 'chrome105' : 'safari13',
    // Don't minify for debug builds
    minify: !process.env.TAURI_DEBUG ? 'esbuild' : false,
    // Produce sourcemaps for debug builds
    sourcemap: !!process.env.TAURI_DEBUG,
  },
});
