import { describe, expect, it } from 'vitest';
import { CLI_POSITIONALS, commandName, flagName } from '../../../src/presentation/cli/positionals';

describe('commandName', () => {
  it('turns the snake_case use-case name into a kebab-case command', () => {
    expect(commandName({ name: 'get_price_history' })).toBe('get-price-history');
    expect(commandName({ name: 'logout' })).toBe('logout');
  });
});

describe('flagName', () => {
  it('turns camelCase and snake_case fields into kebab-case flags', () => {
    expect(flagName('timeoutSeconds')).toBe('timeout-seconds');
    expect(flagName('minRelativeVolume')).toBe('min-relative-volume');
    expect(flagName('include_sellable')).toBe('include-sellable');
    expect(flagName('symbol')).toBe('symbol');
  });
});

describe('CLI_POSITIONALS', () => {
  it('lists positional fields per use case, an array field last', () => {
    expect(CLI_POSITIONALS.get_price_snapshot).toEqual(['symbols']);
    expect(CLI_POSITIONALS.create_watchlist).toEqual(['name', 'symbols']);
    expect(CLI_POSITIONALS.login_import_session).toEqual(['cookieHeader']);
  });
});
