# Delivery Orchestrator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Node.js + TypeScript microservice exposing `GET /get_quotes` and `POST /book_order` backed by in-memory SQLite, with quote-then-book semantics and a test suite in Jest.

**Architecture:** Layered — `http/` routes → `services/` orchestration → pure `domain/` functions + isolated `db/` repositories. Availability is derived from `SUM(orders.weight)` per window. Booking runs inside `BEGIN IMMEDIATE` so concurrent bookings serialize. Quote TTL is 5 minutes, enforced lazily. Clock is injected for deterministic tests.

**Tech Stack:** Node.js, TypeScript, Fastify, better-sqlite3, Jest, ts-jest, uuid.

**Spec:** `docs/superpowers/specs/2026-04-15-delivery-orchestrator-design.md`

---

## File Structure

```
delivery-orchestrator/
├── package.json                 (deps, scripts)
├── tsconfig.json                (relaxed to CJS for Jest simplicity)
├── jest.config.js
├── .gitignore
├── src/
│   ├── server.ts                entry point
│   ├── config.ts                constants
│   ├── clock.ts                 Clock interface + SystemClock + FakeClock
│   ├── types.ts                 shared TS types
│   ├── seed.ts                  boot-time data
│   ├── http/
│   │   └── routes/
│   │       ├── getQuotes.ts
│   │       └── bookOrder.ts
│   ├── services/
│   │   ├── quotingService.ts
│   │   └── bookingService.ts
│   ├── domain/
│   │   ├── geo.ts
│   │   ├── time.ts
│   │   └── availability.ts
│   └── db/
│       ├── schema.sql
│       ├── connection.ts
│       ├── teamsRepo.ts
│       ├── windowsRepo.ts
│       ├── quotesRepo.ts
│       └── ordersRepo.ts
└── test/
    ├── helpers/
    │   ├── buildTestApp.ts
    │   └── fixtures.ts
    ├── domain/
    │   ├── geo.test.ts
    │   ├── time.test.ts
    │   └── availability.test.ts
    ├── services/
    │   ├── quotingService.test.ts
    │   └── bookingService.test.ts
    └── http/
        ├── getQuotes.test.ts
        └── bookOrder.test.ts
```

---

## Task 1: Project Bootstrap

**Files:**
- Create: `.gitignore`
- Modify: `package.json`
- Modify: `tsconfig.json`
- Create: `jest.config.js`

- [ ] **Step 1: Initialize git**

Run:
```bash
cd /Users/galb/Documents/delivery-orchestrator
git init
```
Expected: `Initialized empty Git repository`.

- [ ] **Step 2: Write `.gitignore`**

Create `.gitignore`:
```
node_modules
dist
coverage
*.log
.DS_Store
```

- [ ] **Step 3: Replace `package.json`**

Overwrite `package.json`:
```json
{
  "name": "delivery-orchestrator",
  "version": "1.0.0",
  "private": true,
  "main": "dist/server.js",
  "scripts": {
    "build": "tsc",
    "start": "node dist/server.js",
    "dev": "ts-node src/server.ts",
    "test": "jest",
    "test:watch": "jest --watch"
  },
  "dependencies": {
    "better-sqlite3": "^11.3.0",
    "fastify": "^5.0.0",
    "uuid": "^10.0.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.11",
    "@types/jest": "^29.5.13",
    "@types/node": "^22.7.4",
    "@types/uuid": "^10.0.0",
    "jest": "^29.7.0",
    "ts-jest": "^29.2.5",
    "ts-node": "^10.9.2",
    "typescript": "^5.6.3"
  }
}
```

Note: downgrading `typescript` from `^6.0.2` (the scaffold default) to `^5.6.3` because ts-jest 29 does not yet support TS 6. This is fine for the service.

- [ ] **Step 4: Replace `tsconfig.json`**

Overwrite `tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "es2022",
    "module": "commonjs",
    "moduleResolution": "node",
    "rootDir": "./src",
    "outDir": "./dist",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": false,
    "sourceMap": true,
    "types": ["node", "jest"]
  },
  "include": ["src/**/*", "test/**/*"],
  "exclude": ["node_modules", "dist"]
}
```
This drops `verbatimModuleSyntax` and `module: nodenext` so import paths don't need `.js` extensions and Jest doesn't need ESM flags.

- [ ] **Step 5: Create `jest.config.js`**

Create `jest.config.js`:
```js
/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/test/**/*.test.ts'],
  clearMocks: true,
};
```

- [ ] **Step 6: Install dependencies**

Run:
```bash
rm -rf node_modules package-lock.json
npm install
```
Expected: installs without errors. `better-sqlite3` builds a native module — this may take ~30s.

- [ ] **Step 7: Verify TypeScript compiles the empty project**

Run:
```bash
mkdir -p src && echo "export {};" > src/server.ts && npx tsc --noEmit
```
Expected: no output, exit code 0.

- [ ] **Step 8: Commit**

```bash
git add .gitignore package.json package-lock.json tsconfig.json jest.config.js src/server.ts
git commit -m "chore: bootstrap TypeScript + Fastify + Jest project"
```

---

## Task 2: Config, Types, and Clock

**Files:**
- Create: `src/config.ts`
- Create: `src/types.ts`
- Create: `src/clock.ts`

- [ ] **Step 1: Create `src/config.ts`**

```ts
export const MAX_WINDOW_WEIGHT_KG = 1000;
export const SERVICE_RADIUS_KM = 25;
export const QUOTE_TTL_MS = 5 * 60 * 1000;
export const SLOT_DURATION_MS = 60 * 60 * 1000;
```

- [ ] **Step 2: Create `src/types.ts`**

