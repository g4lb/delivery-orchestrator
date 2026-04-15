# Delivery Orchestrator — Design Spec

**Date:** 2026-04-15
**Status:** Approved for implementation planning

## Purpose

A Node.js + TypeScript microservice that manages delivery logistics for a B2B platform. It exposes two HTTP endpoints:

- `GET /get_quotes` — given an order payload, return every delivery window that could fulfill it, each tagged with a unique `quote_id`.
- `POST /book_order` — given a `quote_id` and the original order payload, atomically create an order against the referenced window if it is still available.

The service is a single process backed by an in-memory SQLite database. State does not survive restart; teams and delivery windows are populated by a seed script at boot.

## Scope (what this service does *not* do)

- No authentication, no multi-tenant authorization, no rate limiting.
- No persistence across restarts.
- No admin endpoints. Teams and windows exist only because the seed script inserted them.
- No cancellation, refund, or order modification. Orders are insert-only.
- No background jobs. Quote TTL is enforced lazily at read time, not by a sweeper.
- No geo filtering at the window level — geo is a team property only.

## Decisions

These were settled during brainstorming. Each is load-bearing; changing any of them changes the rest of the design.

| # | Topic | Decision |
|---|---|---|
| 1 | Weight capacity | Hard-coded global constant `MAX_WINDOW_WEIGHT_KG`. Every window has the same capacity. |
| 2 | Quote model | Persisted rows in a `quotes` table, each with a TTL. `GET /get_quotes` inserts rows; `POST /book_order` validates by row lookup. Not a weight reservation — availability is re-checked at book time. |
| 3 | Geo on order | `lng`/`lat` are stored on the booked order for audit, but do not influence window selection directly. They are only used to pick eligible teams. |
| 4 | Team eligibility | A team is eligible iff `haversine(order, team) <= SERVICE_RADIUS_KM` (global constant). Multiple teams may be eligible for one order. |
| 5 | Time matching | A window matches iff `window.start_time >= order.min_time AND window.start_time < order.max_time`. Half-open on the right. The window's `end_time` is not compared against `order.max_time` — what matters is when delivery starts. |
| 6 | Window granularity | Fixed 1-hour slots. `start_time` is always on the hour; `end_time = start_time + 1h` is invariant. `end_time` is stored for query ease, not because it varies. |
| 7 | Availability | Derived from `SUM(orders.weight)` per window. Not materialized on the window row. The check-then-insert at book time runs inside `BEGIN IMMEDIATE` so concurrent bookings serialize. |
| 8 | Data entry | Seed-only. The only public HTTP surface is the two endpoints above. |
| 9 | Quote TTL | Hard-coded 5 minutes. Tests use an injected `FakeClock` rather than a configurable TTL. |
| 10 | Timezone | None. All timestamps are naive strings (`YYYY-MM-DD HH:MM:SS`). Comparisons are lexicographic. |
| 11 | Stack | Node.js, TypeScript, Fastify (HTTP), better-sqlite3 (DB), Jest (tests). |
| 12 | Architecture | Layered: `http/` → `services/` → `domain/` + `db/`. Domain layer is pure, DB layer is isolated, services are the glue. |

## Data Model

In-memory SQLite (`:memory:`), schema applied at boot from a single `schema.sql` file. Four tables.

```sql
CREATE TABLE teams (
  id        TEXT PRIMARY KEY,
  name      TEXT NOT NULL,
  lng       REAL NOT NULL,
  lat       REAL NOT NULL
);

CREATE TABLE delivery_windows (
  id         TEXT PRIMARY KEY,
  team_id    TEXT NOT NULL REFERENCES teams(id),
  start_time TEXT NOT NULL,   -- 'YYYY-MM-DD HH:00:00', naive
  end_time   TEXT NOT NULL    -- always start_time + 1h
);
CREATE INDEX idx_windows_start ON delivery_windows(start_time);

CREATE TABLE quotes (
  id         TEXT PRIMARY KEY,   -- UUIDv4, globally unique
  window_id  TEXT NOT NULL REFERENCES delivery_windows(id),
  -- Snapshot of the order payload that produced this quote.
  -- Source of truth for book_order; submitted payload is compared against this.
  lng        REAL NOT NULL,
  lat        REAL NOT NULL,
  min_time   TEXT NOT NULL,
  max_time   TEXT NOT NULL,
  weight     REAL NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL    -- created_at + 5min, denormalized for query clarity
);
CREATE INDEX idx_quotes_window ON quotes(window_id);

CREATE TABLE orders (
  id         TEXT PRIMARY KEY,   -- UUIDv4
  window_id  TEXT NOT NULL REFERENCES delivery_windows(id),
  lng        REAL NOT NULL,
  lat        REAL NOT NULL,
  weight     REAL NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_orders_window ON orders(window_id);
```

