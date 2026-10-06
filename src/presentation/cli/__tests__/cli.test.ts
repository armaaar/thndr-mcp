import { describe, expect, it, vi } from 'vitest';
import { byName, FakeQuery, fakeUseCases } from '../../../__tests__/support/fake-use-cases';
import { fakeLogger } from '../../../__tests__/support/identity-fakes';
import type { UseCase } from '../../../application/use-case';
import { type CliOptions, EXIT_FAILURE, EXIT_OK, EXIT_USAGE, runCli } from '../cli';
import { renderCommandHelp, renderOverview } from '../help';

function harness(overrides: Partial<CliOptions> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const useCases = overrides.useCases ?? fakeUseCases();
  const options: CliOptions = {
    useCases,
    version: '1.2.3',
    io: { out: (t) => out.push(t), err: (t) => err.push(t) },
    ...overrides,
  };
  return { out, err, useCases, run: (...argv: string[]) => runCli(argv, options) };
}

describe('runCli — help and version', () => {
  it.each([[[]], [['help']], [['--help']], [['-h']]])('prints the overview for %j', async (argv) => {
    const h = harness();
    expect(await h.run(...argv)).toBe(EXIT_OK);
    expect(h.out).toEqual([renderOverview(h.useCases, '1.2.3')]);
    expect(h.err).toEqual([]);
  });

  it('prints command help for `help <command>` (kebab or snake case)', async () => {
    const h = harness();
    expect(await h.run('help', 'get-position')).toBe(EXIT_OK);
    expect(await h.run('help', 'get_position')).toBe(EXIT_OK);
    const expected = renderCommandHelp(byName(h.useCases, 'get_position'));
    expect(h.out).toEqual([expected, expected]);
  });

  it('fails with a usage error for `help <unknown>`', async () => {
    const h = harness();
    expect(await h.run('help', 'nope')).toBe(EXIT_USAGE);
    expect(h.err).toEqual(['Unknown command "nope". Run `thndr help` to list commands.']);
    expect(h.out).toEqual([]);
  });

  it.each(['--version', '-v', 'version'])('prints the version for %s', async (flag) => {
    const h = harness();
    expect(await h.run(flag)).toBe(EXIT_OK);
    expect(h.out).toEqual(['1.2.3']);
  });
});

describe('runCli — login', () => {
  it('routes `login` to the interactive wizard when provided', async () => {
    const interactiveLogin = vi.fn(async () => 7);
    const h = harness({ interactiveLogin });
    expect(await h.run('login')).toBe(7);
    expect(interactiveLogin).toHaveBeenCalledOnce();
  });

  it('treats `login` as an unknown command without a wizard', async () => {
    const h = harness();
    expect(await h.run('login')).toBe(EXIT_USAGE);
    expect(h.err).toEqual(['Unknown command "login". Run `thndr help`.']);
  });
});

describe('runCli — unknown commands', () => {
  it('suggests commands sharing the first word', async () => {
    const h = harness();
    expect(await h.run('get-prices')).toBe(EXIT_USAGE);
    expect(h.err).toEqual([
      'Unknown command "get-prices". Did you mean: get-price-snapshot, get-position? Run `thndr help`.',
    ]);
  });

  it('strips leading dashes before suggesting and limits suggestions to five', async () => {
    const many = Array.from({ length: 7 }, (_, i) => new FakeQuery({ name: `delete_x${i}` }));
    const h = harness({ useCases: many });
    expect(await h.run('--delete')).toBe(EXIT_USAGE);
    expect(h.err[0]).toBe(
      'Unknown command "--delete". Did you mean: delete-x0, delete-x1, delete-x2, delete-x3, delete-x4? Run `thndr help`.',
    );
  });

  it('prints no suggestion when nothing is close', async () => {
    const h = harness();
    expect(await h.run('zzz')).toBe(EXIT_USAGE);
    expect(await h.run('--')).toBe(EXIT_USAGE);
    expect(h.err).toEqual([
      'Unknown command "zzz". Run `thndr help`.',
      'Unknown command "--". Run `thndr help`.',
    ]);
  });
});

