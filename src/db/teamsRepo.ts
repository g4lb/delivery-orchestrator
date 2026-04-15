import type { Db } from './connection';
import type { Team } from '../types';

export class TeamsRepo {
  constructor(private db: Db) {}

  listAll(): Team[] {
    return this.db.prepare('SELECT id, name, lng, lat FROM teams').all() as Team[];
  }

  insert(team: Team): void {
    this.db
      .prepare('INSERT INTO teams (id, name, lng, lat) VALUES (?, ?, ?, ?)')
      .run(team.id, team.name, team.lng, team.lat);
  }
}