```ts
export interface Team {
  id: string;
  name: string;
  lng: number;
  lat: number;
}

export interface DeliveryWindow {
  id: string;
  team_id: string;
  start_time: string;
  end_time: string;
}

export interface OrderPayload {
  lng: number;
  lat: number;
  min_time: string;
  max_time: string;
  weight: number;
}

export interface Quote {
  id: string;
  window_id: string;
  lng: number;
  lat: number;
  min_time: string;
  max_time: string;
  weight: number;
  created_at: string;
  expires_at: string;
}

export interface Order {
  id: string;
  window_id: string;
  lng: number;
  lat: number;
  weight: number;
  created_at: string;
}

export interface QuoteResult {
  quote_id: string;
  window_id: string;
  team_id: string;
  start_time: string;
  end_time: string;
  expires_at: string;
}

export type BookingResult =
  | { ok: true; order_id: string }
  | { ok: false; reason: 'quote_not_found' | 'payload_mismatch' | 'quote_expired' | 'capacity_exceeded' };
```

- [ ] **Step 3: Create `src/clock.ts`**

```ts
export interface Clock {
  now(): Date;
}

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

export class FakeClock implements Clock {
  private current: Date;
  constructor(initial: Date) {
    this.current = new Date(initial.getTime());
  }
  now(): Date {
    return new Date(this.current.getTime());
  }
  advanceMs(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
  set(date: Date): void {
    this.current = new Date(date.getTime());
  }
}

export function formatIso(d: Date): string {
  // "YYYY-MM-DD HH:MM:SS" naive (UTC components, no timezone suffix)
  const pad = (n: number) => n.toString().padStart(2, '0');
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
  );
}
```

- [ ] **Step 4: Verify typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/config.ts src/types.ts src/clock.ts
git commit -m "feat: config constants, domain types, injectable clock"
```

---

## Task 3: Database Schema and Connection

**Files:**
- Create: `src/db/schema.sql`
- Create: `src/db/connection.ts`

- [ ] **Step 1: Create `src/db/schema.sql`**

```sql
CREATE TABLE teams (
  id   TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  lng  REAL NOT NULL,
  lat  REAL NOT NULL
);

CREATE TABLE delivery_windows (
  id         TEXT PRIMARY KEY,
  team_id    TEXT NOT NULL REFERENCES teams(id),
  start_time TEXT NOT NULL,
  end_time   TEXT NOT NULL
);
CREATE INDEX idx_windows_start ON delivery_windows(start_time);

