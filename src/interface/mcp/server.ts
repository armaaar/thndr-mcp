import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Logger } from '../../application/ports/logger.js';
import { type AnyTool, registerTools } from './tool.js';

export const SERVER_INSTRUCTIONS = `Unofficial MCP server for Thndr (Egyptian Exchange broker), built on the private API of ThndrX.
- Read-only for money: it can analyse markets, the account, positions, orders and activity, and manage watchlists
  and price alerts, but it cannot place, modify or cancel orders or move funds. Users trade in the Thndr app.
- Login is interactive: login_start(email) → login_verify_code(code) → the user approves in the Thndr mobile app →
  login_complete. When a tool returns SESSION_EXPIRED use login_request_approval then login_complete.
- Instruments can be referenced by ticker (e.g. COMI) or Thndr asset id. Default market is "egypt"; prices are EGP.`;

export interface ServerOptions {
  name?: string;
  version: string;
  tools: ReadonlyArray<AnyTool>;
  logger?: Logger;
}

export function createMcpServer(options: ServerOptions): McpServer {
  const server = new McpServer(
    { name: options.name ?? 'thndr-mcp', version: options.version },
    { instructions: SERVER_INSTRUCTIONS },
  );
  registerTools(server, options.tools, options.logger);
  return server;
}
