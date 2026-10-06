import { type BoundedContext, Command, type UseCase } from '../../application/use-case';
import { terminalDisclaimer } from '../presenters/disclaimer';
import { describeInput, type FieldSpec } from './args';
import { CLI_POSITIONALS, commandName } from './positionals';

const CONTEXT_TITLES: Record<BoundedContext, string> = {
  identity: 'Session',
  'market-data': 'Market data',
  portfolio: 'Portfolio (read-only)',
  engagement: 'Watchlists, alerts & notifications',
};

export function renderOverview(useCases: readonly UseCase[], version: string): string {
  const width = Math.max(...useCases.map((u) => commandName(u).length), 'login'.length);
  const lines = [
    `thndr ${version} — unofficial CLI for Thndr (EGX). Same use cases as the thndr-mcp MCP server.`,
    '',
    'Usage: thndr <command> [arguments] [--json] [--help]',
    '',
  ];
  for (const context of Object.keys(CONTEXT_TITLES) as BoundedContext[]) {
    const inContext = useCases.filter((u) => u.context === context);
    if (inContext.length === 0) continue;
    lines.push(`${CONTEXT_TITLES[context]}:`);
    if (context === 'identity') {
      lines.push(
        `  ${'login'.padEnd(width)}  Guided login (login-start → login-verify-code → login-complete)`,
      );
    }
    for (const useCase of inContext) lines.push(`  ${commandName(useCase).padEnd(width)}  ${useCase.title}`);
    lines.push('');
  }
  lines.push(
    'Run `thndr <command> --help` for the arguments of a command. Add --json for machine-readable output.',
    '',
    terminalDisclaimer(),
  );
  return lines.join('\n');
}

function valueHint(spec: FieldSpec): string {
  if (spec.type === 'boolean') return '';
  if (spec.options) return ` <${spec.options.join('|')}>`;
  if (spec.type === 'array') return ` <${spec.itemType ?? 'value'}>…`;
  return ` <${spec.type}>`;
}

function kindLabel(useCase: UseCase): string {
  if (!(useCase instanceof Command)) return 'query (read-only)';
  return useCase.destructive ? 'command (destructive)' : 'command';
}

export function renderCommandHelp(useCase: UseCase): string {
  const specs = describeInput(useCase.input);
  const positionals = (CLI_POSITIONALS[useCase.name] ?? []).map((name) => {
    const spec = specs.find((s) => s.name === name);
    const label = spec?.type === 'array' ? `${name}…` : name;
    return spec?.required ? `<${label}>` : `[${label}]`;
  });
  const lines = [
    `thndr ${commandName(useCase)}${positionals.length ? ` ${positionals.join(' ')}` : ''} [options]`,
    '',
    useCase.description,
    '',
    `Kind: ${kindLabel(useCase)}. MCP tool: ${useCase.name}.`,
  ];
  if (specs.length) {
    lines.push('', 'Options:');
    for (const spec of specs) {
      const notes = [
        spec.required ? 'required' : undefined,
        spec.defaultValue !== undefined ? `default: ${JSON.stringify(spec.defaultValue)}` : undefined,
      ].filter(Boolean);
      const description = spec.description ? `  ${spec.description}` : '';
      lines.push(
        `  --${spec.flag}${valueHint(spec)}${description}${notes.length ? ` (${notes.join(', ')})` : ''}`,
      );
    }
  }
  lines.push('  --json  Print the raw JSON result (same as the MCP tool output)');
  return lines.join('\n');
}