CREATE TABLE quotes (
  id         TEXT PRIMARY KEY,
  window_id  TEXT NOT NULL REFERENCES delivery_windows(id),
  lng        REAL NOT NULL,
  lat        REAL NOT NULL,
  min_time   TEXT NOT NULL,
  max_time   TEXT NOT NULL,
  weight     REAL NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX idx_quotes_window ON quotes(window_id);

CREATE TABLE orders (
  id         TEXT PRIMARY KEY,
  window_id  TEXT NOT NULL REFERENCES delivery_windows(id),
  lng        REAL NOT NULL,
  lat        REAL NOT NULL,
  weight     REAL NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_orders_window ON orders(window_id);
```

- [ ] **Step 2: Create `src/db/connection.ts`**

```ts
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export type Db = Database.Database;

export function openDb(): Db {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  const schema = readFileSync(join(__dirname, 'schema.sql'), 'utf8');
  db.exec(schema);
  return db;
}
```

Note: `schema.sql` lives alongside `connection.ts` in `src/db/`. Because `jest.config.js` uses `ts-jest` running TS source directly, `__dirname` resolves to `src/db/` at test time — no extra copy step needed. For the production build, we'll copy the SQL file in Task 12.

- [ ] **Step 3: Smoke-test the connection**

Create `test/db/connection.test.ts`:
```ts
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
```

- [ ] **Step 4: Run the test**

Run: `npx jest test/db/connection.test.ts`
Expected: 1 test passes.

- [ ] **Step 5: Commit**

```bash
git add src/db/schema.sql src/db/connection.ts test/db/connection.test.ts
git commit -m "feat: SQLite schema and in-memory connection"
```

---

## Task 4: Domain — Haversine Distance (TDD)

**Files:**
- Create: `test/domain/geo.test.ts`
- Create: `src/domain/geo.ts`

- [ ] **Step 1: Write the failing test**

Create `test/domain/geo.test.ts`:
```ts
import { haversineKm } from '../../src/domain/geo';

describe('haversineKm', () => {
  it('returns 0 for identical points', () => {
    expect(haversineKm({ lat: 32.08, lng: 34.78 }, { lat: 32.08, lng: 34.78 })).toBeCloseTo(0, 5);
  });

  it('computes Tel Aviv -> Jerusalem within 1% of 54 km', () => {
    const tlv = { lat: 32.0853, lng: 34.7818 };
    const jlm = { lat: 31.7683, lng: 35.2137 };
    const d = haversineKm(tlv, jlm);
    expect(d).toBeGreaterThan(53);
    expect(d).toBeLessThan(55);
  });

  it('handles antipodal points', () => {
    const d = haversineKm({ lat: 0, lng: 0 }, { lat: 0, lng: 180 });
    // Earth half-circumference ≈ 20015 km
    expect(d).toBeGreaterThan(20000);
    expect(d).toBeLessThan(20030);
  });

  it('handles negative longitudes symmetrically', () => {
    const d1 = haversineKm({ lat: 0, lng: 10 }, { lat: 0, lng: 20 });
    const d2 = haversineKm({ lat: 0, lng: -10 }, { lat: 0, lng: -20 });
    expect(d1).toBeCloseTo(d2, 5);
  });
});
```

- [ ] **Step 2: Run and verify it fails**

Run: `npx jest test/domain/geo.test.ts`
Expected: fails with "Cannot find module '../../src/domain/geo'".

- [ ] **Step 3: Implement `src/domain/geo.ts`**

```ts
export interface Point {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_KM = 6371;

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function haversineKm(a: Point, b: Point): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}
```

- [ ] **Step 4: Run and verify passing**

Run: `npx jest test/domain/geo.test.ts`
Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/domain/geo.ts test/domain/geo.test.ts
git commit -m "feat(domain): haversine distance"
```

---

## Task 5: Domain — Window-Matches-Order (TDD)

**Files:**
- Create: `test/domain/time.test.ts`
- Create: `src/domain/time.ts`

- [ ] **Step 1: Write the failing test**

Create `test/domain/time.test.ts`:
```ts
import { windowMatchesOrder } from '../../src/domain/time';
import type { DeliveryWindow, OrderPayload } from '../../src/types';

const order: OrderPayload = {
  lng: 0, lat: 0, weight: 100,
  min_time: '2026-04-15 09:00:00',
  max_time: '2026-04-15 12:00:00',
};

const makeWindow = (start: string, end: string): DeliveryWindow => ({
  id: 'w', team_id: 't', start_time: start, end_time: end,
});

describe('windowMatchesOrder', () => {
  it('matches when window starts exactly at min_time', () => {
    expect(windowMatchesOrder(makeWindow('2026-04-15 09:00:00', '2026-04-15 10:00:00'), order)).toBe(true);
  });

  it('matches when window starts strictly inside the range', () => {
    expect(windowMatchesOrder(makeWindow('2026-04-15 10:00:00', '2026-04-15 11:00:00'), order)).toBe(true);
  });

  it('matches when window starts inside but ends after max_time (half-open semantics)', () => {
    expect(windowMatchesOrder(makeWindow('2026-04-15 11:30:00', '2026-04-15 12:30:00'), order)).toBe(true);
  });

  it('rejects when window starts exactly at max_time (half-open on the right)', () => {
    expect(windowMatchesOrder(makeWindow('2026-04-15 12:00:00', '2026-04-15 13:00:00'), order)).toBe(false);
  });

  it('rejects when window starts before min_time', () => {
    expect(windowMatchesOrder(makeWindow('2026-04-15 08:30:00', '2026-04-15 09:30:00'), order)).toBe(false);
  });

  it('rejects when window starts after max_time', () => {
    expect(windowMatchesOrder(makeWindow('2026-04-15 13:00:00', '2026-04-15 14:00:00'), order)).toBe(false);
  });
});
```

- [ ] **Step 2: Run and verify it fails**

Run: `npx jest test/domain/time.test.ts`
Expected: fails with module not found.

- [ ] **Step 3: Implement `src/domain/time.ts`**

```ts
import type { DeliveryWindow, OrderPayload } from '../types';

export function windowMatchesOrder(window: DeliveryWindow, order: OrderPayload): boolean {
  return window.start_time >= order.min_time && window.start_time < order.max_time;
}
```

Lexicographic comparison works because all timestamps are naive `YYYY-MM-DD HH:MM:SS` in the same clock — the spec explicitly commits to this.

- [ ] **Step 4: Run and verify passing**

Run: `npx jest test/domain/time.test.ts`
Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/domain/time.ts test/domain/time.test.ts
git commit -m "feat(domain): window-matches-order half-open time check"
```

---

## Task 6: Domain — Capacity Fit (TDD)

**Files:**
- Create: `test/domain/availability.test.ts`
- Create: `src/domain/availability.ts`

- [ ] **Step 1: Write the failing test**

Create `test/domain/availability.test.ts`:
```ts
import { fits } from '../../src/domain/availability';

describe('fits', () => {
  it('accepts when empty window has room', () => {
    expect(fits(100, 0, 1000)).toBe(true);
  });

  it('accepts partial fill that still leaves room', () => {
    expect(fits(100, 500, 1000)).toBe(true);
  });

  it('accepts exact fit', () => {
    expect(fits(500, 500, 1000)).toBe(true);
  });

  it('rejects one kg over', () => {
    expect(fits(501, 500, 1000)).toBe(false);
  });

  it('rejects when order alone exceeds capacity', () => {
    expect(fits(1500, 0, 1000)).toBe(false);
  });

  it('rejects when window is already at capacity', () => {
    expect(fits(1, 1000, 1000)).toBe(false);
  });
});
```

- [ ] **Step 2: Run and verify it fails**

Run: `npx jest test/domain/availability.test.ts`
Expected: fails with module not found.

- [ ] **Step 3: Implement `src/domain/availability.ts`**

```ts
export function fits(orderWeight: number, usedWeight: number, capacity: number): boolean {
  return usedWeight + orderWeight <= capacity;
}
```

- [ ] **Step 4: Run and verify passing**

Run: `npx jest test/domain/availability.test.ts`
Expected: 6 tests pass.

- [ ] **Step 5: Run all domain tests**

Run: `npx jest test/domain`
Expected: 16 tests pass across 3 files.

- [ ] **Step 6: Commit**

```bash
git add src/domain/availability.ts test/domain/availability.test.ts
git commit -m "feat(domain): capacity fit predicate"
```

---

## Task 7: Repositories

**Files:**
- Create: `src/db/teamsRepo.ts`
- Create: `src/db/windowsRepo.ts`
- Create: `src/db/quotesRepo.ts`
- Create: `src/db/ordersRepo.ts`

All four repos in one task — they are thin SQL wrappers and we'll test them via the service tests in later tasks. No test file in this task.

- [ ] **Step 1: Create `src/db/teamsRepo.ts`**

```ts
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
```

- [ ] **Step 2: Create `src/db/windowsRepo.ts`**

```ts
import type { Db } from './connection';
import type { DeliveryWindow } from '../types';

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
```

- [ ] **Step 3: Create `src/db/quotesRepo.ts`**

```ts
import type { Db } from './connection';
import type { Quote } from '../types';

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
```

- [ ] **Step 4: Create `src/db/ordersRepo.ts`**

```ts
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
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/db/teamsRepo.ts src/db/windowsRepo.ts src/db/quotesRepo.ts src/db/ordersRepo.ts
git commit -m "feat(db): repositories for teams, windows, quotes, orders"
```

---

## Task 8: Test Fixtures Helper

**Files:**
- Create: `test/helpers/fixtures.ts`

This is infrastructure used by the next several tasks. No tests of its own.

- [ ] **Step 1: Create `test/helpers/fixtures.ts`**

```ts
import type { Team, DeliveryWindow, Order, OrderPayload } from '../../src/types';

export function makeTeam(overrides: Partial<Team> = {}): Team {
  return {
    id: 'team-default',
    name: 'Default Team',
    lng: 34.78,
    lat: 32.08,
    ...overrides,
  };
}

export function makeWindow(overrides: Partial<DeliveryWindow> = {}): DeliveryWindow {
  return {
    id: 'win-default',
    team_id: 'team-default',
    start_time: '2026-04-15 10:00:00',
    end_time: '2026-04-15 11:00:00',
    ...overrides,
  };
}

export function makeOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: 'ord-default',
    window_id: 'win-default',
    lng: 34.78,
    lat: 32.08,
    weight: 100,
    created_at: '2026-04-15 09:00:00',
    ...overrides,
  };
}

