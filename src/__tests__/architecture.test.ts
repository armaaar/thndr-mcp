/**
 * Architecture fitness functions (ADR 0015). They turn the Clean Architecture dependency rule, the bounded-context
 * map and the CQS conventions into build failures.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = resolve(__dirname, '..');

type Layer = 'domain' | 'application' | 'repositories' | 'data-sources' | 'presentation';
const LAYERS: readonly Layer[] = ['domain', 'application', 'repositories', 'data-sources', 'presentation'];
type Context = 'identity' | 'market-data' | 'portfolio' | 'engagement';
const CONTEXTS: readonly Context[] = ['identity', 'market-data', 'portfolio', 'engagement'];

/** Composition root and entrypoints may wire any layer. */
const COMPOSITION = new Set([
  'container.ts',
  'config.ts',
  'version.ts',
  'presentation/mcp/main.ts',
  'presentation/cli/main.ts',
]);

interface SourceFile {
  path: string; // relative to src, posix
  imports: string[]; // resolved relative paths (src-relative) or package names (pkg:<name>)
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return name === '__tests__' ? [] : walk(full);
    return full.endsWith('.ts') ? [full] : [];
  });
}

/** Static `import … from`, `export … from`, side-effect `import '…'` and dynamic `import('…')`. */
const IMPORT = /(?:^\s*(?:import|export)\s[^;]*?from\s+|^\s*import\s+|\bimport\s*\(\s*)'([^']+)'/gm;

const files: SourceFile[] = walk(SRC).map((full) => {
  const source = readFileSync(full, 'utf8');
  const imports = [...source.matchAll(IMPORT)].map(([, spec = '']) =>
    spec.startsWith('.')
      ? relative(SRC, resolve(dirname(full), spec)).replaceAll('\\', '/')
      : `pkg:${spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : (spec.split('/')[0] ?? spec)}`,
  );
  return { path: relative(SRC, full).replaceAll('\\', '/'), imports };
});

const layerOf = (path: string): Layer | null => LAYERS.find((l) => path.startsWith(`${l}/`)) ?? null;
const contextOf = (path: string): Context | null => {
  const [layer, context] = path.split('/');
  return layer === 'domain' || layer === 'application' ? (CONTEXTS.find((c) => c === context) ?? null) : null;
};

/** Allowed target layers per source layer (Clean Architecture, 5 layers). */
const ALLOWED_LAYERS: Record<Layer, readonly Layer[]> = {
  domain: ['domain'],
  application: ['application', 'domain'],
  repositories: ['repositories', 'data-sources', 'application', 'domain'],
  'data-sources': ['data-sources', 'application'],
  presentation: ['presentation', 'application', 'domain'],
};

/** Third-party packages each layer may use. The domain is pure. */
const ALLOWED_PACKAGES: Record<Layer, (pkg: string) => boolean> = {
  domain: () => false,
  application: (p) => p === 'zod',
  repositories: () => false,
  'data-sources': (p) => p.startsWith('node:') || p.startsWith('@firebase/'),
  presentation: (p) =>
    p === 'zod' || p === 'qrcode' || p.startsWith('node:') || p.startsWith('@modelcontextprotocol/'),
};

/** Context map: which bounded contexts each context may depend on (besides itself and the shared kernel). */
const CONTEXT_MAP: Record<Context, readonly Context[]> = {
  identity: [],
  'market-data': [],
  portfolio: ['market-data'],
  engagement: ['market-data'],
};

/** What an upstream context publishes to its customers. */
const PUBLISHED: Record<Context, (path: string) => boolean> = {
  identity: () => false,
  'market-data': (p) =>
    p.startsWith('domain/market-data/') || p.startsWith('application/market-data/services/'),
  portfolio: () => false,
  engagement: () => false,
};

function violations(check: (file: SourceFile, target: string) => string | null): string[] {
  return files.flatMap((file) =>
    file.imports.map((target) => check(file, target)).filter((v): v is string => v !== null),
  );
}

