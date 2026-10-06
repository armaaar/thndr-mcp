import { z } from 'zod';
import type {
  CreateAlert,
  CreateWatchlist,
  DeleteAlert,
  DeleteWatchlist,
  EditWatchlist,
  GetAlert,
  GetAlerts,
  GetNotifications,
  GetWatchlist,
  GetWatchlists,
  MarkNotificationsRead,
  UpdateAlert,
} from '../../application/engagement/use-cases.js';
import { MAX_SYMBOLS_PER_CALL } from '../../application/engagement/use-cases.js';
import { ALERT_DIRECTIONS, ALERT_FREQUENCIES } from '../../domain/engagement/price-alert.js';
import { WATCHLIST_NAME_MAX_LENGTH } from '../../domain/engagement/watchlist.js';
import { market, symbol } from './market-data.js';
import { type AnyTool, DESTRUCTIVE, defineTool, READ_ONLY, WRITE, WRITE_IDEMPOTENT } from './operation.js';

export interface EngagementUseCases {
  getWatchlists: GetWatchlists;
  getWatchlist: GetWatchlist;
  createWatchlist: CreateWatchlist;
  editWatchlist: EditWatchlist;
  deleteWatchlist: DeleteWatchlist;
  getAlerts: GetAlerts;
  getAlert: GetAlert;
  createAlert: CreateAlert;
  updateAlert: UpdateAlert;
  deleteAlert: DeleteAlert;
  getNotifications: GetNotifications;
  markNotificationsRead: MarkNotificationsRead;
}

const symbols = z.array(symbol).max(MAX_SYMBOLS_PER_CALL);
const watchlistName = z.string().min(1).max(WATCHLIST_NAME_MAX_LENGTH);
const id = z.string().min(1);
const price = z.number().positive().describe('Trigger price in the instrument currency');
const direction = z
  .enum(ALERT_DIRECTIONS)
  .optional()
  .describe('UP or DOWN; derived from the current price if omitted');
const frequency = z.enum(ALERT_FREQUENCIES).optional().describe('ONE_TIME (default) or RECURRING');

export function engagementTools(useCases: EngagementUseCases): AnyTool[] {
  return [
    defineTool({
      name: 'get_watchlists',
      title: 'Watchlists',
      description:
        'All custom watchlists of the Thndr account with their instruments (tickers and asset ids).',
      input: { market },
      annotations: READ_ONLY,
      handler: ({ market: m }) => useCases.getWatchlists.execute({ market: m }),
    }),
    defineTool({
      name: 'get_watchlist',
      title: 'Watchlist',
      description: 'One watchlist by id with its instruments.',
      input: { id, market },
      annotations: READ_ONLY,
      handler: (a) => useCases.getWatchlist.execute({ id: a.id, market: a.market }),
    }),
    defineTool({
      name: 'create_watchlist',
      title: 'Create watchlist',
      description: 'Creates a watchlist, optionally pre-filled with instruments (tickers or asset ids).',
      input: { name: watchlistName, symbols: symbols.default([]), market },
      annotations: WRITE,
      handler: (a) =>
        useCases.createWatchlist.execute({ name: a.name, symbols: a.symbols, market: a.market }),
    }),
    defineTool({
      name: 'edit_watchlist',
      title: 'Edit watchlist',
      description:
        'Renames a watchlist and/or adds and removes instruments in one call. Returns the updated list.',
      input: {
        id,
        name: watchlistName.optional(),
        add: symbols.default([]),
        remove: symbols.default([]),
        market,
      },
      annotations: WRITE_IDEMPOTENT,
      handler: (a) =>
        useCases.editWatchlist.execute({
          id: a.id,
          name: a.name,
          add: a.add,
          remove: a.remove,
          market: a.market,
        }),
    }),
    defineTool({
      name: 'delete_watchlist',
      title: 'Delete watchlist',
      description: 'Deletes a watchlist permanently.',
      input: { id },
      annotations: { ...DESTRUCTIVE, idempotentHint: true },
      handler: (a) => useCases.deleteWatchlist.execute({ id: a.id }),
    }),
    defineTool({
      name: 'get_alerts',
      title: 'Price alerts',
      description: 'Price alerts of the account, optionally only for one instrument. Paged.',
      input: {
        market,
        symbol: symbol.optional(),
        page: z.number().int().min(1).default(1),
        page_count: z.number().int().min(1).max(100).default(20),
      },
      annotations: READ_ONLY,
      handler: (a) =>
        useCases.getAlerts.execute({
          market: a.market,
          symbol: a.symbol,
          page: a.page,
          pageCount: a.page_count,
        }),
    }),
    defineTool({
      name: 'get_alert',
      title: 'Price alert',
      description: 'One price alert by id.',
      input: { id, market },
      annotations: READ_ONLY,
      handler: (a) => useCases.getAlert.execute({ id: a.id, market: a.market }),
    }),
    defineTool({
      name: 'create_alert',
      title: 'Create price alert',
      description:
        'Creates a price alert that notifies the user in the Thndr app when the instrument crosses `price`. ' +
        'Direction is inferred from the current price unless given.',
      input: { symbol, price, direction, frequency, market },
      annotations: WRITE,
      handler: (a) => useCases.createAlert.execute(a),
    }),
    defineTool({
      name: 'update_alert',
      title: 'Update price alert',
      description:
        "Changes an alert's price, direction or frequency. Thndr has no in-place edit, so the alert is replaced and " +
        'gets a new id (returned together with previousId).',
      input: { id, price: price.optional(), direction, frequency, market },
      annotations: WRITE,
      handler: (a) => useCases.updateAlert.execute(a),
    }),
    defineTool({
      name: 'delete_alert',
      title: 'Delete price alert',
      description: 'Deletes a price alert.',
      input: { id },
      annotations: { ...DESTRUCTIVE, idempotentHint: true },
      handler: (a) => useCases.deleteAlert.execute({ id: a.id }),
    }),
    defineTool({
      name: 'get_notifications',
      title: 'Notifications',
      description:
        'In-app notifications from Thndr (order fills, rejections, triggered price alerts…), newest first.',
      input: {
        page: z.number().int().min(1).default(1),
        page_count: z.number().int().min(1).max(100).default(20),
        unread_only: z.boolean().default(false),
      },
      annotations: READ_ONLY,
      handler: (a) =>
        useCases.getNotifications.execute({
          page: a.page,
          pageCount: a.page_count,
          unreadOnly: a.unread_only,
        }),
    }),
    defineTool({
      name: 'mark_notifications_read',
      title: 'Mark notifications read',
      description: 'Marks the given notification ids as read, or all of them with all=true.',
      input: { ids: z.array(id).max(200).default([]), all: z.boolean().default(false) },
      annotations: WRITE_IDEMPOTENT,
      handler: (a) => useCases.markNotificationsRead.execute({ ids: a.ids, all: a.all }),
    }),
  ];
}
