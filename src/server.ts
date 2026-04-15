import { openDb } from './db/connection';
import { SystemClock } from './clock';
import { seed } from './seed';
import { buildRepos, buildServices, buildFastifyApp } from './appBuilder';

const DEFAULT_PORT = 3000;
const HOST = '0.0.0.0';

async function main() {
  const db = openDb();
  const clock = new SystemClock();
  const repos = buildRepos(db);
  seed(repos.teams, repos.windows);
  const services = buildServices(db, repos, clock);
  const app = buildFastifyApp(services, { logger: true });

  const port = Number(process.env.PORT ?? DEFAULT_PORT);
  await app.listen({ port, host: HOST });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
