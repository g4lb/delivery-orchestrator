import type { FastifyInstance } from 'fastify';
import { openDb, type Db } from '../../src/db/connection';
import { FakeClock } from '../../src/shared/clock';
import { buildRepos, buildServices, buildFastifyApp, type Repos } from '../../src/app/appBuilder';

const DEFAULT_TEST_DATE = new Date('2026-04-14T12:00:00Z');

export interface TestApp extends Repos {
  app: FastifyInstance;
  db: Db;
  clock: FakeClock;
}

export async function buildTestApp(initialDate: Date = DEFAULT_TEST_DATE): Promise<TestApp> {
  const db = openDb();
  const clock = new FakeClock(initialDate);
  const repos = buildRepos(db);
  const services = buildServices(db, repos, clock);
  const app = buildFastifyApp(services, { logger: false });
  await app.ready();
  return { app, db, clock, ...repos };
}
