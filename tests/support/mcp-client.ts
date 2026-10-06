import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { Logger } from '../../src/application/ports/logger';
import type { UseCase } from '../../src/application/use-case';
import { createMcpServer } from '../../src/presentation/mcp/server';

export interface ConnectedClient {
  client: Client;
  call(name: string, args?: Record<string, unknown>): Promise<CallToolResult & { json: unknown }>;
  close(): Promise<void>;
}

/** Spins up the real MCP server in-process and connects a real MCP client to it. */
export async function connect(useCases: readonly UseCase[], logger?: Logger): Promise<ConnectedClient> {
  const server = createMcpServer({ version: '0.0.0-test', useCases, logger });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '1.0.0' });
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
