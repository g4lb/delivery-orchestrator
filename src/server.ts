import Fastify, { type FastifyError } from 'fastify';
import { openDb } from './db/connection';
import { TeamsRepo } from './db/teamsRepo';
import { WindowsRepo } from './db/windowsRepo';
import { QuotesRepo } from './db/quotesRepo';
import { OrdersRepo } from './db/ordersRepo';
import { QuotingService } from './services/quotingService';
import { BookingService } from './services/bookingService';
import { SystemClock } from './clock';
import { registerGetQuotesRoute } from './http/routes/getQuotes';
import { registerBookOrderRoute } from './http/routes/bookOrder';
import { seed } from './seed';

async function main() {
  const db = openDb();
  const teams = new TeamsRepo(db);
  const windows = new WindowsRepo(db);
  const quotes = new QuotesRepo(db);
  const orders = new OrdersRepo(db);
  const clock = new SystemClock();

  seed(teams, windows);

  const quotingService = new QuotingService(teams, windows, quotes, orders, clock);
  const bookingService = new BookingService(db, windows, quotes, orders, clock);

  const app = Fastify({ logger: true });
  app.setErrorHandler((err: FastifyError, _req, reply) => {
    if (err.validation) {
      return reply.code(400).send({ error: 'invalid_payload', details: err.validation });
    }
    app.log.error(err);
    return reply.code(500).send({ error: 'internal_error' });
  });
  registerGetQuotesRoute(app, quotingService);
  registerBookOrderRoute(app, bookingService);

  const port = Number(process.env.PORT ?? 3000);
  await app.listen({ port, host: '0.0.0.0' });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
