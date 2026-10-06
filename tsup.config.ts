import { defineConfig } from 'tsup';

/**
 * Production build (ADR 0014): source imports are extensionless, so the two entrypoints are bundled by esbuild.
 * npm dependencies stay external (installed alongside the package).
 */
export default defineConfig({
  entry: {
    'thndr-mcp': 'src/presentation/mcp/main.ts',
    thndr: 'src/presentation/cli/main.ts',
  },
  format: ['esm'],
  platform: 'node',
  target: 'node20',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  splitting: true,
});
