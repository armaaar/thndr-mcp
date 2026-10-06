import { z } from 'zod';
import { MARKETS } from '../domain/shared-kernel/market';

/** Reusable input fields of use-case contracts. */
export const marketInput = z
  .enum(MARKETS)
  .default('egypt')
  .describe(
    'Market: "egypt" (EGX, default), "us" (NYSE/Nasdaq via Alpaca), "uae" (ADX) or "simulator" (paper trading)',
  );
export const symbolInput = z.string().min(1).describe('Ticker symbol (e.g. "COMI") or Thndr asset id (UUID)');
export const dateInput = z
  .string()
  .refine((v) => !Number.isNaN(Date.parse(v)), 'Must be an ISO-8601 date or datetime')
  .describe('ISO-8601 date (Cairo market day, e.g. 2026-01-31) or datetime (2026-01-31T10:00:00+02:00)');
export const pageInput = z.number().int().min(1).default(1);
