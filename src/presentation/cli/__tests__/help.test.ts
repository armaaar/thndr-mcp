import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { byName, FakeCommand, FakeQuery, fakeUseCases } from '../../../__tests__/support/fake-use-cases';
import { terminalDisclaimer } from '../../presenters/disclaimer';
import { renderCommandHelp, renderOverview } from '../help';

const useCase = (name: string) => byName(fakeUseCases(), name);

describe('renderOverview', () => {
  it('groups commands by bounded context with aligned titles and lists the login wizard', () => {
    const out = renderOverview(fakeUseCases(), '9.9.9');
    const lines = out.split('\n');
    expect(lines[0]).toBe(
      'thndr 9.9.9 — unofficial CLI for Thndr (Egypt, US, UAE, simulator). Same use cases as the thndr-mcp MCP server.',
    );
    expect(out).toContain('Usage: thndr <command> [arguments] [--json] [--help]');
    const sections = [
      'Session:',
      'Market data:',
      'Portfolio (read-only):',
      'Watchlists, alerts & notifications:',
    ];
    const indexes = sections.map((s) => lines.indexOf(s));
    expect(indexes.every((i) => i > 0)).toBe(true);
    expect([...indexes].sort((a, b) => a - b)).toEqual(indexes);
    expect(lines[(indexes[0] as number) + 1]).toBe(
      `  ${'login'.padEnd(18)}  Guided login (login-start → login-verify-code → login-complete)`,
    );
    expect(lines[(indexes[0] as number) + 2]).toBe('  auth-status         Session status');
    expect(out).toContain('  get-price-snapshot  Price snapshot');
    expect(out).toContain('  get-position        Position');
    expect(out).toContain('  delete-watchlist    Delete watchlist');
    expect(out).toContain('  create-watchlist    Create watchlist');
    expect(out).toContain('Run `thndr <command> --help`');
    expect(out.endsWith(terminalDisclaimer())).toBe(true);
  });

  it('keeps the login line aligned when every command name is shorter than "login"', () => {
    const out = renderOverview([new FakeQuery({ name: 'me', title: 'Me', context: 'identity' })], '1');
    expect(out).toContain('  login  Guided login');
    expect(out).toContain('  me     Me');
  });

  it('skips empty contexts and omits login when there is no identity context', () => {
    const out = renderOverview(
      fakeUseCases().filter((u) => u.context === 'portfolio'),
      '1.0.0',
    );
    expect(out).toContain('Portfolio (read-only):');
    expect(out).not.toContain('Session:');
    expect(out).not.toContain('Market data:');
    expect(out).not.toContain('login');
    expect(out).toContain('  get-position  Position');
  });
});

describe('renderCommandHelp', () => {
  it('shows a required array positional, enum options, defaults and the MCP tool name', () => {
    expect(renderCommandHelp(useCase('get_price_snapshot')).split('\n')).toEqual([
      'thndr get-price-snapshot <symbols…> [options]',
      '',
      'Quotes for symbols.',
      '',
      'Kind: query (read-only). MCP tool: get_price_snapshot.',
      '',
      'Options:',
      '  --symbols <string>… (required)',
      '  --market <egypt|us>  Market (default: "egypt")',
      '  --json  Print the raw JSON result (same as the MCP tool output)',
    ]);
  });

  it('marks destructive commands, required options and boolean flags without a value hint', () => {
    const help = renderCommandHelp(useCase('delete_watchlist'));
    expect(help).toContain('thndr delete-watchlist <id> [options]');
    expect(help).toContain('Kind: command (destructive). MCP tool: delete_watchlist.');
    expect(help).toContain('  --id <string>  Watchlist id (required)');
    const position = renderCommandHelp(useCase('get_position'));
    expect(position).toContain('thndr get-position <symbol> [options]');
    expect(position).toContain('  --include-sellable (default: false)');
    expect(position).toContain('  --timeout-seconds <number>\n');
  });

  it('shows optional positionals in brackets and plain command kinds', () => {
    const help = renderCommandHelp(useCase('create_watchlist'));
    expect(help).toContain('thndr create-watchlist <name> [symbols…] [options]');
    expect(help).toContain('Kind: command. MCP tool: create_watchlist.');
    expect(help).toContain('  --symbols <string>… (default: [])');
    expect(help).toContain('  --levels <number>…');
  });

  it('renders commands without inputs or positionals', () => {
    expect(renderCommandHelp(useCase('auth_status')).split('\n')).toEqual([
      'thndr auth-status [options]',
      '',
      'Shows the session.',
      '',
      'Kind: query (read-only). MCP tool: auth_status.',
      '  --json  Print the raw JSON result (same as the MCP tool output)',
    ]);
  });

  it('treats a positional that is not an input field as optional', () => {
    // CLI_POSITIONALS.get_watchlist is ['id']; this contract has no `id`.
    const odd = new FakeQuery({
      name: 'get_watchlist',
      context: 'engagement',
      input: { sides: z.array(z.enum(['buy', 'sell'])) },
    });
    const help = renderCommandHelp(odd);
    expect(help).toContain('thndr get-watchlist [id] [options]');
    expect(help).toContain('  --sides <buy|sell> (required)');
  });

  it('labels a non-destructive idempotent command as a plain command', () => {
    const help = renderCommandHelp(new FakeCommand({ name: 'touch', idempotent: true }));
    expect(help).toContain('Kind: command. MCP tool: touch.');
  });
});
