import { describe, expect, it } from 'vitest';
import { type OrderBook, spread } from '../../../src/domain/market-data/order-book.js';

const book = (bid?: number, ask?: number): OrderBook => ({
  bids: bid === undefined ? [] : [{ price: bid, quantity: 1, orders: null }],
  asks: ask === undefined ? [] : [{ price: ask, quantity: 1, orders: null }],
  totalBidQuantity: null,
  totalAskQuantity: null,
});

describe('spread', () => {
  it('computes absolute and percent spread against the mid price', () => {
    expect(spread(book(99, 101))).toEqual({ absolute: 2, percent: 2 });
    expect(spread(book(10.1, 10.2))).toEqual({ absolute: 0.1, percent: 0.9852 });
  });

  it('is null when a side is empty or the bid is not positive', () => {
    expect(spread(book(undefined, 10))).toBeNull();
    expect(spread(book(10, undefined))).toBeNull();
    expect(spread(book(0, 10))).toBeNull();
  });
});
