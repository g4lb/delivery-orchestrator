import Fastify, { type FastifyInstance } from 'fastify';
import type { Db } from './db/connection';
import type { Clock } from './clock';
import { TeamsRepo } from './db/teamsRepo';
import { WindowsRepo } from './db/windowsRepo';
import { QuotesRepo } from './db/quotesRepo';
import { OrdersRepo } from './db/ordersRepo';
import { QuotingService } from './services/quotingService';
import { BookingService } from './services/bookingService';
import { registerGetQuotesRoute } from './http/routes/getQuotes';
import { registerBookOrderRoute } from './http/routes/bookOrder';
import { registerErrorHandler } from './http/errorHandler';

export interface Repos {
  teams: TeamsRepo;
  windows: WindowsRepo;
  quotes: QuotesRepo;
  orders: OrdersRepo;
}

export interface Services {
  quoting: QuotingService;
  booking: BookingService;
}

export function buildRepos(db: Db): Repos {
  return {
    teams: new TeamsRepo(db),
    windows: new WindowsRepo(db),
    quotes: new QuotesRepo(db),
    orders: new OrdersRepo(db),
  };
}

export function buildServices(db: Db, repos: Repos, clock: Clock): Services {
  return {
    quoting: new QuotingService(repos.teams, repos.windows, repos.quotes, repos.orders, clock),
    booking: new BookingService(db, repos.quotes, repos.orders, clock),
  };
}

export function buildFastifyApp(services: Services, options: { logger: boolean }): FastifyInstance {
  const app = Fastify({ logger: options.logger });
  registerErrorHandler(app);
  registerGetQuotesRoute(app, services.quoting);
  registerBookOrderRoute(app, services.booking);
  return app;
}
