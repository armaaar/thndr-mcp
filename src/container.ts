import type { Persistence } from '@firebase/auth';
import { CreateAlert } from './application/engagement/commands/create-alert';
import { CreateWatchlist } from './application/engagement/commands/create-watchlist';
import { DeleteAlert } from './application/engagement/commands/delete-alert';
import { DeleteWatchlist } from './application/engagement/commands/delete-watchlist';
import { EditWatchlist } from './application/engagement/commands/edit-watchlist';
import { MarkNotificationsRead } from './application/engagement/commands/mark-notifications-read';
import { UpdateAlert } from './application/engagement/commands/update-alert';
import type { EngagementDependencies } from './application/engagement/dependencies';
import { GetAlert } from './application/engagement/queries/get-alert';
import { GetAlerts } from './application/engagement/queries/get-alerts';
import { GetNotifications } from './application/engagement/queries/get-notifications';
import { GetWatchlist } from './application/engagement/queries/get-watchlist';
import { GetWatchlists } from './application/engagement/queries/get-watchlists';
import { CompleteLogin } from './application/identity/commands/complete-login';
import { ImportSession } from './application/identity/commands/import-session';
import { Logout } from './application/identity/commands/logout';
import { RequestDeviceApproval } from './application/identity/commands/request-device-approval';
import { StartLogin } from './application/identity/commands/start-login';
import { VerifyLoginCode } from './application/identity/commands/verify-login-code';
import type { LoginDependencies } from './application/identity/dependencies';
import { GetAuthStatus } from './application/identity/queries/get-auth-status';
import { SessionTokenProvider } from './application/identity/services/session-token-provider';
import type { MarketDataDependencies } from './application/market-data/dependencies';
import { GetEconomicIndicators } from './application/market-data/queries/get-economic-indicators';
import { GetFinancials } from './application/market-data/queries/get-financials';
import { GetIndexConstituents } from './application/market-data/queries/get-index-constituents';
import { GetInstrumentDetails } from './application/market-data/queries/get-instrument-details';
import { GetMarketDepth } from './application/market-data/queries/get-market-depth';
import { GetMarketStatus } from './application/market-data/queries/get-market-status';
import { GetNews } from './application/market-data/queries/get-news';
import { GetPeers } from './application/market-data/queries/get-peers';
import { GetPriceHistory } from './application/market-data/queries/get-price-history';
import { GetPricePerformance } from './application/market-data/queries/get-price-performance';
import { GetPriceSnapshot } from './application/market-data/queries/get-price-snapshot';
import { GetRecentTrades } from './application/market-data/queries/get-recent-trades';
import { GetScreeners } from './application/market-data/queries/get-screeners';
import { ScreenMarket } from './application/market-data/queries/screen-market';
import { SearchInstruments } from './application/market-data/queries/search-instruments';
import { IndexMembership } from './application/market-data/services/index-membership';
import { InstrumentResolver } from './application/market-data/services/instrument-resolver';
import { MarketQuotesCache } from './application/market-data/services/market-quotes-cache';
import type { PortfolioDependencies } from './application/portfolio/dependencies';
import { GetAccountSummary } from './application/portfolio/queries/get-account-summary';
import { GetClosedTrades } from './application/portfolio/queries/get-closed-trades';
import { GetPortfolioAllocation } from './application/portfolio/queries/get-portfolio-allocation';
import { GetPortfolioPerformance } from './application/portfolio/queries/get-portfolio-performance';
import { GetPosition } from './application/portfolio/queries/get-position';
import { GetPositions } from './application/portfolio/queries/get-positions';
import { GetRealizedReturns } from './application/portfolio/queries/get-realized-returns';
import { GetSavings } from './application/portfolio/queries/get-savings';
import { GetSellJournal } from './application/portfolio/queries/get-sell-journal';
import { GetTradingMetrics } from './application/portfolio/queries/get-trading-metrics';
import { ListAccountActivity } from './application/portfolio/queries/list-account-activity';
import { ListOrders } from './application/portfolio/queries/list-orders';
import { type Clock, systemClock } from './application/ports/clock';
import type { IdentityProvider } from './application/ports/identity';
import type { Logger } from './application/ports/logger';
import type { UseCase } from './application/use-case';
import type { AppConfig } from './config';
import { createFilePersistence } from './data-sources/firebase/file-persistence';
import { FirebaseIdentityProvider } from './data-sources/firebase/firebase-identity-provider';
import { SessionFile } from './data-sources/local/session-file';
import { StderrLogger } from './data-sources/logging/stderr-logger';
import { type FetchFn, ThndrHttpClient } from './data-sources/thndr/http-client';
import { FileLoginFlowRepository } from './repositories/local/login-flow-repository';
import { FileSessionRepository } from './repositories/local/session-repository';
import { HttpThndrAuthGateway } from './repositories/thndr/auth-gateway';
import { ThndrEngagementRepository } from './repositories/thndr/engagement-repository';
import { ThndrMarketDataRepository } from './repositories/thndr/market-data-repository';
import { ThndrPortfolioRepository } from './repositories/thndr/portfolio-repository';
import { ThndrResearchRepository } from './repositories/thndr/research-repository';

