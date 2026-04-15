import type { Db } from './connection';
import type { DeliveryWindow } from '../shared/types';

export class WindowsRepo {
  constructor(private db: Db) {}

  insert(w: DeliveryWindow): void {
    this.db
      .prepare('INSERT INTO delivery_windows (id, team_id, start_time, end_time) VALUES (?, ?, ?, ?)')
      .run(w.id, w.team_id, w.start_time, w.end_time);
  }

  findById(id: string): DeliveryWindow | undefined {
    return this.db
      .prepare('SELECT id, team_id, start_time, end_time FROM delivery_windows WHERE id = ?')
      .get(id) as DeliveryWindow | undefined;
  }

  findStartingInRange(minTime: string, maxTime: string, teamIds: string[]): DeliveryWindow[] {
    if (teamIds.length === 0) return [];
    const placeholders = teamIds.map(() => '?').join(',');
    const sql = `
      SELECT id, team_id, start_time, end_time
      FROM delivery_windows
      WHERE team_id IN (${placeholders})
        AND start_time >= ?
        AND start_time < ?
      ORDER BY start_time
    `;
    return this.db.prepare(sql).all(...teamIds, minTime, maxTime) as DeliveryWindow[];
  }
}
