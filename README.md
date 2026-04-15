# delivery-orchestrator

B2B delivery-logistics microservice. Exposes two HTTP endpoints for delivery window discovery and order booking, backed by an in-memory SQLite database seeded at boot.

- `POST /get_quotes` — given an order payload, returns every available delivery window with a unique `quote_id`.
- `POST /book_order` — given a `quote_id` + original payload, atomically creates an order if the window still has capacity.

## How it works

- **Window availability** is gated by three conjunctive rules: team proximity (global 25 km haversine radius, per-team location), half-open time-slot match (`window.start_time ∈ [order.min_time, order.max_time)`), and derived capacity check (`SUM(orders.weight) + new <= 1000 kg`). Windows are fixed 1-hour slots.
- **Quotes** are stored rows in a `quotes` table with a 5-minute TTL. Each quote stores a full snapshot of the order payload; `POST /book_order` rejects the request if the resubmitted payload differs from the snapshot on any field. Quotes are not reservations — they do not hold capacity — and are not consumed on successful booking.
- **Race conditions** on the last remaining capacity are resolved transactionally. `BookingService.book` wraps the quote lookup + snapshot check + expiry check + capacity re-check + order insert in a single `BEGIN IMMEDIATE` transaction via `better-sqlite3`'s `.immediate()`, so two concurrent bookings serialize cleanly: the first commits, the second's re-sum returns `capacity_exceeded` (HTTP 409).
- **Architecture** is strictly layered: `http/routes/` → `services/` → pure `domain/` + isolated `db/` repos. Domain functions take plain data in and return plain data out — no DB, no HTTP, no wall clock. The `Clock` interface is the only source of "now" outside `src/clock.ts`, which keeps all TTL-related tests deterministic under a `FakeClock`.

Full details and rationale:
- **[`DESIGN.md`](DESIGN.md)** — business logic, quote validation, race handling, AI-workflow reflection.
- **[`docs/superpowers/specs/2026-04-15-delivery-orchestrator-design.md`](docs/superpowers/specs/2026-04-15-delivery-orchestrator-design.md)** — full design spec with decision table, data model, error handling, and test strategy.

## Requirements

- Node.js 20+
- npm

## Install

```bash
npm install
```

## Run the service

```bash
npm run dev
```

Starts Fastify on `http://0.0.0.0:3000` (override with `PORT=<n>`). The DB is seeded with 4 teams and 7 days of 1-hour windows from `2026-04-15` onwards.

Example request:

```bash
curl -X POST http://localhost:3000/get_quotes \
  -H 'content-type: application/json' \
  -d '{"lng":34.78,"lat":32.08,"min_time":"2026-04-15 09:00:00","max_time":"2026-04-15 13:00:00","weight":120}'
```

Then book one of the returned `quote_id`s:

```bash
curl -X POST http://localhost:3000/book_order \
  -H 'content-type: application/json' \
  -d '{"quote_id":"<uuid>","lng":34.78,"lat":32.08,"min_time":"2026-04-15 09:00:00","max_time":"2026-04-15 13:00:00","weight":120}'
```

## Run the tests

```bash
npm test
```

Runs the full Jest suite (40 tests across domain, service, and HTTP layers) in under a second. The suite is organized in three tiers:

- **Pure domain unit tests** (`test/domain/*`) — `haversineKm`, `windowMatchesOrder`, `fits` called directly, no harness.
- **Service tests** (`test/services/*`) — `QuotingService` and `BookingService` against a real in-memory SQLite DB per test, with a `FakeClock`.
- **HTTP integration tests** (`test/http/*`) — Fastify routes exercised via `app.inject()`, covering the 200/400/404/409/410 paths.

Watch mode:

```bash
npm run test:watch
```

## Build for production

```bash
npm run build
npm start
```