export function makeOrderPayload(overrides: Partial<OrderPayload> = {}): OrderPayload {
  return {
    lng: 34.78,
    lat: 32.08,
    min_time: '2026-04-15 09:00:00',
    max_time: '2026-04-15 13:00:00',
    weight: 100,
    ...overrides,
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add test/helpers/fixtures.ts
git commit -m "test: fixture builders for teams, windows, orders, payloads"
```

---

## Task 9: Quoting Service (TDD)

**Files:**
- Create: `test/services/quotingService.test.ts`
- Create: `src/services/quotingService.ts`

- [ ] **Step 1: Write the failing test**

Create `test/services/quotingService.test.ts`:
```ts
import { openDb, type Db } from '../../src/db/connection';
import { TeamsRepo } from '../../src/db/teamsRepo';
import { WindowsRepo } from '../../src/db/windowsRepo';
import { QuotesRepo } from '../../src/db/quotesRepo';
import { OrdersRepo } from '../../src/db/ordersRepo';
import { QuotingService } from '../../src/services/quotingService';
import { FakeClock } from '../../src/clock';
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
```

- [ ] **Step 2: Run and verify it fails**

Run: `npx jest test/services/quotingService.test.ts`
Expected: fails because `QuotingService` does not exist.

- [ ] **Step 3: Implement `src/services/quotingService.ts`**

```ts
import { v4 as uuidv4 } from 'uuid';
import type { OrderPayload, QuoteResult, Quote } from '../types';
import type { TeamsRepo } from '../db/teamsRepo';
import type { WindowsRepo } from '../db/windowsRepo';
import type { QuotesRepo } from '../db/quotesRepo';
import type { OrdersRepo } from '../db/ordersRepo';
import type { Clock } from '../clock';
import { formatIso } from '../clock';
import { haversineKm } from '../domain/geo';
import { fits } from '../domain/availability';
import { MAX_WINDOW_WEIGHT_KG, SERVICE_RADIUS_KM, QUOTE_TTL_MS } from '../config';

export class QuotingService {
  constructor(
    private teams: TeamsRepo,
    private windows: WindowsRepo,
    private quotes: QuotesRepo,
    private orders: OrdersRepo,
    private clock: Clock,
  ) {}

  getQuotes(order: OrderPayload): QuoteResult[] {
    const allTeams = this.teams.listAll();
    const eligibleTeams = allTeams.filter(
      t => haversineKm({ lat: order.lat, lng: order.lng }, { lat: t.lat, lng: t.lng }) <= SERVICE_RADIUS_KM,
    );
    if (eligibleTeams.length === 0) return [];

    const eligibleTeamIds = eligibleTeams.map(t => t.id);
    const candidateWindows = this.windows.findStartingInRange(order.min_time, order.max_time, eligibleTeamIds);
    if (candidateWindows.length === 0) return [];

    const usedWeights = this.orders.sumWeightByWindowIds(candidateWindows.map(w => w.id));
    const fittingWindows = candidateWindows.filter(w =>
      fits(order.weight, usedWeights.get(w.id) ?? 0, MAX_WINDOW_WEIGHT_KG),
    );
    if (fittingWindows.length === 0) return [];

    const now = this.clock.now();
    const createdAt = formatIso(now);
    const expiresAt = formatIso(new Date(now.getTime() + QUOTE_TTL_MS));

    const newQuotes: Quote[] = fittingWindows.map(w => ({
      id: uuidv4(),
      window_id: w.id,
      lng: order.lng,
      lat: order.lat,
      min_time: order.min_time,
      max_time: order.max_time,
      weight: order.weight,
      created_at: createdAt,
      expires_at: expiresAt,
    }));
    this.quotes.insertMany(newQuotes);

    return newQuotes.map((q, i) => ({
      quote_id: q.id,
      window_id: fittingWindows[i]!.id,
      team_id: fittingWindows[i]!.team_id,
      start_time: fittingWindows[i]!.start_time,
      end_time: fittingWindows[i]!.end_time,
      expires_at: q.expires_at,
    }));
  }
}
```

- [ ] **Step 4: Run and verify passing**

Run: `npx jest test/services/quotingService.test.ts`
Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/services/quotingService.ts test/services/quotingService.test.ts
git commit -m "feat(services): quoting service with TDD"
```

---

## Task 10: Booking Service (TDD)

**Files:**
- Create: `test/services/bookingService.test.ts`
- Create: `src/services/bookingService.ts`

- [ ] **Step 1: Write the failing test**

Create `test/services/bookingService.test.ts`:
```ts
import { openDb, type Db } from '../../src/db/connection';
import { WindowsRepo } from '../../src/db/windowsRepo';
import { QuotesRepo } from '../../src/db/quotesRepo';
import { OrdersRepo } from '../../src/db/ordersRepo';
import { BookingService } from '../../src/services/bookingService';
import { FakeClock } from '../../src/clock';
import { makeWindow, makeOrder, makeOrderPayload } from '../helpers/fixtures';
import type { Quote } from '../../src/types';

const NOW = new Date('2026-04-14T12:00:00Z');

function setup() {
  const db: Db = openDb();
  const windows = new WindowsRepo(db);
  const quotes = new QuotesRepo(db);
  const orders = new OrdersRepo(db);
  const clock = new FakeClock(NOW);
  const service = new BookingService(db, windows, quotes, orders, clock);
  return { db, windows, quotes, orders, clock, service };
}

function seedQuote(
  quotes: QuotesRepo,
  overrides: Partial<Quote> = {},
): Quote {
  const q: Quote = {
    id: 'q-default',
    window_id: 'win-default',
    lng: 34.78,
    lat: 32.08,
    min_time: '2026-04-15 09:00:00',
    max_time: '2026-04-15 13:00:00',
    weight: 100,
    created_at: '2026-04-14 12:00:00',
    expires_at: '2026-04-14 12:05:00',
    ...overrides,
  };
  quotes.insertMany([q]);
  return q;
}

describe('BookingService.book', () => {
  it('happy path inserts an order and returns order_id', () => {
    const { windows, quotes, service, db } = setup();
    windows.insert(makeWindow());
    const q = seedQuote(quotes);
    const result = service.book(q.id, makeOrderPayload());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.order_id).toMatch(/^[0-9a-f-]{36}$/);
    db.close();
  });

  it('returns quote_not_found for unknown quote', () => {
    const { service, db } = setup();
    const result = service.book('does-not-exist', makeOrderPayload());
    expect(result).toEqual({ ok: false, reason: 'quote_not_found' });
    db.close();
  });

  it('returns quote_expired when clock has advanced past expires_at', () => {
    const { windows, quotes, clock, service, db } = setup();
    windows.insert(makeWindow());
    const q = seedQuote(quotes);
    clock.advanceMs(6 * 60 * 1000);
    const result = service.book(q.id, makeOrderPayload());
    expect(result).toEqual({ ok: false, reason: 'quote_expired' });
    db.close();
  });

  it.each([
    ['lng', { lng: 35 }],
    ['lat', { lat: 33 }],
    ['min_time', { min_time: '2026-04-15 09:00:01' }],
    ['max_time', { max_time: '2026-04-15 13:00:01' }],
    ['weight', { weight: 101 }],
  ])('returns payload_mismatch when %s differs', (_field, override) => {
    const { windows, quotes, service, db } = setup();
    windows.insert(makeWindow());
    const q = seedQuote(quotes);
    const result = service.book(q.id, makeOrderPayload(override));
    expect(result).toEqual({ ok: false, reason: 'payload_mismatch' });
    db.close();
  });

  it('returns capacity_exceeded when re-check fails', () => {
    const { windows, quotes, orders, service, db } = setup();
    windows.insert(makeWindow());
    // Pre-fill window to 995 kg, then try to book a 100 kg quote (total 1095 > 1000)
    orders.insert(makeOrder({ id: 'o-fill', window_id: 'win-default', weight: 995 }));
    const q = seedQuote(quotes);
    const result = service.book(q.id, makeOrderPayload());
    expect(result).toEqual({ ok: false, reason: 'capacity_exceeded' });
    db.close();
  });

  it('allows same quote to book twice when capacity permits (no consumption semantics)', () => {
    const { windows, quotes, service, db } = setup();
    windows.insert(makeWindow());
    const q = seedQuote(quotes);
    const r1 = service.book(q.id, makeOrderPayload());
    const r2 = service.book(q.id, makeOrderPayload());
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    const sum = db.prepare('SELECT COALESCE(SUM(weight),0) AS s FROM orders').get() as { s: number };
    expect(sum.s).toBe(200);
    db.close();
  });
});
```

- [ ] **Step 2: Run and verify it fails**

Run: `npx jest test/services/bookingService.test.ts`
Expected: fails — `BookingService` does not exist.

- [ ] **Step 3: Implement `src/services/bookingService.ts`**

```ts
import { v4 as uuidv4 } from 'uuid';
import type { Db } from '../db/connection';
import type { WindowsRepo } from '../db/windowsRepo';
import type { QuotesRepo } from '../db/quotesRepo';
import type { OrdersRepo } from '../db/ordersRepo';
import type { Clock } from '../clock';
import { formatIso } from '../clock';
import type { OrderPayload, BookingResult, Quote } from '../types';
import { fits } from '../domain/availability';
import { MAX_WINDOW_WEIGHT_KG } from '../config';

function snapshotMatches(q: Quote, p: OrderPayload): boolean {
  return (
    q.lng === p.lng &&
    q.lat === p.lat &&
    q.min_time === p.min_time &&
    q.max_time === p.max_time &&
    q.weight === p.weight
  );
}

export class BookingService {
  constructor(
    private db: Db,
    private windows: WindowsRepo,
    private quotes: QuotesRepo,
    private orders: OrdersRepo,
    private clock: Clock,
  ) {}

  book(quoteId: string, submitted: OrderPayload): BookingResult {
    const runTx = this.db.transaction((): BookingResult => {
      const quote = this.quotes.findById(quoteId);
      if (!quote) return { ok: false, reason: 'quote_not_found' };

      if (!snapshotMatches(quote, submitted)) {
        return { ok: false, reason: 'payload_mismatch' };
      }

      const nowIso = formatIso(this.clock.now());
      if (nowIso > quote.expires_at) {
        return { ok: false, reason: 'quote_expired' };
      }

      const used = this.orders.sumWeightByWindow(quote.window_id);
      if (!fits(quote.weight, used, MAX_WINDOW_WEIGHT_KG)) {
        return { ok: false, reason: 'capacity_exceeded' };
      }

      const orderId = uuidv4();
      this.orders.insert({
        id: orderId,
        window_id: quote.window_id,
        lng: quote.lng,
        lat: quote.lat,
        weight: quote.weight,
        created_at: nowIso,
      });
      return { ok: true, order_id: orderId };
    });
    // `better-sqlite3` transactions default to DEFERRED; switch to IMMEDIATE so
    // the write lock is acquired at the start and two concurrent book() calls serialize.
    return runTx.immediate();
  }
}
```

- [ ] **Step 4: Run and verify passing**

Run: `npx jest test/services/bookingService.test.ts`
Expected: 10 tests pass (1 happy + 1 not_found + 1 expired + 5 mismatch rows + 1 capacity + 1 double-book).

- [ ] **Step 5: Run all tests so far**

Run: `npx jest`
Expected: all domain, db, and service tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/services/bookingService.ts test/services/bookingService.test.ts
git commit -m "feat(services): transactional booking service with TDD"
```

---

## Task 11: HTTP Routes + buildTestApp + Integration Tests

**Files:**
- Create: `src/http/routes/getQuotes.ts`
- Create: `src/http/routes/bookOrder.ts`
- Create: `test/helpers/buildTestApp.ts`
- Create: `test/http/getQuotes.test.ts`
- Create: `test/http/bookOrder.test.ts`

This task bundles routes, the test-app builder, and the HTTP integration tests. The builder is what the route tests need, and the routes are thin enough that isolating them from a harness would be pointless.

- [ ] **Step 1: Create `src/http/routes/getQuotes.ts`**

```ts
import type { FastifyInstance } from 'fastify';
import type { QuotingService } from '../../services/quotingService';
import { MAX_WINDOW_WEIGHT_KG } from '../../config';

const orderPayloadSchema = {
  type: 'object',
  required: ['lng', 'lat', 'min_time', 'max_time', 'weight'],
  additionalProperties: false,
  properties: {
    lng: { type: 'number', minimum: -180, maximum: 180 },
    lat: { type: 'number', minimum: -90, maximum: 90 },
    min_time: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}$' },
    max_time: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}$' },
    weight: { type: 'number', exclusiveMinimum: 0, maximum: MAX_WINDOW_WEIGHT_KG },
  },
} as const;

