import { z } from 'zod';
import { pageInput } from '../../inputs';
import { clamp } from '../../paging';
import { type InputOf, Query } from '../../use-case';
import type { EngagementDependencies } from '../dependencies';
import { pageCountInput } from '../inputs';
import { type NotificationView, toNotificationView } from '../views';

const input = {
  page: pageInput,
  pageCount: pageCountInput,
  unreadOnly: z.boolean().default(false),
};

type Output = {
  page: number;
  pageCount: number;
  hasMore: boolean;
  hasUnread: boolean;
  notifications: NotificationView[];
};

/** One page of in-app notifications plus the global "has unread" flag. */
export class GetNotifications extends Query<typeof input, Output> {
  readonly name = 'get_notifications';
  readonly title = 'Notifications';
  readonly description =
    'In-app notifications from Thndr (order fills, rejections, triggered price alerts…), newest first.';
  readonly context = 'engagement';
  readonly input = input;

  constructor(private readonly deps: Pick<EngagementDependencies, 'repository'>) {
    super();
  }

  async execute(params: InputOf<typeof input>): Promise<Output> {
    const page = clamp(params.page, 1, 1, 10_000);
    const pageCount = clamp(params.pageCount, 20, 1, 100);
    const [notifications, hasUnread] = await Promise.all([
      this.deps.repository.listNotifications(page, pageCount),
      this.deps.repository.hasUnreadNotifications(),
    ]);
    return {
      page,
      pageCount,
      hasMore: notifications.length === pageCount,
      hasUnread,
      notifications: notifications.filter((n) => !params.unreadOnly || !n.read).map(toNotificationView),
    };
  }
}
