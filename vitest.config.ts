import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/__tests__/**/*.test.ts'],
    environment: 'node',
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/presentation/*/main.ts', 'src/**/__tests__/**', 'src/**/index.ts', 'src/**/*.d.ts'],
      reporter: ['text', 'text-summary', 'html', 'lcov'],
      thresholds: { lines: 95, functions: 95, branches: 95, statements: 95 },
    },
  },
});