export interface CompositionOverrides {
  fetch?: FetchFn;
  clock?: Clock;
  logger?: Logger;
  identity?: (persistence: Persistence) => IdentityProvider;
}

/**
 * Composition root (ADR 0015): builds data sources, repositories and application services, and returns the list of
 * use cases that both delivery mechanisms (MCP server and CLI) expose.
 */
export function compose(config: AppConfig, overrides: CompositionOverrides = {}) {
  const clock = overrides.clock ?? systemClock;
  const logger = overrides.logger ?? new StderrLogger(config.logLevel);

  // Data sources
  const sessionFile = new SessionFile(config.sessionFile);
  const persistence = createFilePersistence(sessionFile);
  const identity = overrides.identity
    ? overrides.identity(persistence)
    : new FirebaseIdentityProvider(persistence);
  const http = (baseUrl: string, tokenProvider?: SessionTokenProvider) =>
    new ThndrHttpClient({
      baseUrl,
      fetch: overrides.fetch,
      tokenProvider,
      runtimeVersion: config.runtimeVersion,
      language: config.language,
      userAgent: config.userAgent,
      logger,
    });

  // Identity & Access
  const sessions = new FileSessionRepository(sessionFile);
  const authGateway = new HttpThndrAuthGateway(http(config.apiBaseUrl), http(config.webBaseUrl), clock);
  const tokens = new SessionTokenProvider(sessions, authGateway, clock, logger);
  const api = http(config.apiBaseUrl, tokens);
  const krakend = http(`${config.apiBaseUrl.replace(/\/+$/, '')}/krakend-thndr-x`, tokens);
  /** ThndrX's own routes on x.thndr.app/api (financials, macros), with the full-access token. */
  const web = http(config.webBaseUrl, tokens);
  const login: LoginDependencies = {
    gateway: authGateway,
    identity,
    sessions,
    flow: new FileLoginFlowRepository(sessionFile),
    clock,
    deviceName: config.deviceName,
  };

  // Market Data
  const marketRepository = new ThndrMarketDataRepository(api, krakend);
  const resolver = new InstrumentResolver(marketRepository);
  const quotes = new MarketQuotesCache(marketRepository, clock);
  const indices = new IndexMembership(marketRepository, quotes, clock);
  const market: MarketDataDependencies = {
    repository: marketRepository,
    research: new ThndrResearchRepository(api, web),
    resolver,
    quotes,
    indices,
    clock,
  };

  // Portfolio
  const portfolio: PortfolioDependencies = {
    repository: new ThndrPortfolioRepository(api, krakend),
    resolver,
    quotes,
    indices,
    clock,
  };

  // Engagement
  const engagement: EngagementDependencies = {
    repository: new ThndrEngagementRepository(api, krakend),
    resolver,
    quotes,
  };

  /** Every use case of the application, in the order they are listed to users. */
  const useCases: UseCase[] = [
    new GetAuthStatus(login),
    new StartLogin(login),
    new VerifyLoginCode(login),
    new RequestDeviceApproval(login),
    new CompleteLogin(login),
    new ImportSession(login),
    new Logout(login),
    new SearchInstruments(market),
    new GetInstrumentDetails(market),
    new GetPriceSnapshot(market),
    new GetPriceHistory(market),
    new GetMarketDepth(market),
    new GetRecentTrades(market),
    new GetMarketStatus(market),
    new ScreenMarket(market),
    new GetScreeners(market),
    new GetIndexConstituents(market),
    new GetPeers(market),
    new GetPricePerformance(market),
    new GetFinancials(market),
    new GetNews(market),
    new GetEconomicIndicators(market),
    new GetAccountSummary(portfolio),
    new GetPositions(portfolio),
    new GetPosition(portfolio),
    new ListOrders(portfolio),
    new GetRealizedReturns(portfolio),
    new GetClosedTrades(portfolio),
    new GetSellJournal(portfolio),
    new GetTradingMetrics(portfolio),
    new ListAccountActivity(portfolio),
    new GetPortfolioAllocation(portfolio),
    new GetPortfolioPerformance(portfolio),
    new GetSavings(portfolio),
    new GetWatchlists(engagement),
    new GetWatchlist(engagement),
    new CreateWatchlist(engagement),
    new EditWatchlist(engagement),
    new DeleteWatchlist(engagement),
    new GetAlerts(engagement),
    new GetAlert(engagement),
    new CreateAlert(engagement),
    new UpdateAlert(engagement),
    new DeleteAlert(engagement),
    new GetNotifications(engagement),
    new MarkNotificationsRead(engagement),
  ];

  return { useCases, logger, api, krakend };
}
