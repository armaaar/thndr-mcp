import { z } from 'zod';
import { NotFoundError } from '../../application/errors';
import {
  type BoundedContext,
  Command,
  type InputOf,
  type InputShape,
  Query,
  type Receipt,
} from '../../application/use-case';

export interface FakeUseCaseSpec<Shape extends InputShape> {
  name: string;
  context?: BoundedContext;
  title?: string;
  description?: string;
  input?: Shape;
  local?: boolean;
  handler?: (input: InputOf<Shape>) => unknown;
}

/** A small concrete query whose behaviour is given by `handler` (drives the presentation layer without the app). */
export class FakeQuery<Shape extends InputShape = InputShape> extends Query<Shape> {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly context: BoundedContext;
  readonly input: Shape;
  override readonly local: boolean;
  private readonly handler: (input: InputOf<Shape>) => unknown;

  constructor(spec: FakeUseCaseSpec<Shape>) {
    super();
    this.name = spec.name;
    this.title = spec.title ?? `Title ${spec.name}`;
    this.description = spec.description ?? `Description ${spec.name}`;
    this.context = spec.context ?? 'identity';
    this.input = spec.input ?? ({} as Shape);
    this.local = spec.local ?? false;
    this.handler = spec.handler ?? (() => ({ ok: true }));
  }

  async execute(input: InputOf<Shape>): Promise<unknown> {
    return this.handler(input);
  }
}

/** A small concrete command, optionally destructive and/or idempotent. */
export class FakeCommand<Shape extends InputShape = InputShape> extends Command<Shape> {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly context: BoundedContext;
  readonly input: Shape;
  override readonly local: boolean;
  override readonly destructive: boolean;
  override readonly idempotent: boolean;
  private readonly handler: (input: InputOf<Shape>) => unknown;

  constructor(spec: FakeUseCaseSpec<Shape> & { destructive?: boolean; idempotent?: boolean }) {
    super();
    this.name = spec.name;
    this.title = spec.title ?? `Title ${spec.name}`;
    this.description = spec.description ?? `Description ${spec.name}`;
    this.context = spec.context ?? 'engagement';
    this.input = spec.input ?? ({} as Shape);
    this.local = spec.local ?? false;
    this.destructive = spec.destructive ?? false;
    this.idempotent = spec.idempotent ?? false;
    this.handler = spec.handler ?? (() => ({ ok: true }));
  }

  async execute(input: InputOf<Shape>): Promise<Receipt> {
    return (await this.handler(input)) as Receipt;
  }
}

/** A few use cases spanning every bounded context and kind, used to drive the CLI and MCP adapters. */
export function fakeUseCases() {
  return [
    new FakeQuery({
      context: 'identity',
      name: 'auth_status',
      title: 'Session status',
      description: 'Shows the session.',
      local: true,
      handler: () => ({ authenticated: true, expiresAt: new Date('2026-03-01T10:15:00Z') }),
    }),
    new FakeQuery({
      context: 'market-data',
      name: 'get_price_snapshot',
      title: 'Price snapshot',
      description: 'Quotes for symbols.',
      input: {
        symbols: z.array(z.string().min(1)).min(1),
        market: z.enum(['egypt', 'us']).default('egypt').describe('Market'),
      },
      handler: ({ symbols, market }) => {
        if (symbols.includes('NONE')) throw new NotFoundError('No egypt instrument with ticker NONE.');
        return { market, quotes: symbols.map((s, i) => ({ ticker: s, last: 10 + i })) };
      },
    }),
    new FakeQuery({
      context: 'portfolio',
      name: 'get_position',
      title: 'Position',
      description: 'One position.',
      input: {
        symbol: z.string().min(1),
        includeSellable: z.boolean().default(false),
        timeoutSeconds: z.number().int().optional(),
      },
      handler: ({ symbol, includeSellable, timeoutSeconds }) => ({
        symbol,
        held: false,
        includeSellable,
        timeoutSeconds: timeoutSeconds ?? null,
      }),
    }),
    new FakeCommand({
      context: 'engagement',
      name: 'delete_watchlist',
      title: 'Delete watchlist',
      description: 'Deletes a watchlist.',
      destructive: true,
      idempotent: true,
      input: { id: z.string().min(1).describe('Watchlist id') },
      handler: ({ id }) => ({ deleted: true, id }),
    }),
    new FakeCommand({
      context: 'engagement',
      name: 'create_watchlist',
      title: 'Create watchlist',
      description: 'Creates a watchlist.',
      input: {
        name: z.string().min(1),
        symbols: z.array(z.string()).default([]),
        levels: z.array(z.number()).optional(),
      },
      handler: ({ name, symbols }) => ({ name, symbols }),
    }),
  ];
}

export function byName<T extends { name: string }>(useCases: readonly T[], name: string): T {
  const found = useCases.find((u) => u.name === name);
  if (!found) throw new Error(`fake: no use case ${name}`);
  return found;
}
