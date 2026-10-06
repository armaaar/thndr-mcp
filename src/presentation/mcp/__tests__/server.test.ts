import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { FakeCommand, FakeQuery } from '../../../__tests__/support/fake-use-cases';
import { fakeLogger } from '../../../__tests__/support/identity-fakes';
import { type ConnectedClient, connect } from '../../../__tests__/support/mcp-client';
import { NotFoundError } from '../../../application/errors';
import { annotationsFor, createMcpServer, registerUseCases, SERVER_INSTRUCTIONS } from '../server';

describe('annotationsFor', () => {
  it('marks queries read-only, idempotent and open-world', () => {
    expect(annotationsFor(new FakeQuery({ name: 'q' }))).toEqual({
      title: 'Title q',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    });
  });

  it('marks plain commands as writes that are neither destructive nor idempotent', () => {
    expect(annotationsFor(new FakeCommand({ name: 'c' }))).toEqual({
      title: 'Title c',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    });
  });

  it('carries the destructive and idempotent flags of commands', () => {
    expect(annotationsFor(new FakeCommand({ name: 'd', destructive: true, idempotent: true }))).toMatchObject(
      {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
      },
    );
  });

  it('closes the world for local use cases', () => {
    expect(annotationsFor(new FakeQuery({ name: 'l', local: true }))).toMatchObject({
      readOnlyHint: true,
      openWorldHint: false,
    });
    expect(annotationsFor(new FakeCommand({ name: 'lc', local: true }))).toMatchObject({
      readOnlyHint: false,
      openWorldHint: false,
    });
  });
});

