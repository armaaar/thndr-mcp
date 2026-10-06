/**
 * Finds the call sites of an API path in the synced ThndrX bundle, beautifying matching chunks on demand.
 *
 *   npx tsx .claude/skills/sync-thndr-api/scripts/find-call-sites.ts "/market-service/v3/orders" [context-lines]
 *
 * Requires `npm run sync:api` first (bundle in .cache/thndr-bundle/js).
 */
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import beautify from 'js-beautify';

export function matchesWithContext(source: string, fragment: string, context: number): string[] {
  const lines = source.split('\n');
  const blocks: string[] = [];
  lines.forEach((line, index) => {
    if (!line.includes(fragment)) return;
    const from = Math.max(0, index - context);
    const to = Math.min(lines.length, index + context + 1);
    blocks.push(
      lines
        .slice(from, to)
        .map((l, i) => `${from + i + 1}${from + i === index ? ':' : '-'}${l}`)
        .join('\n'),
    );
  });
  return blocks;
}

async function main(): Promise<void> {
  const [fragment, contextArg] = process.argv.slice(2);
  if (!fragment) throw new Error('usage: find-call-sites.ts <path-fragment> [context-lines]');
  const context = Number(contextArg ?? 12);
  const root = resolve('.cache/thndr-bundle');
  const jsDir = join(root, 'js');
  const prettyDir = join(root, 'pretty');
  if (!existsSync(jsDir)) throw new Error(`No bundle at ${jsDir} — run: npm run sync:api`);
  await mkdir(prettyDir, { recursive: true });

  let found = 0;
  for (const name of (await readdir(jsDir)).filter((f) => f.endsWith('.js')).sort()) {
    const raw = await readFile(join(jsDir, name), 'utf8');
    if (!raw.includes(fragment)) continue;
    const prettyPath = join(prettyDir, name);
    let pretty: string;
    if (existsSync(prettyPath)) pretty = await readFile(prettyPath, 'utf8');
    else {
      pretty = beautify.js(raw, { indent_size: 2 });
      await writeFile(prettyPath, pretty);
    }
    found++;
    process.stdout.write(
      `=== ${name} ===\n${matchesWithContext(pretty, fragment, context).join('\n--\n')}\n`,
    );
  }
  if (found === 0) process.stderr.write(`No call sites for "${fragment}" in the synced bundle.\n`);
}

if (process.argv[1]?.endsWith('find-call-sites.ts')) {
  main().catch((error: unknown) => {
    process.stderr.write(`${(error as Error).message}\n`);
    process.exit(1);
  });
}
