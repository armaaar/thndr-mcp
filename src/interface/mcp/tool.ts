import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult, ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import type { z } from 'zod';
import { ApplicationError, UpstreamError } from '../../application/errors.js';
import type { Logger } from '../../application/ports/logger.js';
import { DomainError } from '../../domain/shared/errors.js';

export type ZodShape = Record<string, z.ZodType>;

export interface ToolDefinition<Shape extends ZodShape = ZodShape> {
  name: string;
  title: string;
  description: string;
  input: Shape;
  annotations: ToolAnnotations;
  handler: (args: z.infer<z.ZodObject<Shape>>) => Promise<unknown>;
}

/** A tool with its argument type erased, so heterogeneous tools fit in one list. */
export type AnyTool = Omit<ToolDefinition, 'handler'> & { handler: (args: never) => Promise<unknown> };

/** Infers handler argument types from the zod shape, then erases them for registration. */
export function defineTool<Shape extends ZodShape>(tool: ToolDefinition<Shape>): AnyTool {
  return tool as unknown as AnyTool;
}

export const READ_ONLY: ToolAnnotations = { readOnlyHint: true, destructiveHint: false, openWorldHint: true };
export const WRITE_IDEMPOTENT: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};
export const WRITE: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
};
export const DESTRUCTIVE: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: true,
};

export function success(raw: unknown): CallToolResult {
  // Normalise value objects (toJSON) and Dates (ISO strings) into plain JSON.
  const result: unknown = raw === undefined ? null : JSON.parse(JSON.stringify(raw));
  const structured = result !== null && typeof result === 'object' && !Array.isArray(result);
  return {
    content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    ...(structured ? { structuredContent: result as Record<string, unknown> } : {}),
  };
}

/** Converts any thrown error into an MCP tool error the model can act on. */
export function failure(error: unknown, logger?: Logger): CallToolResult {
  let payload: Record<string, unknown>;
  if (error instanceof DomainError || error instanceof ApplicationError) {
    payload = { error: error.code, message: error.message };
    if (error instanceof UpstreamError) {
      if (error.status !== undefined) payload.status = error.status;
      if (error.upstreamCode) payload.upstreamCode = error.upstreamCode;
    }
  } else {
    logger?.error('tool: unexpected error', { error });
    payload = { error: 'INTERNAL_ERROR', message: error instanceof Error ? error.message : String(error) };
  }
  return { isError: true, content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] };
}

export function registerTools(server: McpServer, tools: ReadonlyArray<AnyTool>, logger?: Logger): void {
  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.input,
        annotations: tool.annotations,
      },
      async (args: unknown) => {
        try {
          return success(await tool.handler(args as never));
        } catch (error) {
          return failure(error, logger);
        }
      },
    );
  }
}
