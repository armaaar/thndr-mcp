import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import {
  type CallToolResult,
  type ElicitRequest,
  ElicitRequestSchema,
  type ElicitResult,
} from '@modelcontextprotocol/sdk/types.js';
import type { Logger } from '../../application/ports/logger';
import type { UseCase } from '../../application/use-case';
import { createMcpServer } from '../../presentation/mcp/server';

export interface ConnectedClient {
  client: Client;
  call(name: string, args?: Record<string, unknown>): Promise<CallToolResult & { json: unknown }>;
  close(): Promise<void>;
}

export type ElicitHandler = (params: ElicitRequest['params']) => ElicitResult | Promise<ElicitResult>;

/**
 * Spins up the real MCP server in-process and connects a real MCP client to it. With `elicit`, the client declares
 * form elicitation and answers the server's questions with it.
 */
export async function connect(
  useCases: readonly UseCase[],
  logger?: Logger,
  options: { elicit?: ElicitHandler } = {},
): Promise<ConnectedClient> {
  const server = createMcpServer({ version: '0.0.0-test', useCases, logger });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client(
    { name: 'test-client', version: '1.0.0' },
    options.elicit ? { capabilities: { elicitation: { form: {} } } } : {},
  );
  const { elicit } = options;
  if (elicit) client.setRequestHandler(ElicitRequestSchema, (request) => elicit(request.params));
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return {
    client,
    async call(name, args = {}) {
      const result = (await client.callTool({ name, arguments: args })) as CallToolResult;
      const first = result.content?.[0];
      let json: unknown;
      if (first && first.type === 'text') {
        try {
          json = JSON.parse(first.text);
        } catch {
          json = first.text;
        }
      }
      return { ...result, json };
    },
    async close() {
      await client.close();
      await server.close();
    },
  };
}
