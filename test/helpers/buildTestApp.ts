import Fastify, { type FastifyInstance, type FastifyError } from 'fastify';
import { openDb, type Db } from '../../src/db/connection';
import { TeamsRepo } from '../../src/db/teamsRepo';
import { WindowsRepo } from '../../src/db/windowsRepo';
import { QuotesRepo } from '../../src/db/quotesRepo';
import { OrdersRepo } from '../../src/db/ordersRepo';
import { QuotingService } from '../../src/services/quotingService';
import { BookingService } from '../../src/services/bookingService';
import { FakeClock } from '../../src/clock';
import { registerGetQuotesRoute } from '../../src/http/routes/getQuotes';
import { registerBookOrderRoute } from '../../src/http/routes/bookOrder';

export interface TestApp {
  app: FastifyInstance;
  db: Db;
  clock: FakeClock;
  teams: TeamsRepo;
  windows: WindowsRepo;
  quotes: QuotesRepo;
  orders: OrdersRepo;
}

export async function buildTestApp(initialDate = new Date('2026-04-14T12:00:00Z')): Promise<TestApp> {
  const db = openDb();
  const teams = new TeamsRepo(db);
  const windows = new WindowsRepo(db);
  const quotes = new QuotesRepo(db);
  const orders = new OrdersRepo(db);
  const clock = new FakeClock(initialDate);
  const quotingService = new QuotingService(teams, windows, quotes, orders, clock);
  const bookingService = new BookingService(db, quotes, orders, clock);

  const app = Fastify({ logger: false });
  app.setErrorHandler((err: FastifyError, _req, reply) => {
    if (err.validation) {
      return reply.code(400).send({ error: 'invalid_payload', details: err.validation });
    }
    // eslint-disable-next-line no-console
    console.error(err);
    return reply.code(500).send({ error: 'internal_error' });
  });
  registerGetQuotesRoute(app, quotingService);
  registerBookOrderRoute(app, bookingService);
  await app.ready();
  return { app, db, clock, teams, windows, quotes, orders };
}
