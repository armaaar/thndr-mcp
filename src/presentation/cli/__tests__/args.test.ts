import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { FakeCommand, FakeQuery } from '../../../__tests__/support/fake-use-cases';
import type { InputShape } from '../../../application/use-case';
import { CliUsageError, describeInput, parseCommandArgs } from '../args';

/** A use case with the given input; `name` selects its CLI positionals (see CLI_POSITIONALS). */
const query = (input: InputShape, name = 'demo') => new FakeQuery({ name, input });

describe('describeInput', () => {
  it('derives flags, types, requiredness, defaults and descriptions from the input contract', () => {
    const specs = describeInput({
      symbol: z.string().describe('Ticker'),
      barsCount: z.number().int().optional(),
      includeSellable: z.boolean().default(false),
      market: z.enum(['egypt', 'us']).default('egypt').describe('Market'),
      symbols: z.array(z.string()).min(1),
      ids: z.array(z.number()).optional(),
      sides: z.array(z.enum(['buy', 'sell'])).default([]),
      innerDescribed: z.string().describe('Inner text').optional(),
      plain: z.string().optional(),
    });
    expect(specs).toEqual([
      { name: 'symbol', flag: 'symbol', type: 'string', required: true, description: 'Ticker' },
      { name: 'barsCount', flag: 'bars-count', type: 'number', required: false },
      {
        name: 'includeSellable',
        flag: 'include-sellable',
        type: 'boolean',
        required: false,
        defaultValue: false,
      },
      {
        name: 'market',
        flag: 'market',
        type: 'enum',
        options: ['egypt', 'us'],
        required: false,
        defaultValue: 'egypt',
        description: 'Market',
      },
      { name: 'symbols', flag: 'symbols', type: 'array', itemType: 'string', required: true },
      { name: 'ids', flag: 'ids', type: 'array', itemType: 'number', required: false },
      {
        name: 'sides',
        flag: 'sides',
        type: 'array',
        itemType: 'enum',
        options: ['buy', 'sell'],
        required: false,
        defaultValue: [],
      },
      {
        name: 'innerDescribed',
        flag: 'inner-described',
        type: 'string',
        required: false,
        description: 'Inner text',
      },
      { name: 'plain', flag: 'plain', type: 'string', required: false },
    ]);
  });

  it('prefers the outer description and unwraps nested optional/default wrappers', () => {
    const [spec] = describeInput({ x: z.number().describe('inner').optional().default(3).describe('outer') });
    expect(spec).toEqual({
      name: 'x',
      flag: 'x',
      type: 'number',
      required: false,
      defaultValue: 3,
      description: 'outer',
    });
  });

  it('treats other schemas (e.g. refined strings) as strings', () => {
    const [spec] = describeInput({ from: z.string().refine(() => true) });
    expect(spec?.type).toBe('string');
  });
});

