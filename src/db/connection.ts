import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export type Db = Database.Database;

const SCHEMA_FILE = 'schema.sql';

export function openDb(): Db {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  const schema = readFileSync(join(__dirname, SCHEMA_FILE), 'utf8');
  db.exec(schema);
  return db;
}