describe('MCP server', () => {
  let conn: ConnectedClient | undefined;
  afterEach(async () => {
    await conn?.close();
    conn = undefined;
  });

  const useCases = [
    new FakeQuery({
      name: 'status',
      local: true,
      handler: () => ({ authenticated: false, at: new Date(0) }),
    }),
    new FakeQuery({
      name: 'list_things',
      input: { limit: z.number().int().min(1).default(2) },
      handler: ({ limit }) => Array.from({ length: limit ?? 2 }, (_, i) => ({ id: i })),
    }),
    new FakeQuery({ name: 'count', handler: () => 7 }),
    new FakeCommand({
      name: 'remove_thing',
      destructive: true,
      idempotent: true,
      input: { id: z.string().describe('Thing id') },
      handler: () => {
        throw new NotFoundError('No thing');
      },
    }),
    new FakeQuery({
      name: 'explode',
      handler: () => {
        throw new Error('unexpected');
      },
    }),
  ];

  it('lists every use case as a tool with its name, title, description, schema and annotations', async () => {
    conn = await connect(useCases);
    const { tools } = await conn.client.listTools();
    expect(tools.map((t) => t.name)).toEqual(useCases.map((u) => u.name));
    for (const tool of tools) {
      const useCase = useCases.find((u) => u.name === tool.name);
      expect(tool.description).toBe(useCase?.description);
      expect(tool.title).toBe(useCase?.title);
    }
    const remove = tools.find((t) => t.name === 'remove_thing');
    expect(remove).toMatchObject({
      title: 'Title remove_thing',
      description: 'Description remove_thing',
      annotations: {
        title: 'Title remove_thing',
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
      inputSchema: { type: 'object', required: ['id'], additionalProperties: false },
    });
    expect((remove?.inputSchema.properties as Record<string, unknown> | undefined)?.id).toMatchObject({
      type: 'string',
      description: 'Thing id',
    });
    const list = tools.find((t) => t.name === 'list_things');
    expect((list?.inputSchema.properties as Record<string, unknown> | undefined)?.limit).toMatchObject({
      type: 'integer',
      minimum: 1,
      default: 2,
    });
    expect(tools.find((t) => t.name === 'status')?.annotations).toMatchObject({
      readOnlyHint: true,
      openWorldHint: false,
    });
  });

  it('advertises the server name, version and instructions', async () => {
    conn = await connect(useCases);
    expect(conn.client.getServerVersion()).toEqual({ name: 'thndr-mcp', version: '0.0.0-test' });
    expect(conn.client.getInstructions()).toBe(SERVER_INSTRUCTIONS);
    expect(SERVER_INSTRUCTIONS).toMatch(/login_start/);
    expect(SERVER_INSTRUCTIONS).toContain('Nothing it or an AI assistant produces is financial advice');
    expect(SERVER_INSTRUCTIONS).toContain('not personalised investment advice');
    expect(SERVER_INSTRUCTIONS).toContain('never assume EGP');
    expect(SERVER_INSTRUCTIONS).toContain('get_markets');
  });

  it('accepts a custom server name', () => {
    const server = createMcpServer({ name: 'custom', version: '1.2.3', useCases: [] });
    expect(server.server).toBeDefined();
  });

  it('returns object views as text and structured content', async () => {
    conn = await connect(useCases);
    const result = await conn.call('status');
    expect(result.isError).toBeFalsy();
    expect(result.json).toEqual({ authenticated: false, at: '1970-01-01T00:00:00.000Z' });
    expect(result.structuredContent).toEqual(result.json);
    expect((result.content as Array<{ text: string }>)[0]?.text).toBe(JSON.stringify(result.json, null, 2));
  });

  it('returns array and scalar views as text only (no structured content)', async () => {
    conn = await connect(useCases);
    const list = await conn.call('list_things', { limit: 3 });
    expect(list.json).toEqual([{ id: 0 }, { id: 1 }, { id: 2 }]);
    expect(list.structuredContent).toBeUndefined();
    expect((await conn.call('list_things')).json).toEqual([{ id: 0 }, { id: 1 }]);
    const count = await conn.call('count');
    expect(count.json).toBe(7);
    expect(count.structuredContent).toBeUndefined();
  });

  it('returns failures as isError results with the error view', async () => {
    const logger = fakeLogger();
    conn = await connect(useCases, logger);
    const missing = await conn.call('remove_thing', { id: 'x' });
    expect(missing.isError).toBe(true);
    expect(missing.json).toEqual({ error: 'NOT_FOUND', message: 'No thing' });
    expect(missing.structuredContent).toBeUndefined();

    const boom = await conn.call('explode');
    expect(boom.isError).toBe(true);
    expect(boom.json).toEqual({ error: 'INTERNAL_ERROR', message: 'unexpected' });
    expect(logger.error).toHaveBeenCalledOnce();
  });

  it('reports invalid input as an INVALID_INPUT error view', async () => {
    conn = await connect(useCases);
    const result = await conn.call('list_things', { limit: 0 });
    expect(result.isError).toBe(true);
    expect(result.json).toMatchObject({ error: 'INVALID_INPUT', message: expect.stringMatching(/^limit: /) });
  });

  it('rejects unknown arguments like every other interface', async () => {
    conn = await connect(useCases);
    const result = await conn.call('list_things', { limit: 1, max: 3 });
    expect(result.isError).toBe(true);
    expect(result.json).toMatchObject({ error: 'INVALID_INPUT' });
  });

  it('runs a no-argument tool when the client sends no arguments at all', async () => {
    conn = await connect(useCases);
    const result = await conn.client.callTool({ name: 'status' });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({ authenticated: false, at: '1970-01-01T00:00:00.000Z' });
  });
});

describe('registerUseCases', () => {
  it('passes the raw arguments to the use case (missing arguments are an empty input)', async () => {
    const callbacks = new Map<string, (args: unknown) => Promise<unknown>>();
    const server = {
      registerTool: (name: string, _config: unknown, cb: (args: unknown) => Promise<unknown>) => {
        callbacks.set(name, cb);
      },
    } as unknown as McpServer;
    registerUseCases(server, [new FakeQuery({ name: 'status', handler: () => ({ fine: true }) })]);
    expect(await callbacks.get('status')?.(undefined)).toEqual({
      content: [{ type: 'text', text: JSON.stringify({ fine: true }, null, 2) }],
      structuredContent: { fine: true },
    });
    expect(await callbacks.get('status')?.({ extra: 1 })).toMatchObject({ isError: true });
  });
});
