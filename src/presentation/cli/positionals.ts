/**
 * CLI ergonomics only: input fields a command also accepts as positional arguments, in order
 * (`thndr get-price-snapshot COMI HRHO` instead of `--symbols COMI --symbols HRHO`). An array field absorbs the rest.
 * Keyed by use-case name; the use cases themselves stay unaware of the CLI.
 */
export const CLI_POSITIONALS: Readonly<Record<string, readonly string[]>> = {
  login_start: ['email'],
  login_verify_code: ['code'],
  login_import_session: ['cookieHeader'],
  search_instruments: ['query'],
  get_instrument_details: ['symbol'],
  get_price_snapshot: ['symbols'],
  get_price_history: ['symbol'],
  get_market_depth: ['symbol'],
  get_recent_trades: ['symbol'],
  get_index_constituents: ['index'],
  get_peers: ['symbol'],
  get_position: ['symbol'],
  get_watchlist: ['id'],
  create_watchlist: ['name', 'symbols'],
  edit_watchlist: ['id'],
  delete_watchlist: ['id'],
  get_alert: ['id'],
  create_alert: ['symbol', 'price'],
  update_alert: ['id'],
  delete_alert: ['id'],
  mark_notifications_read: ['ids'],
};

/** `get_price_history` → `get-price-history`. */
export function commandName(useCase: { name: string }): string {
  return useCase.name.replaceAll('_', '-');
}

/** `timeoutSeconds` → `timeout-seconds`. */
export function flagName(field: string): string {
  return field.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`).replaceAll('_', '-');
}
