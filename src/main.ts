#!/usr/bin/env node
import { createInterface } from 'node:readline/promises';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { compose } from './composition.js';
import { loadConfig } from './config.js';
import { runLoginCommand } from './interface/cli/login-command.js';
import { createMcpServer } from './interface/mcp/server.js';
import { VERSION } from './version.js';

async function main(): Promise<void> {
  const app = compose(loadConfig());
  const command = process.argv[2];

  if (command === 'login') {
    // The CLI is interactive, so it may use the terminal (stdout) — it does not speak MCP.
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      process.exitCode = await runLoginCommand(app.identityUseCases, {
        prompt: (q) => rl.question(q),
        print: (line) => process.stdout.write(`${line}\n`),
      });
    } finally {
      rl.close();
    }
    return;
  }
  if (command === '--version' || command === '-v') {
    process.stdout.write(`${VERSION}\n`);
    return;
  }

  const server = createMcpServer({ version: VERSION, tools: app.tools, logger: app.logger });
  await server.connect(new StdioServerTransport());
  app.logger.info('thndr-mcp: ready on stdio', { tools: app.tools.length });
}

main().catch((error: unknown) => {
  process.stderr.write(`thndr-mcp: fatal: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
