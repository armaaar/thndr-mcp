import { ApplicationError, UpstreamError } from '../../application/errors';
import type { Logger } from '../../application/ports/logger';
import { DomainError } from '../../domain/shared-kernel/errors';

export interface ErrorView {
  error: string;
  message: string;
  status?: number;
  upstreamCode?: string;
}

/** Presents any thrown error as an actionable error view (same codes in MCP and CLI). */
export function presentError(error: unknown, logger?: Logger): ErrorView {
  if (error instanceof DomainError || error instanceof ApplicationError) {
    const view: ErrorView = { error: error.code, message: error.message };
    if (error instanceof UpstreamError) {
      if (error.status !== undefined) view.status = error.status;
      if (error.upstreamCode) view.upstreamCode = error.upstreamCode;
    }
    return view;
  }
  logger?.error('operation: unexpected error', { error });
  return { error: 'INTERNAL_ERROR', message: error instanceof Error ? error.message : String(error) };
}
