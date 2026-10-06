import type { Persistence } from '@firebase/auth';
import {
  CreateAlert,
  CreateWatchlist,
  DeleteAlert,
  DeleteWatchlist,
  EditWatchlist,
  type EngagementDependencies,
  GetAlert,
  GetAlerts,
  GetNotifications,
  GetWatchlist,
  GetWatchlists,
  MarkNotificationsRead,
  UpdateAlert,
} from './application/engagement/use-cases.js';
import {
  CompleteLogin,
  GetAuthStatus,
  ImportSession,
  type LoginDependencies,
  Logout,
  RequestDeviceApproval,
  StartLogin,
  VerifyLoginCode,
} from './application/identity/login.js';
import { LoginFlowHolder } from './application/identity/login-flow-holder.js';
import { SessionTokenProvider } from './application/identity/session-token-provider.js';
import { InstrumentResolver } from './application/market-data/instrument-resolver.js';
import { MarketQuotesCache } from './application/market-data/quote-cache.js';
import {
  GetInstrumentDetails,
  GetMarketDepth,
  GetMarketStatus,
  GetPriceHistory,
  GetPriceSnapshot,
  GetRecentTrades,
  type MarketDataDependencies,
  ScreenMarket,
  SearchInstruments,
} from './application/market-data/use-cases.js';
import {
  GetAccountSummary,
  GetClosedTrades,
  GetPosition,
  GetPositions,
  GetRealizedReturns,
  GetSellJournal,
  GetTradingMetrics,
  ListAccountActivity,
  ListOrders,
  type PortfolioDependencies,
} from './application/portfolio/use-cases.js';
import { type Clock, systemClock } from './application/ports/clock.js';
import type { IdentityProvider } from './application/ports/identity.js';
import type { Logger } from './application/ports/logger.js';
import type { AppConfig } from './config.js';
import { createFilePersistence } from './infrastructure/data-sources/firebase/file-persistence.js';
import { FirebaseIdentityProvider } from './infrastructure/data-sources/firebase/firebase-identity-provider.js';
import { SessionFile } from './infrastructure/data-sources/local/session-file.js';
import { type FetchFn, ThndrHttpClient } from './infrastructure/data-sources/thndr/http-client.js';
import { StderrLogger } from './infrastructure/logging/stderr-logger.js';
import { FileSessionRepository } from './infrastructure/repositories/local/session-repository.js';
import { HttpThndrAuthGateway } from './infrastructure/repositories/thndr/auth-gateway.js';
import { ThndrEngagementRepository } from './infrastructure/repositories/thndr/engagement-repository.js';
import { ThndrMarketDataRepository } from './infrastructure/repositories/thndr/market-data-repository.js';
import { ThndrPortfolioRepository } from './infrastructure/repositories/thndr/portfolio-repository.js';
import { engagementTools } from './interfaces/catalog/engagement.js';
import { identityTools } from './interfaces/catalog/identity.js';
import { marketDataTools } from './interfaces/catalog/market-data.js';
import type { AnyTool } from './interfaces/catalog/operation.js';
import { portfolioTools } from './interfaces/catalog/portfolio.js';

export interface CompositionOverrides {
  fetch?: FetchFn;
  clock?: Clock;
  logger?: Logger;
  identity?: (persistence: Persistence) => IdentityProvider;
}

