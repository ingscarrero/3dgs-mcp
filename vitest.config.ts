import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    restoreMocks: true,
    unstubGlobals: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // Stdio bootstrap only; exercised manually via `npm start` and the container.
      exclude: ['src/index.ts'],
      reporter: ['text', 'lcov', 'json-summary'],
      reportsDirectory: 'coverage',
      // Floors are set 3 points below the measured baseline (see README "Testing").
      thresholds: { lines: 96, functions: 97, branches: 96, statements: 96 },
    },
  },
});
