import type { ListedInstrument, Mover, Tag } from '../../domain/market-data/discovery';
import type { AssetClass } from '../../domain/shared-kernel/market';
import type { Currency } from '../../domain/shared-kernel/money';

/** An instrument of a Thndr list (movers, a tag) with the price figures Thndr attached to it. */
export interface ListedInstrumentView {
  ticker: string;
  name: string;
  assetClass: AssetClass;
  sector: string | null;
  currency: Currency | null;
  price: number | null;
  /** Today's change, in percent. */
  changePercent: number | null;
  tradable: boolean | null;
  instrumentId: string;
}

export interface MoverView extends ListedInstrumentView {
  /** Return over the requested period, in percent. */
  returnPercent: number | null;
}

export interface TagView {
  id: string;
  name: string;
  slug: string | null;
  about: string | null;
  instrumentCount: number | null;
  featured: boolean;
}

export function toListedInstrumentView(listed: ListedInstrument): ListedInstrumentView {
  const { instrument } = listed;
  return {
    ticker: instrument.ticker.value,
    name: instrument.name,
    assetClass: instrument.assetClass,
    sector: instrument.sector,
    currency: instrument.currency,
    price: listed.price,
    changePercent: listed.changePercent,
    tradable: instrument.tradable,
    instrumentId: instrument.id.value,
  };
}

export function toMoverView(mover: Mover): MoverView {
  return { ...toListedInstrumentView(mover), returnPercent: mover.returnPercent };
}

export function toTagView(tag: Tag): TagView {
  return {
    id: tag.id,
    name: tag.name,
    slug: tag.slug,
    about: tag.about,
    instrumentCount: tag.instrumentCount,
    featured: tag.featured,
  };
}