describe('runCli — running use cases', () => {
  it('prints command help for --help without running the use case', async () => {
    const useCases = fakeUseCases();
    const target = byName(useCases, 'get_position');
    const execute = vi.spyOn(target, 'execute');
    const h = harness({ useCases });
    expect(await h.run('get-position', '--help')).toBe(EXIT_OK);
    expect(await h.run('get-position', '-h')).toBe(EXIT_OK);
    expect(h.out).toEqual([renderCommandHelp(target), renderCommandHelp(target)]);
    expect(execute).not.toHaveBeenCalled();
  });

  it('reports usage errors with the message followed by the command help', async () => {
    const h = harness();
    expect(await h.run('get-position', 'COMI', 'EXTRA')).toBe(EXIT_USAGE);
    expect(h.err).toEqual([
      `Unexpected argument(s): EXTRA\n\n${renderCommandHelp(byName(h.useCases, 'get_position'))}`,
    ]);
    expect(await h.run('get-position', '--bogus')).toBe(EXIT_USAGE);
    expect(h.err[1]).toMatch(/bogus/);
    expect(h.out).toEqual([]);
  });

  it('rethrows non-usage errors raised while parsing', async () => {
    const broken = new FakeQuery({ name: 'broken' });
    Object.defineProperty(broken, 'input', { value: null });
    const h = harness({ useCases: [broken as UseCase] });
    await expect(h.run('broken')).rejects.toThrow(TypeError);
  });

  it('prints the view as text by default', async () => {
    const h = harness();
    expect(await h.run('get-price-snapshot', 'COMI', 'HRHO')).toBe(EXIT_OK);
    expect(h.out).toEqual([
      ['market: egypt', 'quotes:', '  ticker  last', '  ------  ----', '  COMI    10', '  HRHO    11'].join(
        '\n',
      ),
    ]);
    expect(h.err).toEqual([]);
  });

  it('prints the exact JSON view with --json', async () => {
    const h = harness();
    expect(await h.run('auth-status', '--json')).toBe(EXIT_OK);
    expect(h.out[0]).toBe(
      JSON.stringify({ authenticated: true, expiresAt: '2026-03-01T10:15:00.000Z' }, null, 2),
    );
  });

  it('accepts the snake_case use-case name as the command and kebab-case flags', async () => {
    const h = harness();
    expect(
      await h.run('get_position', 'COMI', '--include-sellable', '--timeout-seconds', '5', '--json'),
    ).toBe(EXIT_OK);
    expect(JSON.parse(h.out[0] as string)).toEqual({
      symbol: 'COMI',
      held: false,
      includeSellable: true,
      timeoutSeconds: 5,
    });
  });

  it('exits 1 on use-case failure, as text or JSON on stderr', async () => {
    const logger = fakeLogger();
    const h = harness({ logger });
    expect(await h.run('get-price-snapshot', 'NONE')).toBe(EXIT_FAILURE);
    expect(h.err).toEqual(['Error [NOT_FOUND]: No egypt instrument with ticker NONE.']);
    expect(await h.run('get-price-snapshot', 'NONE', '--json')).toBe(EXIT_FAILURE);
    expect(h.err[1]).toBe(
      JSON.stringify({ error: 'NOT_FOUND', message: 'No egypt instrument with ticker NONE.' }, null, 2),
    );
    expect(h.out).toEqual([]);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('logs unexpected failures through the logger', async () => {
    const logger = fakeLogger();
    const boom = new FakeQuery({
      name: 'boom',
      handler: () => {
        throw new Error('kaput');
      },
    });
    const h = harness({ useCases: [boom], logger });
    expect(await h.run('boom')).toBe(EXIT_FAILURE);
    expect(h.err).toEqual(['Error [INTERNAL_ERROR]: kaput']);
    expect(logger.error).toHaveBeenCalledOnce();
  });

  it('exits 2 on invalid input, as text or JSON', async () => {
    const h = harness();
    expect(await h.run('get-price-snapshot', '--market', 'mars')).toBe(EXIT_USAGE);
    expect(h.err[0]).toMatch(/^Error \[INVALID_INPUT\]: /);
    expect(h.err[0]).toMatch(/symbols/);
    expect(h.err[0]).toMatch(/market/);
    expect(await h.run('get-position', 'COMI', '--timeout-seconds', 'soon', '--json')).toBe(EXIT_USAGE);
    expect(JSON.parse(h.err[1] as string)).toMatchObject({
      error: 'INVALID_INPUT',
      message: expect.stringMatching(/^timeoutSeconds: /),
    });
  });
});
