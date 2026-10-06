export interface BookLevel {
  readonly price: number;
  readonly quantity: number;
  readonly orders: number | null;
}

export interface OrderBook {
  /** Best (highest) bid first. */
  readonly bids: readonly BookLevel[];
  /** Best (lowest) ask first. */
  readonly asks: readonly BookLevel[];
  readonly totalBidQuantity: number | null;
  readonly totalAskQuantity: number | null;
}

export function spread(book: OrderBook): { absolute: number; percent: number } | null {
  const bid = book.bids[0]?.price;
  const ask = book.asks[0]?.price;
  if (bid === undefined || ask === undefined || bid <= 0) return null;
  const absolute = ask - bid;
  const mid = (ask + bid) / 2;
  return { absolute: Math.round(absolute * 1e4) / 1e4, percent: Math.round((absolute / mid) * 1e6) / 1e4 };
}

export type TradeSide = 'BUY' | 'SELL' | 'UNKNOWN';

/** One print on the tape (time & sales). */
export interface TapeTrade {
  readonly price: number;
  readonly quantity: number;
  readonly side: TradeSide;
  readonly time: Date | null;
  readonly cursor: string;
}

export interface MarketSession {
  readonly market: string;
  readonly isOpen: boolean;
  readonly opensAt: Date | null;
  readonly closesAt: Date | null;
}
