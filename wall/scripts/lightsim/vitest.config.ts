import { defineConfig } from 'vitest/config';

// The light sync sandbox only: node, no jsdom, no React.
export default defineConfig({
  test: { environment: 'node', include: [process.env.LIGHTSIM_ONLY ?? 'scripts/lightsim/**/lightsim.run.ts'], testTimeout: 600_000 },
});
