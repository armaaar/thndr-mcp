import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { NotAuthenticatedError, UpstreamError } from '../../../src/application/errors.js';
import { ValidationError } from '../../../src/domain/shared-kernel/errors.js';
import { Ticker } from '../../../src/domain/shared-kernel/ticker.js';
import { defineTool, failure, READ_ONLY, success } from '../../../src/interfaces/catalog/operation.js';
import { SERVER_INSTRUCTIONS } from '../../../src/interfaces/mcp/server.js';
import { type ConnectedClient, connect } from '../../support/mcp-client.js';

describe('success / failure', () => {
  it('normalises value objects and dates; only objects become structured content', () => {
    const out = success({ t: Ticker.of('comi'), at: new Date('2026-01-01T00:00:00Z') });
    expect(out.structuredContent).toEqual({ t: 'COMI', at: '2026-01-01T00:00:00.000Z' });
    expect(success([1, 2]).structuredContent).toBeUndefined();
    expect(success(undefined).content).toEqual([{ type: 'text', text: 'null' }]);
    expect(success('x').structuredContent).toBeUndefined();
  });

  it('maps domain, application, upstream and unexpected errors', () => {
    const parse = (r: ReturnType<typeof failure>) => JSON.parse((r.content[0] as { text: string }).text);
    expect(parse(failure(new ValidationError('bad')))).toEqual({ error: 'VALIDATION_ERROR', message: 'bad' });
    expect(parse(failure(new NotAuthenticatedError())).error).toBe('NOT_AUTHENTICATED');
    expect(parse(failure(new UpstreamError('boom', 502, 'X')))).toEqual({
      error: 'UPSTREAM_ERROR',
      message: 'boom',
      status: 502,
      upstreamCode: 'X',
    });
    expect(parse(failure(new UpstreamError('plain')))).toEqual({ error: 'UPSTREAM_ERROR', message: 'plain' });
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const unexpected = failure(new Error('kaput'), logger);
    expect(unexpected.isError).toBe(true);
    expect(parse(unexpected)).toEqual({ error: 'INTERNAL_ERROR', message: 'kaput' });
    expect(logger.error).toHaveBeenCalled();
    expect(parse(failure('str'))).toEqual({ error: 'INTERNAL_ERROR', message: 'str' });
  });
});

describe('MCP server', () => {
  let conn: ConnectedClient;
  afterEach(async () => conn?.close());

  it('registers tools with schemas, annotations and instructions, and routes calls', async () => {
    const echo = defineTool({
      name: 'echo',
      title: 'Echo',
      description: 'Echoes',
      input: { text: z.string(), times: z.number().int().default(1) },
      annotations: READ_ONLY,
      handler: async ({ text, times }) => ({ text: text.repeat(times) }),
    });
    const broken = defineTool({
      name: 'broken',
      title: 'Broken',
      description: 'Throws',
      input: {},
      annotations: READ_ONLY,
      handler: async () => {
        throw new ValidationError('nope');
      },
    });
    conn = await connect([echo, broken]);
    expect(conn.client.getInstructions()).toBe(SERVER_INSTRUCTIONS);
    const { tools } = await conn.client.listTools();
    expect(tools.map((t) => t.name)).toEqual(['echo', 'broken']);
    expect(tools[0]?.annotations?.readOnlyHint).toBe(true);
    expect(tools[0]?.inputSchema.properties).toHaveProperty('text');

    const ok = await conn.call('echo', { text: 'ab', times: 2 });
    expect(ok.json).toEqual({ text: 'abab' });
    expect(ok.structuredContent).toEqual({ text: 'abab' });

    const err = await conn.call('broken');
    expect(err.isError).toBe(true);
    expect(err.json).toEqual({ error: 'VALIDATION_ERROR', message: 'nope' });

    const invalid = await conn.call('echo', { text: 5 });
    expect(invalid.isError).toBe(true);
    expect(String(invalid.json)).toMatch(/Input validation error|Invalid/i);
  });
});