/** Composition root: wires adapters to use cases to MCP tools (manual DI, ADR 0003). */
export function compose(config: AppConfig, overrides: CompositionOverrides = {}) {
  const clock = overrides.clock ?? systemClock;
  const logger = overrides.logger ?? new StderrLogger(config.logLevel);
  const sessionFile = new SessionFile(config.sessionFile);
  const sessions = new FileSessionRepository(sessionFile);
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

  const authGateway = new HttpThndrAuthGateway(http(config.apiBaseUrl), http(config.webBaseUrl), clock);
  const tokens = new SessionTokenProvider(sessions, authGateway, clock, logger);
  const api = http(config.apiBaseUrl, tokens);
  const krakend = http(`${config.apiBaseUrl.replace(/\/+$/, '')}/krakend-thndr-x`, tokens);

  const loginDeps: LoginDependencies = {
    gateway: authGateway,
    identity,
    sessions,
    flow: new LoginFlowHolder(),
    clock,
    userAgent: config.userAgent,
  };
  const identityUseCases = {
    getAuthStatus: new GetAuthStatus(loginDeps),
    startLogin: new StartLogin(loginDeps),
    verifyLoginCode: new VerifyLoginCode(loginDeps),
    requestDeviceApproval: new RequestDeviceApproval(loginDeps),
    completeLogin: new CompleteLogin(loginDeps),
    importSession: new ImportSession(loginDeps),
    logout: new Logout(loginDeps),
  };

  const marketRepository = new ThndrMarketDataRepository(api, krakend);
  const resolver = new InstrumentResolver(marketRepository);
  const quotes = new MarketQuotesCache(marketRepository, clock);
  const marketDeps: MarketDataDependencies = { repository: marketRepository, resolver, quotes, clock };
  const marketUseCases = {
    searchInstruments: new SearchInstruments(marketDeps),
    getInstrumentDetails: new GetInstrumentDetails(marketDeps),
    getPriceSnapshot: new GetPriceSnapshot(marketDeps),
    getPriceHistory: new GetPriceHistory(marketDeps),
    getMarketDepth: new GetMarketDepth(marketDeps),
    getRecentTrades: new GetRecentTrades(marketDeps),
    getMarketStatus: new GetMarketStatus(marketDeps),
    screenMarket: new ScreenMarket(marketDeps),
  };

  const portfolioDeps: PortfolioDependencies = {
    repository: new ThndrPortfolioRepository(api, krakend),
    resolver,
    clock,
  };
  const portfolioUseCases = {
    getAccountSummary: new GetAccountSummary(portfolioDeps),
    getPositions: new GetPositions(portfolioDeps),
    getPosition: new GetPosition(portfolioDeps),
    listOrders: new ListOrders(portfolioDeps),
    getRealizedReturns: new GetRealizedReturns(portfolioDeps),
    getClosedTrades: new GetClosedTrades(portfolioDeps),
    getSellJournal: new GetSellJournal(portfolioDeps),
    getTradingMetrics: new GetTradingMetrics(portfolioDeps),
    listAccountActivity: new ListAccountActivity(portfolioDeps),
  };

  const engagementDeps: EngagementDependencies = {
    repository: new ThndrEngagementRepository(api, krakend),
    resolver,
    quotes,
  };
  const engagementUseCases = {
    getWatchlists: new GetWatchlists(engagementDeps),
    getWatchlist: new GetWatchlist(engagementDeps),
    createWatchlist: new CreateWatchlist(engagementDeps),
    editWatchlist: new EditWatchlist(engagementDeps),
    deleteWatchlist: new DeleteWatchlist(engagementDeps),
    getAlerts: new GetAlerts(engagementDeps),
    getAlert: new GetAlert(engagementDeps),
    createAlert: new CreateAlert(engagementDeps),
    updateAlert: new UpdateAlert(engagementDeps),
    deleteAlert: new DeleteAlert(engagementDeps),
    getNotifications: new GetNotifications(engagementDeps),
    markNotificationsRead: new MarkNotificationsRead(engagementDeps),
  };

  const tools: AnyTool[] = [
    ...identityTools(identityUseCases),
    ...marketDataTools(marketUseCases),
    ...portfolioTools(portfolioUseCases),
    ...engagementTools(engagementUseCases),
  ];
  return {
    tools,
    logger,
    identityUseCases,
    marketUseCases,
    portfolioUseCases,
    engagementUseCases,
    api,
    krakend,
  };
}
