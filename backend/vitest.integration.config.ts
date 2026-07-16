import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/integration/**/*.integration.ts'],
    environment: 'node',
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
