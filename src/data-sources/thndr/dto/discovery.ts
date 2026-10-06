/**
 * Wire formats of the discovery endpoints the Thndr mobile app uses (docs/api/mobile-app.md §1.3, §2.7, §2.8, §4.B;
 * shapes live-verified 2026-10-06). Every field is optional and loosely typed on purpose.
 */
import type { AssetDto, WireNumber } from './market-data';

/** `GET /compliance-service/eligibilities/v2/visible-markets`. */
export interface VisibleMarketsDto {
  markets?: Array<{
    /** `egypt`, `us`, `abudhabi`, `simulator` (and possibly codes thndr-mcp does not serve, e.g. `tdwl`). */
    name?: string | null;
    is_restricted?: boolean | null;
    restriction_reason?: string | null;
  } | null> | null;
  default_market?: string | null;
}

/** An asset payload with the full feed (`include_feed=true&feed_detail=true`). */
export interface ListedAssetDto extends AssetDto {
  /** Present on ranked assets (`asset_id` = `id`). */
  asset_id?: string | null;
}

/** `GET /assets-service/assets/rank?type=GAINERS|LOSERS&duration=…`. */
export interface RankedAssetsDto {
  assets_ranked?: Array<(ListedAssetDto & { asset_return_percentage?: WireNumber }) | null> | null;
  last_updated_at?: string | null;
}

/** `GET krakend-thndr-app /explore/v1/assets/trending` → asset ids. */
export interface TrendingAssetsDto {
  results?: Array<string | null> | null;
}

/** One entry of the default market indicators. */
export interface MarketIndicatorRefDto {
  asset_id?: string | null;
}

/**
 * `GET krakend-thndr-app /explore/v1/default-market-indicators?market=…`: an object live (2026-10-06); the app's
 * code also reads it as a list of `{indicators}` groups.
 */
export interface DefaultMarketIndicatorsDto {
  default_market_indicators?:
    | { indicators?: Array<MarketIndicatorRefDto | null> | null }
    | Array<{ indicators?: Array<MarketIndicatorRefDto | null> | null } | null>
    | null;
}

/** One tag (theme) of `GET /assets-service/tags` or `GET /assets-service/tags/{id}`. */
export interface TagDto {
  id?: number | string | null;
  market?: string | null;
  slug?: string | null;
  name?: string | null;
  about?: string | null;
  assets_count?: WireNumber;
  is_featured?: boolean | null;
  hidden?: boolean | null;
  /** Only filled by the tag details endpoint: one page of the tag's instruments. */
  assets?: Array<ListedAssetDto | null> | null;
}

export interface TagsResponseDto {
  count?: WireNumber;
  results?: Array<TagDto | null> | null;
}

/** One entry of `GET /assets-service/assets/{id}/dividends`. */
export interface DividendDto {
  id?: number | string | null;
  asset_id?: string | null;
  /** `CASH` or `STOCK`. */
  dividend_type?: string | null;
  /** `UPCOMING`, `ONGOING` or `PAST`. */
  status?: string | null;
  record_date?: string | null;
  ratio?: WireNumber;
  currency?: string | null;
  frequency?: string | null;
  coupon_number?: string | number | null;
  distributions?: Array<{ date?: string | null; ratio?: WireNumber; amount?: WireNumber } | null> | null;
}

export interface DividendsResponseDto {
  results?: Array<DividendDto | null> | null;
  page?: WireNumber;
  page_count?: WireNumber;
  total_count?: WireNumber;
}