export function registerGetQuotesRoute(app: FastifyInstance, service: QuotingService): void {
  app.route({
    method: ['GET', 'POST'],
    url: '/get_quotes',
    schema: { body: orderPayloadSchema },
    handler: async (req, reply) => {
      const body = req.body as {
        lng: number; lat: number; min_time: string; max_time: string; weight: number;
      };
      if (body.min_time >= body.max_time) {
        return reply.code(400).send({ error: 'invalid_payload', details: ['min_time must be < max_time'] });
      }
      const quotes = service.getQuotes(body);
      return reply.code(200).send({ quotes });
    },
  });
}
```

Note: the route is registered on both GET and POST. Some HTTP clients and proxies strip bodies from GET; accepting either keeps the spec's GET-with-body intent while staying interoperable.

- [ ] **Step 2: Create `src/http/routes/bookOrder.ts`**

```ts
import type { FastifyInstance } from 'fastify';
import type { BookingService } from '../../services/bookingService';
import { MAX_WINDOW_WEIGHT_KG } from '../../config';

const bookOrderSchema = {
  type: 'object',
  required: ['quote_id', 'lng', 'lat', 'min_time', 'max_time', 'weight'],
  additionalProperties: false,
  properties: {
    quote_id: { type: 'string', minLength: 1 },
    lng: { type: 'number', minimum: -180, maximum: 180 },
    lat: { type: 'number', minimum: -90, maximum: 90 },
    min_time: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}$' },
    max_time: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}$' },
    weight: { type: 'number', exclusiveMinimum: 0, maximum: MAX_WINDOW_WEIGHT_KG },
  },
} as const;

