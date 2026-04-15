# DESIGN

Short companion to the full spec at [`docs/superpowers/specs/2026-04-15-delivery-orchestrator-design.md`](docs/superpowers/specs/2026-04-15-delivery-orchestrator-design.md).

## 1. Window availability logic

A window is available for an order when **all three** hold:

1. **Team proximity.** Team's location is within a global `SERVICE_RADIUS_KM` (25 km) haversine distance of the order. Geo is per-team, not per-window — teams model branches, windows inherit their team's location.
2. **Time slot fits.** `order.min_time <= window.start_time < order.max_time` (half-open). Windows are fixed 1-hour slots; what matters is *when delivery starts*, not whether the slot ends before the customer's cutoff.
3. **Capacity has room.** `SUM(orders.weight WHERE window_id = ?) + order.weight <= MAX_WINDOW_WEIGHT_KG` (1000 kg). Availability is **derived** from the `orders` table — no materialized `used_weight` column — so there's a single source of truth and no drift bug. No partial fills.

## 2. Quote validation

Quotes are **stored rows** in a `quotes` table with a 5-minute TTL. Not signed tokens, not in-memory, not reservations.

- **Unique by PK.** Each `quote_id` is a UUID primary key.
- **Full payload snapshot.** The quote row stores `lng`/`lat`/`min_time`/`max_time`/`weight`. `POST /book_order` uses the snapshot as the source of truth and returns `payload_mismatch` (400) if the resubmitted payload differs on any field. This prevents quoting a 100 kg order and booking it as 500 kg.
- **Lazy TTL.** No sweeper. At book time, compare `formatIso(clock.now())` to `quote.expires_at` — if past, return `quote_expired` (410). Expired rows stay until the process exits.
- **Not a reservation.** Quotes do not hold capacity. Two clients can legitimately hold quotes for overlapping weight; the race is resolved at book time (§3).
- **Not consumed on booking.** A second `book()` call with the same `quote_id` will re-check capacity and may succeed again. The invariant protected is "total booked ≤ capacity," not "one quote = one order."

## 3. Race conditions

**Scenario:** two clients each hold a valid quote for the last 100 kg of the same window and `POST /book_order` simultaneously.

**Mechanism:** `BookingService.book` wraps the entire quote-lookup + snapshot-check + expiry-check + capacity-check + order-insert sequence in a `better-sqlite3` transaction invoked with `.immediate()`, which issues `BEGIN IMMEDIATE` at the SQLite layer — acquiring the write lock up front.

**Outcome:**
1. Client A enters the transaction, takes the lock.
2. Client B blocks on the lock.
3. Client A re-sums `orders.weight` for the window (900/1000), inserts, commits. Lock released.
4. Client B acquires the lock, re-sums (now 1000/1000), returns `capacity_exceeded` (409).

No retries, no deadlocks, no app-level locking. Correctness comes from SQLite. The test `returns capacity_exceeded when re-check fails` in `test/services/bookingService.test.ts` seeds the window to 995/1000 and asserts the exact code path a real race would take.

## 4. AI workflow reflection

**What worked.** The pipeline (brainstorm → spec → plan → subagent execution → code review) forced me to commit to load-bearing decisions *before* any code was written. The plan contained literal code for every file, so subagents did mechanical copy-test-implement work rather than making design calls. TDD was enforced for the pure domain layer, and a final code review caught three real issues (dead `windows` param on `BookingService`, unused `windowMatchesOrder`, duplicated cross-field validation) that I would have shipped otherwise.

**Where I had to intervene.** The implementation plan I wrote had four latent bugs that subagents caught during execution:
- `tsconfig.rootDir: ./src` with `include: [test/**/*]` triggers TS6059 as soon as a test file exists.
- `delivery_windows.team_id` is a foreign key, so tests that insert a window must first seed a team.
- Fastify 5 rejects body schemas on GET routes at registration time — the plan's multi-method route crashed at boot.
- ts-jest strict typing required an explicit `FastifyError` annotation on `setErrorHandler`.

Each fix was correct, but I had introduced each bug into the plan. Beyond the plan bugs, the user had to prompt me to initialize git (I'd assumed Task 1 would handle it), to clarify that `min_time`/`max_time` were datetimes and there was no timezone handling, and to push for a post-implementation refactor round that extracted constants, split long functions, moved hardcoded strings, and replaced inline error-handling with middleware — all improvements the plan should have baked in from the start.

**Takeaway.** The AI pipeline is excellent at turning a rough idea into passing code *when the human answers clarifying questions carefully and pushes back on the plan*. It is **not** excellent at judging code quality unprompted — every quality improvement in this codebase came from an explicit "review this," "remove comments," or "extract constants," never from the AI's own initiative. The right mental model is a very fast, very literal contractor who will ship working-but-unpolished software unless you ask for polish.
