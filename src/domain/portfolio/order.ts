import type { AssetId } from '../market-data/asset-id.js';
import { ValidationError } from '../shared/errors.js';
import { assertFiniteNumber, roundTo } from '../shared/guards.js';
import type { Ticker } from '../shared/ticker.js';

/**
 * Read-only view of a broker order (order history / status). This model deliberately has no behaviour to place,
 * modify or cancel orders (ADR 0006).
 */

export const ORDER_SIDES = ['BUY', 'SELL'] as const;
export type OrderSide = (typeof ORDER_SIDES)[number];

/** ThndrX encodes the variant as the boolean `is_limit`. */
export type OrderType = 'LIMIT' | 'MARKET';

/** Statuses (coarse `order_status` or fine `order_status_details`) ThndrX treats as working orders. */
export const OPEN_ORDER_STATUSES: ReadonlySet<string> = new Set([
  'PENDING',
  'PARTIALLY_FILLED',
  'PENDING_CANCELLATION',
  'PENDING_MCDR',
  'PENDING_QUEUED_CANCEL',
  'PENDING_QUEUED_SUBMIT',
  'PENDING_REPLACE',
  'PENDING_SUBMIT',
  'QUEUED_CANCEL',
  'QUEUED_SUBMIT',
  'PROCESSING',
]);

export function isOpenOrderStatus(status: string | null | undefined): boolean {
  return typeof status === 'string' && OPEN_ORDER_STATUSES.has(status.toUpperCase());
}

/** History filters offered by ThndrX (`ALL` sends no status). */
export const ORDER_STATUS_FILTERS = ['all', 'open', 'completed', 'cancelled', 'closed'] as const;
export type OrderStatusFilter = (typeof ORDER_STATUS_FILTERS)[number];

export function parseOrderStatusFilter(raw: string | undefined | null): OrderStatusFilter {
  if (raw === undefined || raw === null || raw === '') return 'all';
  const value = raw.trim().toLowerCase();
  const aliases: Record<string, OrderStatusFilter> = {
    all: 'all',
    open: 'open',
    pending: 'open',
    working: 'open',
    completed: 'completed',
    filled: 'completed',
    executed: 'completed',
    cancelled: 'cancelled',
    canceled: 'cancelled',
    closed: 'closed',
    past: 'closed',
  };
  const filter = aliases[value];
  if (!filter) {
    throw new ValidationError(
      `Unsupported order status "${raw}". Use one of: ${ORDER_STATUS_FILTERS.join(', ')}`,
    );
  }
  return filter;
}

export type BracketLegKind = 'TAKE_PROFIT' | 'STOP_LOSS';

/** A take-profit / stop-loss leg attached to a bracket order (informational). */
export interface BracketLeg {
  readonly kind: BracketLegKind;
  readonly id: string | null;
  readonly quantity: number | null;
  readonly triggerPrice: number | null;
  readonly limitPrice: number | null;
  readonly type: OrderType | null;
  /** `Active`, `Inactive`, `Triggered`, `PendingTrigger`, `Cancelled`, `Failed`… */
  readonly status: string | null;
}

export interface OrderInput {
  readonly id: string;
  readonly instrumentId: AssetId | null;
  readonly ticker: Ticker;
  readonly side: OrderSide;
  readonly type: OrderType;
  /** Ordered quantity (wire `amount`). */
  readonly quantity: number;
  /** Wire `amount_filled`. */
  readonly filledQuantity: number | null;
  /** Wire `price`: the limit price, or the average fill price when a limit order is partially filled. */
  readonly price: number | null;
  /** Wire `limit_price` (present on partially filled orders). */
  readonly limitPrice: number | null;
  /** Coarse status (`PENDING`, `COMPLETED`, `CLOSED`, …). */
  readonly status: string;
  /** Fine status (`FULFILLED`, `PARTIALLY_FILLED`, `REJECTED`, …). */
  readonly statusDetail: string | null;
  readonly timeInForce: string | null;
  readonly expiresAt: Date | null;
  readonly executionType: string | null;
  readonly settlement: string | null;
  readonly orderClass: string | null;
  readonly brackets: readonly BracketLeg[];
  readonly createdAt: Date | null;
  readonly updatedAt: Date | null;
}

export interface Order {
  readonly id: string;
  readonly instrumentId: AssetId | null;
  readonly ticker: Ticker;
  readonly side: OrderSide;
  readonly type: OrderType;
  readonly quantity: number;
  readonly filledQuantity: number | null;
  /** Quantity still working on the exchange (0 once the order is no longer open). */
  readonly remainingQuantity: number;
  /** The order's price as ThndrX displays it (the limit price for partially filled limit orders). */
  readonly price: number | null;
  /** Average execution price, when the broker exposes it (partially filled limit orders). */
  readonly averageFillPrice: number | null;
  readonly status: string;
  readonly statusDetail: string | null;
  readonly isOpen: boolean;
  readonly timeInForce: string | null;
  readonly expiresAt: Date | null;
  readonly executionType: string | null;
  readonly settlement: string | null;
  readonly orderClass: string | null;
  readonly brackets: readonly BracketLeg[];
  readonly createdAt: Date | null;
  readonly updatedAt: Date | null;
}

export function createOrder(input: OrderInput): Order {
  if (!input.id) throw new ValidationError('Order id must not be empty');
  if (!(ORDER_SIDES as readonly string[]).includes(input.side)) {
    throw new ValidationError(`Invalid order side: ${String(input.side)}`);
  }
  assertFiniteNumber(input.quantity, 'Order quantity');
  if (input.quantity < 0) throw new ValidationError('Order quantity must not be negative');

  const status = input.status.toUpperCase();
  const statusDetail = input.statusDetail?.toUpperCase() ?? null;
  const isOpen = isOpenOrderStatus(status) || isOpenOrderStatus(statusDetail);
  const partiallyFilled = statusDetail === 'PARTIALLY_FILLED';
  const filledQuantity = input.filledQuantity ?? (statusDetail === 'FULFILLED' ? input.quantity : null);

  // ThndrX module 65270: Q0 (displayed price) and ID (average price) helpers.
  const price = partiallyFilled && input.limitPrice !== null ? input.limitPrice : input.price;
  const averageFillPrice =
    partiallyFilled &&
    input.limitPrice !== null &&
    input.price !== null &&
    roundTo(input.limitPrice, 3) !== roundTo(input.price, 3)
      ? input.price
      : null;

  return Object.freeze({
    ...input,
    status,
    statusDetail,
    isOpen,
    filledQuantity,
    remainingQuantity: isOpen ? Math.max(input.quantity - (filledQuantity ?? 0), 0) : 0,
    price,
    averageFillPrice,
    brackets: Object.freeze([...input.brackets]),
    expiresAt: input.expiresAt ? new Date(input.expiresAt.getTime()) : null,
    createdAt: input.createdAt ? new Date(input.createdAt.getTime()) : null,
    updatedAt: input.updatedAt ? new Date(input.updatedAt.getTime()) : null,
  });
}

export interface OrdersPage {
  readonly orders: readonly Order[];
  /** Opaque cursor of the next page, or null on the last page. */
  readonly nextCursor: string | null;
}