describe('parseCommandArgs', () => {
  const shape = {
    symbol: z.string(),
    timeoutSeconds: z.number().optional(),
    includeSellable: z.boolean().default(false),
    symbols: z.array(z.string()).optional(),
    levels: z.array(z.number()).optional(),
  };

  it('maps kebab-case flags to camelCase input fields and coerces numbers and booleans', () => {
    expect(
      parseCommandArgs(query(shape), ['--symbol', 'COMI', '--timeout-seconds', '10', '--include-sellable']),
    ).toEqual({
      input: { symbol: 'COMI', timeoutSeconds: 10, includeSellable: true },
      json: false,
      help: false,
    });
    expect(parseCommandArgs(query(shape), ['--symbol=HRHO', '--timeout-seconds=2.5']).input).toEqual({
      symbol: 'HRHO',
      timeoutSeconds: 2.5,
    });
  });

  it('does not accept the camelCase field name as a flag', () => {
    expect(() => parseCommandArgs(query(shape), ['--timeoutSeconds', '5'])).toThrow(CliUsageError);
  });

  it('leaves invalid numbers as strings for schema validation to report', () => {
    expect(parseCommandArgs(query(shape), ['--timeout-seconds', 'ten']).input).toEqual({
      timeoutSeconds: 'ten',
    });
    expect(parseCommandArgs(query(shape), ['--timeout-seconds', ' ']).input).toEqual({ timeoutSeconds: ' ' });
    expect(parseCommandArgs(query(shape), ['--timeout-seconds', 'Infinity']).input).toEqual({
      timeoutSeconds: 'Infinity',
    });
  });

  it('accepts repeated and comma-separated array flags, dropping empty items', () => {
    expect(
      parseCommandArgs(query(shape), ['--symbols', 'COMI,HRHO', '--symbols', ' ETEL ', '--symbols', 'a,,'])
        .input,
    ).toEqual({ symbols: ['COMI', 'HRHO', 'ETEL', 'a'] });
    expect(parseCommandArgs(query(shape), ['--levels', '1,2', '--levels', 'x']).input).toEqual({
      levels: [1, 2, 'x'],
    });
  });

  it('fills positionals in order, coercing them like flags', () => {
    const createAlert = new FakeCommand({
      name: 'create_alert',
      input: { symbol: z.string(), price: z.number(), note: z.string().optional() },
    });
    expect(parseCommandArgs(createAlert, ['COMI', '85.5']).input).toEqual({ symbol: 'COMI', price: 85.5 });
    expect(parseCommandArgs(createAlert, ['COMI']).input).toEqual({ symbol: 'COMI' });
    expect(parseCommandArgs(createAlert, []).input).toEqual({});
  });

  it('lets an array positional absorb the remaining arguments', () => {
    const create = new FakeCommand({
      name: 'create_watchlist',
      input: { name: z.string(), symbols: z.array(z.string()) },
    });
    expect(parseCommandArgs(create, ['Banks', 'COMI', 'HRHO,ETEL', '--json'])).toEqual({
      input: { name: 'Banks', symbols: ['COMI', 'HRHO', 'ETEL'] },
      json: true,
      help: false,
    });
  });

  it('skips positional names that are not input fields', () => {
    // CLI_POSITIONALS.create_watchlist is ['name', 'symbols']; this contract has no `name`.
    const odd = query({ symbols: z.array(z.string()) }, 'create_watchlist');
    expect(parseCommandArgs(odd, ['COMI', 'HRHO']).input).toEqual({ symbols: ['COMI', 'HRHO'] });
  });

  it('has no positionals for use cases that declare none', () => {
    expect(() => parseCommandArgs(query(shape), ['COMI'])).toThrow(CliUsageError);
  });

  it('rejects a value given both as a flag and a positional', () => {
    const position = query(shape, 'get_position');
    expect(() => parseCommandArgs(position, ['COMI', '--symbol', 'HRHO'])).toThrow(CliUsageError);
    expect(() => parseCommandArgs(position, ['COMI', '--symbol', 'HRHO'])).toThrow(
      '"symbol" was given both as a flag and a positional',
    );
  });

  it('rejects extra positionals', () => {
    expect(() => parseCommandArgs(query(shape, 'get_position'), ['COMI', 'HRHO', 'X'])).toThrow(
      'Unexpected argument(s): HRHO X',
    );
  });

  it('rejects unknown flags and missing flag values as usage errors', () => {
    expect(() => parseCommandArgs(query(shape), ['--nope'])).toThrow(CliUsageError);
    expect(() => parseCommandArgs(query(shape), ['--symbol'])).toThrow(CliUsageError);
    try {
      parseCommandArgs(query(shape), ['--nope']);
    } catch (error) {
      expect((error as Error).name).toBe('CliUsageError');
      expect((error as Error).message).toMatch(/nope/);
    }
  });

  it('recognises --json, --help and -h', () => {
    expect(parseCommandArgs(query(shape), ['--json'])).toEqual({ input: {}, json: true, help: false });
    expect(parseCommandArgs(query(shape), ['--help'])).toMatchObject({ help: true, json: false });
    expect(parseCommandArgs(query(shape), ['-h'])).toMatchObject({ help: true });
  });
});
