import type { Persistence } from '@firebase/auth';
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
import { createFilePersistence } from './infrastructure/firebase/file-persistence.js';
import { FirebaseIdentityProvider } from './infrastructure/firebase/firebase-identity-provider.js';
import { StderrLogger } from './infrastructure/logging/stderr-logger.js';
import { FileSessionRepository } from './infrastructure/persistence/file-session-repository.js';
import { SessionFile } from './infrastructure/persistence/session-file.js';
import { HttpThndrAuthGateway } from './infrastructure/thndr/auth-gateway.js';
import { type FetchFn, ThndrHttpClient } from './infrastructure/thndr/http-client.js';
import { HttpMarketDataGateway } from './infrastructure/thndr/market-data-gateway.js';
import { HttpPortfolioGateway } from './infrastructure/thndr/portfolio-gateway.js';
import { identityTools } from './interface/mcp/identity-tools.js';
import { marketDataTools } from './interface/mcp/market-data-tools.js';
import { portfolioTools } from './interface/mcp/portfolio-tools.js';
import type { AnyTool } from './interface/mcp/tool.js';

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

  const marketGateway = new HttpMarketDataGateway(api, krakend);
  const resolver = new InstrumentResolver(marketGateway);
  const quotes = new MarketQuotesCache(marketGateway, clock);
  const marketDeps: MarketDataDependencies = { gateway: marketGateway, resolver, quotes, clock };
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
    gateway: new HttpPortfolioGateway(api, krakend),
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

  const tools: AnyTool[] = [
    ...identityTools(identityUseCases),
    ...marketDataTools(marketUseCases),
    ...portfolioTools(portfolioUseCases),
  ];
  return { tools, logger, identityUseCases, marketUseCases, portfolioUseCases, api, krakend };
}
