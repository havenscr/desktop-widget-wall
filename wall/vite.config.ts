import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 1421, strictPort: true },
  build: { target: 'es2022' },
  test: {
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./src/test-setup.ts'],
    // frameLayout.test.ts reads frame.css as text (?raw) to hold it to the shared constants;
    // screens/Home.test.tsx reads home.css the same way for its zone columns.
    css: { include: [/frame\.css/, /home\.css/] },
  },
});