describe('architecture: Clean Architecture layers', () => {
  it('the import parser sees the codebase (guards against a silently vacuous suite)', () => {
    expect(files.flatMap((f) => f.imports).length).toBeGreaterThan(500);
    expect(files.find((f) => f.path === 'container.ts')?.imports).toContain(
      'repositories/thndr/auth-gateway',
    );
  });

  it('has the five layers', () => {
    for (const layer of LAYERS) expect(files.some((f) => layerOf(f.path) === layer)).toBe(true);
  });

  it('every source file belongs to a layer or to the composition root', () => {
    expect(
      files.filter((f) => layerOf(f.path) === null && !COMPOSITION.has(f.path)).map((f) => f.path),
    ).toEqual([]);
  });

  it('dependencies point inward (dependency rule)', () => {
    const found = violations((file, target) => {
      if (COMPOSITION.has(file.path) || target.startsWith('pkg:')) return null;
      const from = layerOf(file.path);
      const to = layerOf(target);
      if (from === null) return null;
      if (to === null) return `${file.path} → ${target} (composition root)`;
      return ALLOWED_LAYERS[from].includes(to) ? null : `${file.path} → ${target}`;
    });
    expect(found).toEqual([]);
  });

  it('data sources only use application ports and errors; presentation only shared-kernel errors from the domain', () => {
    const found = violations((file, target) => {
      const from = layerOf(file.path);
      if (from === 'data-sources' && layerOf(target) === 'application') {
        return target.startsWith('application/ports/') || target === 'application/errors'
          ? null
          : `${file.path} → ${target}`;
      }
      if (from === 'presentation' && layerOf(target) === 'domain' && !COMPOSITION.has(file.path)) {
        return target === 'domain/shared-kernel/errors' ? null : `${file.path} → ${target}`;
      }
      return null;
    });
    expect(found).toEqual([]);
  });

  it('third-party packages stay in their layer (the domain is pure)', () => {
    const found = violations((file, target) => {
      if (!target.startsWith('pkg:') || COMPOSITION.has(file.path)) return null;
      const from = layerOf(file.path);
      return from && !ALLOWED_PACKAGES[from](target.slice(4)) ? `${file.path} → ${target}` : null;
    });
    expect(found).toEqual([]);
  });
});

describe('architecture: bounded contexts', () => {
  it('each bounded context exists in the domain and application layers', () => {
    for (const context of CONTEXTS) {
      expect(files.some((f) => f.path.startsWith(`domain/${context}/`))).toBe(true);
      expect(files.some((f) => f.path.startsWith(`application/${context}/`))).toBe(true);
    }
  });

  it('contexts depend only on themselves, the shared kernel and their published upstreams (context map)', () => {
    const found = violations((file, target) => {
      const from = contextOf(file.path);
      const to = contextOf(target);
      if (from === null || to === null || from === to) return null;
      return CONTEXT_MAP[from].includes(to) && PUBLISHED[to](target) ? null : `${file.path} → ${target}`;
    });
    expect(found).toEqual([]);
  });

  it('the domain of one context never imports another context’s domain', () => {
    const found = violations((file, target) => {
      const from = file.path.startsWith('domain/') ? contextOf(file.path) : null;
      const to = target.startsWith('domain/') ? contextOf(target) : null;
      return from && to && from !== to && !CONTEXT_MAP[from].includes(to) ? `${file.path} → ${target}` : null;
    });
    expect(found).toEqual([]);
  });

  it('context-specific ports are used only by their context and the adapters implementing them', () => {
    const found = violations((file, target) => {
      if (target !== 'application/ports/identity' || COMPOSITION.has(file.path)) return null;
      const layer = layerOf(file.path);
      const ok = layer === 'repositories' || layer === 'data-sources' || contextOf(file.path) === 'identity';
      return ok ? null : `${file.path} → ${target}`;
    });
    expect(found).toEqual([]);
  });

  it('the shared kernel depends on nothing but itself', () => {
    const found = violations((file, target) =>
      file.path.startsWith('domain/shared-kernel/') && !target.startsWith('domain/shared-kernel/')
        ? `${file.path} → ${target}`
        : null,
    );
    expect(found).toEqual([]);
  });
});

describe('architecture: CQS use cases', () => {
  const useCaseFiles = files.filter((f) => /^application\/[^/]+\/(commands|queries)\//.test(f.path));

  it('every file in queries/ declares exactly one Query, every file in commands/ exactly one Command', () => {
    const wrong = useCaseFiles.filter((f) => {
      const source = readFileSync(join(SRC, f.path), 'utf8');
      const queries = source.match(/extends Query</g)?.length ?? 0;
      const commands = source.match(/extends Command</g)?.length ?? 0;
      const classes = source.match(/^export (abstract )?class /gm)?.length ?? 0;
      return f.path.includes('/queries/')
        ? !(queries === 1 && commands === 0 && classes === 1)
        : !(commands === 1 && queries === 0 && classes === 1);
    });
    expect(useCaseFiles.length).toBeGreaterThan(30);
    expect(wrong.map((f) => f.path)).toEqual([]);
  });

  it('use cases never depend on other use cases (shared logic lives in services/)', () => {
    const found = useCaseFiles.flatMap((f) =>
      f.imports
        .filter((t) => /^application\/[^/]+\/(commands|queries)\//.test(t))
        .map((t) => `${f.path} → ${t}`),
    );
    expect(found).toEqual([]);
  });

  it('the presentation layer contains no use cases', () => {
    const found = files
      .filter((f) => f.path.startsWith('presentation/'))
      .filter((f) => /extends (Query|Command)</.test(readFileSync(join(SRC, f.path), 'utf8')))
      .map((f) => f.path);
    expect(found).toEqual([]);
  });
});
