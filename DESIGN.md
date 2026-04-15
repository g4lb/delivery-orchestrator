# DESIGN

Full spec: [`docs/superpowers/specs/2026-04-15-delivery-orchestrator-design.md`](docs/superpowers/specs/2026-04-15-delivery-orchestrator-design.md).

## 1. Window availability

A window is available when all three hold:

1. **Team in radius** — team's location within 25 km haversine of the order (global `SERVICE_RADIUS_KM`; geo is per-team, windows inherit).
2. **Slot fits** — `order.min_time <= window.start_time < order.max_time` (half-open). Fixed 1-hour slots; what matters is when delivery *starts*.
3. **Capacity has room** — `SUM(orders.weight) + order.weight <= 1000 kg`. Derived from the `orders` table, not materialized. No partial fills.

## 2. Quote validation

Stored rows in a `quotes` table with a 5-minute TTL — not signed tokens, not in-memory, not reservations.

- `quote_id` is a UUID PK (globally unique).
- The row stores a **full snapshot** of the order payload. `POST /book_order` compares every field and returns `payload_mismatch` (400) on any drift — prevents quoting 100 kg and booking 500 kg.
- TTL is enforced lazily at book time via `formatIso(clock.now()) > quote.expires_at` → `quote_expired` (410). No sweeper.
- Quotes do **not** hold capacity and are **not** consumed on success. The capacity invariant is protected at book time (§3), not by one-quote-one-order.

## 3. Race conditions

Two clients holding valid quotes for the last 100 kg and booking simultaneously:

`BookingService.book` wraps lookup + snapshot check + expiry check + capacity re-check + insert in a `better-sqlite3` transaction invoked with `.immediate()` → `BEGIN IMMEDIATE` acquires the write lock up front. Client A commits (900→1000), client B's re-sum now sees 1000/1000 and returns `capacity_exceeded` (409). No retries, no app-level locking — correctness comes from SQLite. Covered by `returns capacity_exceeded when re-check fails` in `test/services/bookingService.test.ts`.

## 4. AI workflow reflection

**What worked.** The brainstorm → spec → plan → subagent execution → code review pipeline forced load-bearing decisions *before* any code was written. The plan contained literal code per file, so subagents did mechanical copy-test-implement work. A final code review caught three real issues I'd have shipped (dead `windows` param on `BookingService`, unused `windowMatchesOrder`, duplicated cross-field validation).

**Where I intervened.** Four latent bugs I introduced into the plan were caught by subagents during execution: (1) `tsconfig.rootDir` conflict with a `test/**/*` include, (2) FK requiring a team row before inserting a window, (3) Fastify 5 refusing body schemas on GET routes at registration, (4) ts-jest demanding an explicit `FastifyError` annotation. Separately, the user had to prompt me to initialize git, clarify that times were full datetimes with no TZ handling, and push for a post-implementation refactor round (extract constants, split long functions, move validation to middleware) — all polish the plan should have baked in.

**Takeaway.** The pipeline is excellent at turning an idea into working code when the human answers clarifying questions carefully and pushes back on the plan. It does **not** judge code quality unprompted — every quality improvement came from an explicit "review this," "remove comments," "extract constants." Treat it as a fast, literal contractor who ships working-but-unpolished software unless asked for polish.
