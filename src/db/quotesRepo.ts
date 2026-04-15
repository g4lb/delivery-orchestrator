import type { Db } from './connection';
import type { Quote } from '../shared/types';

export class QuotesRepo {
  constructor(private db: Db) {}

  insertMany(quotes: Quote[]): void {
    const stmt = this.db.prepare(
      `INSERT INTO quotes
       (id, window_id, lng, lat, min_time, max_time, weight, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const tx = this.db.transaction((rows: Quote[]) => {
      for (const q of rows) {
        stmt.run(q.id, q.window_id, q.lng, q.lat, q.min_time, q.max_time, q.weight, q.created_at, q.expires_at);
      }
    });
    tx(quotes);
  }

  findById(id: string): Quote | undefined {
    return this.db
      .prepare(
        `SELECT id, window_id, lng, lat, min_time, max_time, weight, created_at, expires_at
         FROM quotes WHERE id = ?`
      )
      .get(id) as Quote | undefined;
  }
}
