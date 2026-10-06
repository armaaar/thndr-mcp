import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult, ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { Logger } from '../../application/ports/logger';
import { Command, type UseCase } from '../../application/use-case';
import { runAndPresent } from '../presenters/outcome';
import { isRecord } from '../presenters/view';
import { LoginOnDemand } from './login-on-demand';

export const SERVER_INSTRUCTIONS = `Unofficial MCP server for Thndr (Egyptian Exchange broker), built on the private API of ThndrX.
- Read-only for money: it can analyse markets, the account, positions, orders and activity, and manage watchlists
  and price alerts, but it cannot place, modify or cancel orders or move funds. Users trade in the Thndr app.
- Login: just call the tool you need. If there is no session and the client supports elicitation, the server asks
  the user for their email, the emailed code and the phone approval itself, then answers the call. Otherwise log in
  step by step: login_start(email) → login_verify_code(code) → the user approves in the Thndr mobile app →
  login_complete; on SESSION_EXPIRED use login_request_approval then login_complete.
- Instruments can be referenced by ticker (e.g. COMI) or Thndr asset id. Default market is "egypt"; prices are EGP.`;

/** MCP tool annotations derived from the use case's CQRS kind and flags. */
export function annotationsFor(useCase: UseCase): ToolAnnotations {
  const isCommand = useCase instanceof Command;
  return {
    title: useCase.title,
    readOnlyHint: !isCommand,
    destructiveHint: isCommand && useCase.destructive,
    idempotentHint: !isCommand || useCase.idempotent,
    openWorldHint: !useCase.local,
  };
}

/**
 * The schema handed to the MCP SDK. It *advertises* the use case's contract (JSON Schema of the strict input object)
 * but *accepts* any object, so validation happens in `UseCase.run` only. Otherwise the SDK would validate first —
 * silently dropping unknown fields and answering invalid input with a plain-text protocol error instead of the
 * `INVALID_INPUT` error view the CLI prints (ADR 0012: identical results for identical input).
 */
export function toolInputSchema(useCase: UseCase): z.ZodType {
  const { $schema: _, ...contract } = z.toJSONSchema(z.object(useCase.input).strict(), {
    io: 'input',
    target: 'draft-7',
  });
  return z.looseObject({}).meta(contract);
}

function text(value: unknown): CallToolResult['content'] {
  return [{ type: 'text', text: JSON.stringify(value, null, 2) }];
}

/**
 * Driving adapter: exposes every use case as an MCP tool with the use case's own name, description and schema. A call
 * that fails for lack of a session triggers the login on demand (ADR 0016) and is retried once.
 */
export function registerUseCases(server: McpServer, useCases: readonly UseCase[], logger?: Logger): void {
  const loginOnDemand = new LoginOnDemand(server.server, useCases, logger);
  for (const useCase of useCases) {
    server.registerTool(
      useCase.name,
      {
        title: useCase.title,
        description: useCase.description,
        inputSchema: toolInputSchema(useCase),
        annotations: annotationsFor(useCase),
      },
      async (args: unknown): Promise<CallToolResult> => {
        let outcome = await runAndPresent(useCase, args, logger);
        if (!outcome.ok && loginOnDemand.applies(useCase, outcome.error.error)) {
          const login = await loginOnDemand.login();
          if (!login.ok) return { isError: true, content: text({ ...outcome.error, login: login.message }) };
          outcome = await runAndPresent(useCase, args, logger);
        }
        if (!outcome.ok) return { isError: true, content: text(outcome.error) };
        return {
          content: text(outcome.view),
          ...(isRecord(outcome.view) ? { structuredContent: outcome.view } : {}),
        };
      },
    );
  }
}

export interface ServerOptions {
  name?: string;
  version: string;
  useCases: readonly UseCase[];
  logger?: Logger;
}

export function createMcpServer(options: ServerOptions): McpServer {
  const server = new McpServer(
    { name: options.name ?? 'thndr-mcp', version: options.version },
    { instructions: SERVER_INSTRUCTIONS },
  );
  registerUseCases(server, options.useCases, options.logger);
  return server;
}