const REASON_TO_STATUS: Record<string, number> = {
  quote_not_found: 404,
  payload_mismatch: 400,
  quote_expired: 410,
  capacity_exceeded: 409,
};

export function registerBookOrderRoute(app: FastifyInstance, service: BookingService): void {
  app.post('/book_order', { schema: { body: bookOrderSchema } }, async (req, reply) => {
    const body = req.body as {
      quote_id: string; lng: number; lat: number; min_time: string; max_time: string; weight: number;
    };
    if (body.min_time >= body.max_time) {
      return reply.code(400).send({ error: 'invalid_payload', details: ['min_time must be < max_time'] });
    }
    const { quote_id, ...payload } = body;
    const result = service.book(quote_id, payload);
    if (result.ok) {
      return reply.code(200).send({ order_id: result.order_id });
    }
    return reply.code(REASON_TO_STATUS[result.reason]!).send({ error: result.reason });
  });
}
```

- [ ] **Step 3: Create `test/helpers/buildTestApp.ts`**

```ts
import Fastify, { type FastifyInstance } from 'fastify';
import { openDb, type Db } from '../../src/db/connection';
import { TeamsRepo } from '../../src/db/teamsRepo';
import { WindowsRepo } from '../../src/db/windowsRepo';
import { QuotesRepo } from '../../src/db/quotesRepo';
import { OrdersRepo } from '../../src/db/ordersRepo';
import { QuotingService } from '../../src/services/quotingService';
import { BookingService } from '../../src/services/bookingService';
import { FakeClock } from '../../src/clock';
import { registerGetQuotesRoute } from '../../src/http/routes/getQuotes';
import { registerBookOrderRoute } from '../../src/http/routes/bookOrder';

