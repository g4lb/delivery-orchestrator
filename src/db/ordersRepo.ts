import type { Db } from './connection';
import type { Order } from '../types';

export class OrdersRepo {
  constructor(private db: Db) {}

  insert(order: Order): void {
    this.db
      .prepare(
        `INSERT INTO orders (id, window_id, lng, lat, weight, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(order.id, order.window_id, order.lng, order.lat, order.weight, order.created_at);
  }

  sumWeightByWindow(windowId: string): number {
    const row = this.db
      .prepare('SELECT COALESCE(SUM(weight), 0) AS total FROM orders WHERE window_id = ?')
      .get(windowId) as { total: number };
    return row.total;
  }

  sumWeightByWindowIds(windowIds: string[]): Map<string, number> {
    const result = new Map<string, number>();
    if (windowIds.length === 0) return result;
    const placeholders = windowIds.map(() => '?').join(',');
    const rows = this.db
      .prepare(
        `SELECT window_id, COALESCE(SUM(weight), 0) AS total
         FROM orders WHERE window_id IN (${placeholders})
         GROUP BY window_id`
      )
      .all(...windowIds) as Array<{ window_id: string; total: number }>;
    for (const r of rows) result.set(r.window_id, r.total);
    return result;
  }
}
