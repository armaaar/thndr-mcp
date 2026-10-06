#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig } from '../../config';
import { compose } from '../../container';
import { VERSION } from '../../version';
import { createMcpServer } from './server';

async function main(): Promise<void> {
  if (process.argv[2] === '--version' || process.argv[2] === '-v') {
    process.stdout.write(`${VERSION}\n`);
    return;
  }
  const app = compose(loadConfig());
  const server = createMcpServer({ version: VERSION, useCases: app.useCases, logger: app.logger });
  await server.connect(new StdioServerTransport());
  app.logger.info('thndr-mcp: ready on stdio', { tools: app.useCases.length });
}

main().catch((error: unknown) => {
  process.stderr.write(`thndr-mcp: fatal: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