export interface TestApp {
  app: FastifyInstance;
  db: Db;
  clock: FakeClock;
  teams: TeamsRepo;
  windows: WindowsRepo;
  quotes: QuotesRepo;
  orders: OrdersRepo;
}

export async function buildTestApp(initialDate = new Date('2026-04-14T12:00:00Z')): Promise<TestApp> {
  const db = openDb();
  const teams = new TeamsRepo(db);
  const windows = new WindowsRepo(db);
  const quotes = new QuotesRepo(db);
  const orders = new OrdersRepo(db);
  const clock = new FakeClock(initialDate);
  const quotingService = new QuotingService(teams, windows, quotes, orders, clock);
  const bookingService = new BookingService(db, windows, quotes, orders, clock);

  const app = Fastify({ logger: false });
  app.setErrorHandler((err, _req, reply) => {
    if (err.validation) {
      return reply.code(400).send({ error: 'invalid_payload', details: err.validation });
    }
    // eslint-disable-next-line no-console
    console.error(err);
    return reply.code(500).send({ error: 'internal_error' });
  });
  registerGetQuotesRoute(app, quotingService);
  registerBookOrderRoute(app, bookingService);
  await app.ready();
  return { app, db, clock, teams, windows, quotes, orders };
}
```

- [ ] **Step 4: Create `test/http/getQuotes.test.ts`**

```ts
import { buildTestApp } from '../helpers/buildTestApp';
import { makeTeam, makeWindow, makeOrderPayload } from '../helpers/fixtures';

describe('GET /get_quotes', () => {
  it('returns 200 with quotes for a plausible seeded fixture', async () => {
    const { app, teams, windows, db } = await buildTestApp();
    teams.insert(makeTeam());
    windows.insert(makeWindow({ id: 'w1', start_time: '2026-04-15 10:00:00', end_time: '2026-04-15 11:00:00' }));

    const res = await app.inject({ method: 'POST', url: '/get_quotes', payload: makeOrderPayload() });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { quotes: Array<{ quote_id: string; window_id: string }> };
    expect(body.quotes).toHaveLength(1);
    expect(body.quotes[0]!.window_id).toBe('w1');
    await app.close();
    db.close();
  });

  it('returns 400 on missing weight field', async () => {
    const { app, db } = await buildTestApp();
    const { weight, ...bad } = makeOrderPayload();
    void weight;
    const res = await app.inject({ method: 'POST', url: '/get_quotes', payload: bad });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'invalid_payload' });
    await app.close();
    db.close();
  });

  it('returns 200 with empty array when nothing matches', async () => {
    const { app, db } = await buildTestApp();
    const res = await app.inject({ method: 'POST', url: '/get_quotes', payload: makeOrderPayload() });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ quotes: [] });
    await app.close();
    db.close();
  });
});
```

- [ ] **Step 5: Create `test/http/bookOrder.test.ts`**

```ts
import { buildTestApp } from '../helpers/buildTestApp';
import { makeTeam, makeWindow, makeOrder, makeOrderPayload } from '../helpers/fixtures';

async function seedAndQuote() {
  const t = await buildTestApp();
  t.teams.insert(makeTeam());
  t.windows.insert(makeWindow({ id: 'w1', start_time: '2026-04-15 10:00:00', end_time: '2026-04-15 11:00:00' }));
  const res = await t.app.inject({ method: 'POST', url: '/get_quotes', payload: makeOrderPayload() });
  const quotes = (res.json() as { quotes: Array<{ quote_id: string }> }).quotes;
  return { ...t, quoteId: quotes[0]!.quote_id };
}

describe('POST /book_order', () => {
  it('returns 200 + order_id on happy path', async () => {
    const { app, quoteId, db } = await seedAndQuote();
    const res = await app.inject({
      method: 'POST', url: '/book_order',
      payload: { quote_id: quoteId, ...makeOrderPayload() },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { order_id: string }).order_id).toMatch(/^[0-9a-f-]{36}$/);
    await app.close();
    db.close();
  });

  it('returns 404 for unknown quote_id', async () => {
    const { app, db } = await buildTestApp();
    const res = await app.inject({
      method: 'POST', url: '/book_order',
      payload: { quote_id: 'nope', ...makeOrderPayload() },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'quote_not_found' });
    await app.close();
    db.close();
  });

  it('returns 410 on expired quote', async () => {
    const { app, clock, quoteId, db } = await seedAndQuote();
    clock.advanceMs(6 * 60 * 1000);
    const res = await app.inject({
      method: 'POST', url: '/book_order',
      payload: { quote_id: quoteId, ...makeOrderPayload() },
    });
    expect(res.statusCode).toBe(410);
    expect(res.json()).toEqual({ error: 'quote_expired' });
    await app.close();
    db.close();
  });

  it('returns 409 when window was filled after the quote was issued', async () => {
    const { app, orders, quoteId, db } = await seedAndQuote();
    orders.insert(makeOrder({ id: 'o-fill', window_id: 'w1', weight: 995 }));
    const res = await app.inject({
      method: 'POST', url: '/book_order',
      payload: { quote_id: quoteId, ...makeOrderPayload() },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'capacity_exceeded' });
    await app.close();
    db.close();
  });
});
```

- [ ] **Step 6: Run all HTTP tests**

Run: `npx jest test/http`
Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/http test/helpers/buildTestApp.ts test/http
git commit -m "feat(http): getQuotes + bookOrder routes with integration tests"
```

