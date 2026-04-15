import { openDb } from '../../src/db/connection';

describe('openDb', () => {
  it('creates all four tables', () => {
    const db = openDb();
    const rows = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as Array<{ name: string }>;
    expect(rows.map(r => r.name)).toEqual(['delivery_windows', 'orders', 'quotes', 'teams']);
    db.close();
  });
});