### Schema notes

- **Quotes are never deleted.** Expiry is enforced by filtering `expires_at > now` at lookup time. No sweeper.
- **Orders have no `status` column.** Availability is `SUM(orders.weight)` — every row counts. A `status` column would only earn its keep if cancellation were in scope, which it is not.
- **The quote stores a full snapshot of the order payload.** `POST /book_order` uses the snapshot as the source of truth and rejects the request if the submitted payload does not match every field. This prevents a client from re-submitting a heavier weight than the quote was issued for.

## Module Layout

Dependencies flow downward only. Nothing in `domain/` imports from `db/` or `http/`.

```
src/
  server.ts                   entry point; builds clock, db, services, Fastify
  config.ts                   MAX_WINDOW_WEIGHT_KG, SERVICE_RADIUS_KM,
                              QUOTE_TTL_MS, SLOT_DURATION_MS
  clock.ts                    Clock interface + SystemClock + FakeClock
  types.ts                    shared TS types: Team, DeliveryWindow, OrderPayload, Quote, Order
  seed.ts                     inserts teams and generates 1h windows at boot

  http/
    routes/
      getQuotes.ts            POST/GET handler, schema validation, service call, status mapping
      bookOrder.ts            POST handler, schema validation, service call, status mapping

  services/
    quotingService.ts         orchestrates: eligibleTeams → eligibleWindows →
                              capacity filter → insert quote rows → return
    bookingService.ts         transactional: BEGIN IMMEDIATE, load quote, check expiry,
                              verify snapshot, re-check capacity, insert order, COMMIT

  domain/
    geo.ts                    haversineKm(a, b): pure
    time.ts                   windowMatchesOrder(window, order): pure
    availability.ts           fits(order, usedWeight, capacity): pure

  db/
    connection.ts             openDb(): Database — opens :memory:, runs schema.sql
    schema.sql
    teamsRepo.ts              listAll()
    windowsRepo.ts            findStartingInRange(min, max, teamIds), findById(id)
    quotesRepo.ts             insertMany(rows), findById(id)
    ordersRepo.ts             sumWeightByWindowIds([ids]), sumWeightByWindow(id), insert(order)
```

### Layering rules

- **`domain/` is pure.** Every function takes plain data in and returns plain data out. No DB, no HTTP, no `Date.now()`, no throwing. These functions are unit-tested with no harness.
- **`db/` is isolated.** Every SQL query lives here. Callers receive plain objects, not `better-sqlite3` statements or rows.
- **`services/` is the glue.** Fetches data via repos, calls domain functions to make decisions, writes results back via repos. Returns discriminated unions (`{ ok: true, … } | { ok: false, reason: '…' }`) — never throws for business failures.
- **`http/routes/` is a dumb mapper.** Parses the request (Fastify schema), calls a service, maps `reason` → HTTP status. No business logic.
- **`clock.ts` is injected everywhere that needs `now()`.** No file in `services/`, `domain/`, or `db/` calls `new Date()` or `Date.now()` directly.

## Data Flow

### `GET /get_quotes`

Request body:
```json
{
  "lng": 34.78, "lat": 32.08,
  "min_time": "2026-04-15 09:00:00",
  "max_time": "2026-04-15 13:00:00",
  "weight": 120
}
```

Body on GET is acceptable for this microservice. If a downstream client proves unable to send bodies on GET, the route can become POST with no logic change.

Steps inside `quotingService.getQuotes(order, now)`:

1. Validate payload via Fastify JSON schema (caller returns 400 on failure; this step does not run).
2. `teamsRepo.listAll()` — returns every team.
3. Filter teams in memory by `haversineKm(order, team) <= SERVICE_RADIUS_KM`. Produces `eligibleTeamIds: string[]`.
4. If `eligibleTeamIds` is empty, return `[]` immediately. (Skip DB round-trips.)
5. `windowsRepo.findStartingInRange(order.min_time, order.max_time, eligibleTeamIds)` — SQL: `WHERE team_id IN (…) AND start_time >= ? AND start_time < ?`.
6. `ordersRepo.sumWeightByWindowIds(windowIds)` — one query, returns `Map<window_id, number>`.
7. For each candidate window, call `fits(order.weight, usedWeight.get(window.id) ?? 0, MAX_WINDOW_WEIGHT_KG)`. Keep only windows that fit.
8. Build a `quotes` row for each surviving window (fresh UUIDv4, order snapshot, `created_at = now`, `expires_at = now + QUOTE_TTL_MS`). Insert them in a single transaction via `quotesRepo.insertMany`.
9. Return `{ quotes: [{ quote_id, window_id, team_id, start_time, end_time, expires_at }, …] }`. Empty array is a valid 200.

