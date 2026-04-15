import { openDb, type Db } from '../../src/db/connection';
import { TeamsRepo } from '../../src/db/teamsRepo';
import { WindowsRepo } from '../../src/db/windowsRepo';
import { QuotesRepo } from '../../src/db/quotesRepo';
import { OrdersRepo } from '../../src/db/ordersRepo';
import { QuotingService } from '../../src/services/quotingService';
import { FakeClock } from '../../src/shared/clock';
import { makeTeam, makeWindow, makeOrder, makeOrderPayload } from '../helpers/fixtures';

const NOW = new Date('2026-04-14T12:00:00Z');

function setup() {
  const db: Db = openDb();
  const teams = new TeamsRepo(db);
  const windows = new WindowsRepo(db);
  const quotes = new QuotesRepo(db);
  const orders = new OrdersRepo(db);
  const clock = new FakeClock(NOW);
  const service = new QuotingService(teams, windows, quotes, orders, clock);
  return { db, teams, windows, quotes, orders, clock, service };
}

describe('QuotingService.getQuotes', () => {
  it('returns empty array when no teams are in radius', () => {
    const { teams, service, db } = setup();
    // Team at North Pole, order at Tel Aviv: way outside 25km radius
    teams.insert(makeTeam({ id: 'team-np', lat: 89, lng: 0 }));
    const result = service.getQuotes(makeOrderPayload());
    expect(result).toEqual([]);
    db.close();
  });

  it('returns empty array when teams are in radius but no windows match the time range', () => {
    const { teams, windows, service, db } = setup();
    teams.insert(makeTeam());
    windows.insert(makeWindow({ id: 'w1', start_time: '2026-04-16 10:00:00', end_time: '2026-04-16 11:00:00' }));
    const result = service.getQuotes(makeOrderPayload());
    expect(result).toEqual([]);
    db.close();
  });

  it('returns empty array when windows match time but capacity is full', () => {
    const { teams, windows, orders, service, db } = setup();
    teams.insert(makeTeam());
    windows.insert(makeWindow({ id: 'w1' }));
    orders.insert(makeOrder({ id: 'o1', window_id: 'w1', weight: 1000 }));
    const result = service.getQuotes(makeOrderPayload({ weight: 10 }));
    expect(result).toEqual([]);
    db.close();
  });

  it('returns windows across multiple eligible teams', () => {
    const { teams, windows, service, db } = setup();
    teams.insert(makeTeam({ id: 'team-a', lat: 32.08, lng: 34.78 }));
    teams.insert(makeTeam({ id: 'team-b', lat: 32.09, lng: 34.79 }));
    windows.insert(makeWindow({ id: 'w-a', team_id: 'team-a', start_time: '2026-04-15 10:00:00', end_time: '2026-04-15 11:00:00' }));
    windows.insert(makeWindow({ id: 'w-b', team_id: 'team-b', start_time: '2026-04-15 11:00:00', end_time: '2026-04-15 12:00:00' }));
    const result = service.getQuotes(makeOrderPayload());
    expect(result).toHaveLength(2);
    expect(new Set(result.map(r => r.window_id))).toEqual(new Set(['w-a', 'w-b']));
    db.close();
  });

  it('assigns a unique quote_id per returned window and persists them', () => {
    const { teams, windows, quotes, service, db } = setup();
    teams.insert(makeTeam());
    windows.insert(makeWindow({ id: 'w1', start_time: '2026-04-15 10:00:00', end_time: '2026-04-15 11:00:00' }));
    windows.insert(makeWindow({ id: 'w2', start_time: '2026-04-15 11:00:00', end_time: '2026-04-15 12:00:00' }));
    const result = service.getQuotes(makeOrderPayload());
    expect(result).toHaveLength(2);
    const ids = result.map(r => r.quote_id);
    expect(new Set(ids).size).toBe(2);
    for (const id of ids) expect(quotes.findById(id)).toBeDefined();
    db.close();
  });

  it('uses injected clock for created_at and expires_at', () => {
    const { teams, windows, quotes, clock, service, db } = setup();
    teams.insert(makeTeam());
    windows.insert(makeWindow({ id: 'w1', start_time: '2026-04-15 10:00:00', end_time: '2026-04-15 11:00:00' }));
    const result = service.getQuotes(makeOrderPayload());
    const q = quotes.findById(result[0]!.quote_id)!;
    expect(q.created_at).toBe('2026-04-14 12:00:00');
    expect(q.expires_at).toBe('2026-04-14 12:05:00');
    db.close();
  });
});
