import { parseArgs } from 'node:util';
import { z } from 'zod';
import type { InputShape, UseCase } from '../../application/use-case';
import { CLI_POSITIONALS, flagName } from './positionals';

export type FieldType = 'string' | 'number' | 'boolean' | 'enum' | 'array';

export interface FieldSpec {
  /** Input field name (as in the use-case contract and the MCP schema). */
  name: string;
  /** CLI flag without dashes (kebab-case). */
  flag: string;
  type: FieldType;
  itemType?: 'string' | 'number' | 'enum';
  options?: readonly string[];
  required: boolean;
  defaultValue?: unknown;
  description?: string;
}

/** Thrown for malformed command lines (unknown flag, missing value, extra positional…). */
export class CliUsageError extends Error {
  override name = 'CliUsageError';
}

function baseType(schema: z.ZodType): { type: FieldType; options?: readonly string[] } {
  if (schema instanceof z.ZodNumber) return { type: 'number' };
  if (schema instanceof z.ZodBoolean) return { type: 'boolean' };
  if (schema instanceof z.ZodEnum) return { type: 'enum', options: schema.options as string[] };
  if (schema instanceof z.ZodArray) return { type: 'array' };
  return { type: 'string' };
}

/** Derives CLI flag specs from a use case's input contract (the same schema the MCP server publishes). */
export function describeInput(shape: InputShape): FieldSpec[] {
  return Object.entries(shape).map(([name, schema]) => {
    let inner: z.ZodType = schema;
    let required = true;
    let defaultValue: unknown;
    let description = schema.description;
    while (inner instanceof z.ZodOptional || inner instanceof z.ZodDefault) {
      required = false;
      if (inner instanceof z.ZodDefault) defaultValue = inner.def.defaultValue;
      inner = inner.def.innerType as z.ZodType;
      description ??= inner.description;
    }
    const { type, options } = baseType(inner);
    const spec: FieldSpec = { name, flag: flagName(name), type, required };
    if (options) spec.options = options;
    if (type === 'array') {
      const item = baseType((inner as z.ZodArray<z.ZodType>).element);
      spec.itemType = item.type === 'number' ? 'number' : item.type === 'enum' ? 'enum' : 'string';
      if (item.options) spec.options = item.options;
    }
    if (defaultValue !== undefined) spec.defaultValue = defaultValue;
    if (description) spec.description = description;
    return spec;
  });
}

function coerce(spec: FieldSpec, raw: string | boolean | Array<string | boolean>): unknown {
  if (spec.type === 'boolean') return raw;
  if (spec.type === 'array') {
    const items = (Array.isArray(raw) ? raw : [raw])
      .flatMap((v) => String(v).split(','))
      .map((v) => v.trim());
    const present = items.filter((v) => v.length > 0);
    return spec.itemType === 'number' ? present.map(toNumber) : present;
  }
  const value = String(raw);
  return spec.type === 'number' ? toNumber(value) : value;
}

/** Numbers are converted when well-formed; otherwise the raw string is kept so schema validation reports it. */
function toNumber(value: string): number | string {
  const n = Number(value);
  return value.trim() !== '' && Number.isFinite(n) ? n : value;
}

export interface ParsedCommand {
  input: Record<string, unknown>;
  json: boolean;
  help: boolean;
}

/**
 * Parses `argv` (everything after the command name) into the use case's raw input. Values are validated by
 * `UseCase.run`, so CLI and MCP apply identical rules.
 */
export function parseCommandArgs(useCase: UseCase, argv: readonly string[]): ParsedCommand {
  const specs = describeInput(useCase.input);
  const options: Record<string, { type: 'string' | 'boolean'; multiple?: boolean; short?: string }> = {
    json: { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  };
  for (const spec of specs) {
    options[spec.flag] = {
      type: spec.type === 'boolean' ? 'boolean' : 'string',
      multiple: spec.type === 'array',
    };
  }
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({ args: [...argv], options, allowPositionals: true, strict: true });
  } catch (error) {
    throw new CliUsageError((error as Error).message);
  }
  const input: Record<string, unknown> = {};
  for (const spec of specs) {
    const raw = parsed.values[spec.flag];
    if (raw !== undefined) input[spec.name] = coerce(spec, raw);
  }

  const positionals = [...parsed.positionals];
  for (const name of CLI_POSITIONALS[useCase.name] ?? []) {
    if (positionals.length === 0) break;
    const spec = specs.find((s) => s.name === name);
    if (!spec) continue;
    if (input[name] !== undefined)
      throw new CliUsageError(`"${spec.flag}" was given both as a flag and a positional`);
    input[name] =
      spec.type === 'array'
        ? coerce(spec, positionals.splice(0))
        : coerce(spec, positionals.shift() as string);
  }
  if (positionals.length > 0) throw new CliUsageError(`Unexpected argument(s): ${positionals.join(' ')}`);
  return { input, json: parsed.values.json === true, help: parsed.values.help === true };
}