### `POST /book_order`

Request body:
```json
{
  "quote_id": "a1b2…",
  "lng": 34.78, "lat": 32.08,
  "min_time": "2026-04-15 09:00:00",
  "max_time": "2026-04-15 13:00:00",
  "weight": 120
}
```

Steps inside `bookingService.book(quoteId, submittedOrder, now)`. Everything from step 2 onward runs inside `db.transaction(() => { … })()` (`BEGIN IMMEDIATE`).

1. Validate payload via Fastify JSON schema.
2. `quotesRepo.findById(quoteId)` → if missing, return `{ ok: false, reason: 'quote_not_found' }`.
3. Compare `submittedOrder` to the stored snapshot across all 5 fields (`lng`, `lat`, `min_time`, `max_time`, `weight`). Any mismatch → `{ ok: false, reason: 'payload_mismatch' }`.
4. Expiry check: if `now > quote.expires_at` → `{ ok: false, reason: 'quote_expired' }`.
5. Re-check capacity: `sum = ordersRepo.sumWeightByWindow(quote.window_id)`. If `sum + quote.weight > MAX_WINDOW_WEIGHT_KG` → `{ ok: false, reason: 'capacity_exceeded' }`.
6. `ordersRepo.insert({ id: uuid(), window_id: quote.window_id, …snapshot, created_at: now })`.
7. Commit.
8. Return `{ ok: true, order_id }`.

### Concurrency guarantees

- `BEGIN IMMEDIATE` acquires a write lock at step 2 and holds it through commit. No other transaction can write to `orders` during this window.
- Two clients holding valid quotes for the last 100 kg of the same window: both `POST /book_order` concurrently. SQLite serializes them. The first commits; the second's `SUM` now includes the first order and returns 409. Deterministic, no retries, no deadlocks.

### Quote reuse semantics (deliberate)

The quote row is **not** marked as consumed on successful booking. A second `POST /book_order` with the same `quote_id` re-runs the capacity check and may succeed again if the window still has room. The invariant "total booked ≤ capacity" is protected by the capacity re-check, not by a `quote.booked_at` flag. One-quote-one-booking is a different invariant and is explicitly out of scope.

## Error Handling

### HTTP error table

| Endpoint | Code | Condition | Body |
|---|---|---|---|
| `GET /get_quotes` | 400 | Schema validation fails | `{ error: "invalid_payload", details: [...] }` |
| `GET /get_quotes` | 200 | Success (including empty result) | `{ quotes: [] }` or `{ quotes: [...] }` |
| `POST /book_order` | 400 | Schema validation fails | `{ error: "invalid_payload", details: [...] }` |
| `POST /book_order` | 400 | Submitted payload does not match stored snapshot | `{ error: "payload_mismatch" }` |
| `POST /book_order` | 404 | `quote_id` not in `quotes` table | `{ error: "quote_not_found" }` |
| `POST /book_order` | 410 | Quote exists but is expired | `{ error: "quote_expired" }` |
| `POST /book_order` | 409 | Capacity re-check fails at book time | `{ error: "capacity_exceeded" }` |
| `POST /book_order` | 200 | Success | `{ order_id: "…" }` |
| either | 500 | Unexpected error (SQL error, bug) | `{ error: "internal_error" }` — stack logged, not leaked |

### Validation rules (Fastify JSON schema)

- `lng` ∈ [-180, 180], `lat` ∈ [-90, 90].
- `weight` > 0 and ≤ `MAX_WINDOW_WEIGHT_KG`. An order heavier than a whole window is rejected at the door.
- `min_time`, `max_time` match `^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$` and `min_time < max_time` lexicographically (valid because timestamps are naive and in the same clock).
- `quote_id` is a non-empty string.

### Principles