---

## Task 12: Seed, Server Entry Point, and Build Path

**Files:**
- Create: `src/seed.ts`
- Modify: `src/server.ts` (replace placeholder)
- Modify: `package.json` (add postbuild copy step)

- [ ] **Step 1: Create `src/seed.ts`**

```ts
import type { TeamsRepo } from './db/teamsRepo';
import type { WindowsRepo } from './db/windowsRepo';
import type { Team } from './types';

const SEED_TEAMS: Team[] = [
  { id: 'team-tlv-north',   name: 'Tel Aviv North',   lng: 34.7818, lat: 32.0853 },
  { id: 'team-tlv-south',   name: 'Tel Aviv South',   lng: 34.7700, lat: 32.0500 },
  { id: 'team-ramat-gan',   name: 'Ramat Gan',        lng: 34.8236, lat: 32.0684 },
  { id: 'team-jerusalem',   name: 'Jerusalem Central', lng: 35.2137, lat: 31.7683 },
];

// Generates 1-hour slots from 09:00 to 18:00 on a given date, per team.
function generateWindowsForDate(date: string, teams: Team[]): Array<{
  id: string; team_id: string; start_time: string; end_time: string;
}> {
  const out: Array<{ id: string; team_id: string; start_time: string; end_time: string }> = [];
  for (const t of teams) {
    for (let hour = 9; hour < 18; hour++) {
      const hh = hour.toString().padStart(2, '0');
      const next = (hour + 1).toString().padStart(2, '0');
      out.push({
        id: `win-${t.id}-${date}-${hh}`,
        team_id: t.id,
        start_time: `${date} ${hh}:00:00`,
        end_time: `${date} ${next}:00:00`,
      });
    }
  }
  return out;
}

export function seed(teams: TeamsRepo, windows: WindowsRepo): void {
  for (const t of SEED_TEAMS) teams.insert(t);
  // Seed the next 7 days of windows from a fixed reference date.
  // Reference date is intentionally static so demos are reproducible.
  const base = new Date('2026-04-15T00:00:00Z');
  for (let d = 0; d < 7; d++) {
    const day = new Date(base.getTime() + d * 24 * 60 * 60 * 1000);
    const iso = day.toISOString().slice(0, 10); // "YYYY-MM-DD"
    for (const w of generateWindowsForDate(iso, SEED_TEAMS)) {
      windows.insert(w);
    }
  }
}
```

- [ ] **Step 2: Replace `src/server.ts`**

Overwrite `src/server.ts`:
```ts
import Fastify from 'fastify';
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
  app.setErrorHandler((err, _req, reply) => {
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
```

- [ ] **Step 3: Add a postbuild copy step for schema.sql**

The production build emits JS to `dist/`, so `connection.ts` needs `schema.sql` next to the compiled file. Update `package.json` scripts:
```json
"scripts": {
  "build": "tsc && cp src/db/schema.sql dist/db/schema.sql",
  "start": "node dist/server.js",
  "dev": "ts-node src/server.ts",
  "test": "jest",
  "test:watch": "jest --watch"
}
```

- [ ] **Step 4: Full typecheck and test run**

Run: `npx tsc --noEmit && npx jest`
Expected: zero type errors. All tests pass across domain, db, services, http.

- [ ] **Step 5: Smoke-test the server manually**

Run (in one terminal):
```bash
npx ts-node src/server.ts
```
Expected: Fastify logs a line like `Server listening at http://0.0.0.0:3000`.

Run (in another terminal):
```bash
curl -s -X POST http://localhost:3000/get_quotes \
  -H 'content-type: application/json' \
  -d '{"lng":34.78,"lat":32.08,"min_time":"2026-04-15 09:00:00","max_time":"2026-04-15 13:00:00","weight":120}' | head -c 500
```
Expected: JSON containing a non-empty `quotes` array with UUIDs.

Then pick one `quote_id` from the output and book it:
```bash
curl -s -X POST http://localhost:3000/book_order \
  -H 'content-type: application/json' \
  -d '{"quote_id":"<paste-uuid-here>","lng":34.78,"lat":32.08,"min_time":"2026-04-15 09:00:00","max_time":"2026-04-15 13:00:00","weight":120}'
```
Expected: `{"order_id":"<uuid>"}`.

Stop the server with Ctrl-C.

- [ ] **Step 6: Commit**

```bash
git add src/seed.ts src/server.ts package.json
git commit -m "feat: seed data and server entry point"
```

---

## Done Criteria

- `npx jest` reports all tests passing across `test/domain`, `test/db`, `test/services`, `test/http`.
- `npx tsc --noEmit` reports zero errors.
- `npx ts-node src/server.ts` starts the server, `curl /get_quotes` returns quotes, `curl /book_order` with a returned `quote_id` returns an `order_id`.
- `git log` shows one commit per task (12 commits), each self-contained and passing tests.