- **Domain functions do not throw.** Their return values are their error channel.
- **Services return discriminated unions**, never throw for business failures. Routes map `reason` → status code in one place per endpoint.
- **400 `invalid_payload` vs 400 `payload_mismatch`** — same status code, different `error` string. Clients can branch on the string without parsing `details`.
- **500 responses never leak internal details.** Fastify's error handler is overridden to emit `{ error: "internal_error" }` and log the real stack to stderr.

## Testing Strategy

Three tiers, Jest across all of them.

### Tier 1 — Pure domain unit tests

No DB, no HTTP, no mocks. Every function in `domain/` is tested by direct call.

- `geo.test.ts` — haversine: zero distance; known city pairs within 1%; antipodal; negative longitudes.
- `time.test.ts` — `windowMatchesOrder`: window starts exactly at `min_time` (match); starts exactly at `max_time` (no match, half-open); before `min_time`; at `max_time - 1s`; far outside the range.
- `availability.test.ts` — `fits`: empty window; partially full; exact fit; one kg over; order heavier than capacity.

Target: ~20–30 assertions, <100 ms total runtime.

### Tier 2 — Service tests against real in-memory SQLite

Each test builds a fresh `:memory:` DB, runs `schema.sql`, inserts fixtures directly, calls the service, and asserts on return values and DB state. No Fastify. No repo mocking — bugs live at the SQL boundary and mocking the repo hides them.

`quotingService.test.ts` cases:
- Returns empty array when no teams are in radius.
- Returns empty array when teams are in radius but no windows match the time range.
- Returns empty array when windows match time but capacity is full.
- Returns multiple windows across multiple eligible teams.
- Creates one quote row per returned window, each with a distinct `quote_id`.
- Uses injected `FakeClock` so `created_at`/`expires_at` are deterministic.

`bookingService.test.ts` cases:
- Happy path: valid quote → order inserted, returns `order_id`.
- Unknown quote → `quote_not_found`.
- Expired quote (FakeClock advanced past `expires_at`) → `quote_expired`.
- Payload mismatch (one test per differing field) → `payload_mismatch`.
- Capacity race: pre-fill the window to capacity-1kg, try to book a 10 kg order → `capacity_exceeded`.
- Double-book same quote: two sequential `book()` calls with the same `quote_id` against a window with ample space → both succeed, two distinct orders, `SUM(weight)` reflects both. (Documents the decision that quotes are reusable.)

### Tier 3 — HTTP integration tests

Fastify's built-in `app.inject()` — no real TCP port, no supertest. About 6 tests total, one per main code path.

- `GET /get_quotes` 200 with a plausible body on a seeded fixture.
- `GET /get_quotes` 400 on a missing field.
- `POST /book_order` 200 + `order_id` after a quote flow.
- `POST /book_order` 404 on unknown `quote_id`.
- `POST /book_order` 410 on an expired quote.
- `POST /book_order` 409 after pre-filling the window.

### Test infrastructure

- `test/helpers/buildTestApp.ts` — constructs a Fastify app with a fresh in-memory DB and an injectable `FakeClock`. Returns `{ app, db, clock }`.
- `test/helpers/fixtures.ts` — `makeTeam(overrides)`, `makeWindow(overrides)`, `makeOrder(overrides)`.
- **No global state, no shared DB across tests.** Each test owns its own DB instance. With `:memory:` the cost is negligible and test-order bugs become impossible.
- **Test seed ≠ production seed.** `src/seed.ts` is a fixed committed dataset for boot; `test/helpers/fixtures.ts` is purpose-built per test. They do not share code.

### Principles

- **TDD for the domain layer; test-after is acceptable for routes.** Domain functions are tiny and pure — writing the test first costs nothing and catches off-by-one errors immediately. Routes are thin mappers; TDD earns less there.
- **`FakeClock` everywhere, `SystemClock` nowhere in tests.** Any test that reads wall-clock time is flaky by definition. `buildTestApp` defaults to a `FakeClock` fixed at a known instant.
- **No test touches the real network.** Nothing opens a TCP port in the suite.

## Open Questions

None at spec-writing time. All blocking decisions were resolved during brainstorming.

## Out of Scope (explicit)

- Cancellation, refund, order modification.
- Admin / CRUD endpoints for teams and windows.
- Authentication and authorization.
- Persistence across restarts.
- Rate limiting.
- Geo filtering at the window level (only at the team level).
- Partial fills or order splitting.
- Quote-reservation semantics (quotes do not hold capacity).
- Sweeper / background jobs (quote TTL is enforced lazily).
- Service radius as a per-team column (it is a global constant).
- Configurable TTL (it is a hard-coded 5 minutes; tests use FakeClock instead).
