# DESIGN

A short companion to the full spec in [`docs/superpowers/specs/2026-04-15-delivery-orchestrator-design.md`](docs/superpowers/specs/2026-04-15-delivery-orchestrator-design.md). This document focuses on the four load-bearing decisions and a reflection on the AI-assisted workflow.

## 1. Window availability logic

A delivery window is available for a given order when **all three** of the following hold:

1. **Team proximity** — the window belongs to a team whose location is within a global `SERVICE_RADIUS_KM` (25 km) haversine distance of the order's `(lng, lat)`. Geo is a team attribute, not a window attribute — teams model "branches," so every window inherits location from its team. Multiple branches may be in range at once; all of their windows are considered.

2. **Time slot fits the order range** — the window's `start_time` must satisfy `order.min_time <= start_time < order.max_time` (half-open on the right). This is the "slot booking" interpretation: what matters is *when delivery starts*, not whether the slot ends before the customer's cutoff. Windows are fixed 1-hour slots aligned to the hour, so the assumption "customer is available for the full slot length" is uniform.

3. **Capacity has room** — `SUM(orders.weight WHERE window_id = ?) + order.weight <= MAX_WINDOW_WEIGHT_KG` (1000 kg, global constant). Availability is **derived**, not materialized. There is no `used_weight` column on `delivery_windows` — the single source of truth is the `orders` table, and every booking is re-summed when checked. For a small in-memory SQLite instance this is O(n) on a trivially small n, and it eliminates the "two sources of truth" drift bug.

A window at 800/1000 kg used and a 300 kg order → rejected (no partial fills, no order splitting).

## 2. Quote validation

**Quotes are stored rows in a `quotes` table** with a 5-minute TTL. Not signed tokens, not in-memory, not reservations.

**Why stored rows over signed tokens:**
- Every `quote_id` is globally unique by PK construction.
- `POST /book_order` validates by `SELECT ... WHERE id = ?` — no token verification, no server secret to manage.
- The quote row stores a **full snapshot** of the order payload (`lng`, `lat`, `min_time`, `max_time`, `weight`). `POST /book_order` uses the snapshot as the source of truth and rejects the request with `payload_mismatch` if the resubmitted payload differs on any field. This prevents a client from tampering with weight between quote and book (e.g., quoting a 100 kg order and then trying to book it as 500 kg).

**Why not a reservation:**
- Reserving weight at quote time creates TTL/sweeper/starvation complexity (one browsing client can block another). 
- Quotes here are pure audit — they record "the server told this client this option was available at this instant." The capacity invariant is enforced at **book time**, transactionally.
- Race resolution is handled at commit, not at quote issue (see §3).

**TTL enforcement is lazy.** There is no sweeper or cron. At book time, the service compares `formatIso(clock.now())` to `quote.expires_at` and returns `quote_expired` (HTTP 410) if the quote is past its window. Expired rows stay in the table until the process exits — the in-memory DB dies with it anyway.

## 3. Race conditions

**Scenario:** two clients each hold a valid quote for the last 100 kg of the same window. Both `POST /book_order` simultaneously. The invariant "`SUM(orders.weight) <= capacity`" must hold.

**Mechanism:** `BookingService.book` wraps the entire quote-lookup + snapshot-check + expiry-check + capacity-check + order-insert sequence in a single `better-sqlite3` transaction invoked with `.immediate()`, which translates to `BEGIN IMMEDIATE` at the SQLite layer. `BEGIN IMMEDIATE` acquires the database write lock at the start of the transaction rather than upgrading lazily on first write.

**Outcome:**
- Client A enters the transaction, acquires the write lock.
- Client B tries to enter the transaction, blocks on the write lock.
- Client A re-computes `SUM(orders.weight)` for the window, finds 900/1000 used, inserts the 100 kg order, commits. Lock released.
- Client B acquires the lock, re-computes the sum — now 1000/1000 — and returns `capacity_exceeded` (HTTP 409).

No retries, no deadlocks, no application-level locking. The correctness guarantee comes from SQLite, not from TypeScript code.

**What this specifically does NOT do:**
- It does not "reserve" capacity at quote time, so two clients can both legitimately hold quotes for overlapping weight.
- It does not consume the quote on successful booking. A second `book()` call with the same `quote_id` will run again and may succeed if capacity still permits. The invariant it protects is "total booked ≤ capacity," not "one quote = one order." A test explicitly documents this by booking the same quote twice and asserting both succeed.

A test in `test/services/bookingService.test.ts` ("returns capacity_exceeded when re-check fails") seeds the window to 995/1000 before the quote is booked and asserts the second `.book()` returns `capacity_exceeded` — the same code path a real race would take.

## 4. Reflection on AI-assisted workflow

The project was built end-to-end in a single session using a structured flow — brainstorm → spec → plan → implementation via subagents → code review → refactor — with Claude doing the heavy lifting and me steering. Here's an honest read of where that worked and where it didn't.

### Where AI was genuinely useful

- **Forcing decisions before code.** The brainstorming phase asked one clarifying question at a time (capacity model, quote lifecycle, geo scoping, time-match semantics, TTL duration, etc.). Each question came with 2-3 concrete options, recommended one, and explained the tradeoff. This made me commit to load-bearing decisions *before* any code was written, and the spec captured them so nothing drifted during implementation. The result is that the final design matches the answers I gave to questions I barely remember answering now.
- **Plan-driven implementation.** The implementation plan contained literal code for every file, not pseudocode. When I dispatched 12 subagents to execute 12 tasks, each one was doing mechanical copy-test-implement-commit work rather than making design decisions. That removed an entire class of "subagent went off-script" failures.
- **Review discipline.** A final code-review pass caught three real issues (dead `windows` parameter on `BookingService`, `windowMatchesOrder` existing but never called, duplicated cross-field validation in both routes) that I hadn't noticed. The refactor commit that fixed them was straightforward because the review pointed at file:line.
- **Test-first for domain logic.** Every domain function (`haversineKm`, `windowMatchesOrder`, `fits`) was implemented strictly test-first. The subagent had to actually see the test fail before writing the implementation. Those three functions are the most boring and most correct parts of the codebase.

### Where I had to intervene or the AI got it wrong

- **Plan bugs that subagents caught during execution.** The plan I wrote had real latent bugs that the implementation subagents found:
  - `tsconfig.rootDir: ./src` combined with `include: [test/**/*]` triggers TS6059 as soon as a test file exists. The Task 3 subagent fixed it by removing `test/**/*` from `include` and relying on ts-jest to type-check tests at test time.
  - The `delivery_windows.team_id` foreign key means any test that inserts a window must first insert a team. The Task 10 subagent discovered this when the booking service test crashed on `makeWindow` with no team in the DB.
  - Fastify 5 rejects body schemas on GET routes at registration time. My plan registered a multi-method route with a shared body schema; it threw at boot. The Task 11 subagent split it into POST-with-schema + GET-without, sharing one handler.
  - ts-jest strict typing flagged `err` as `unknown` in `setErrorHandler`. The plan didn't annotate it.
- **Ambiguous prompts I had to re-read.** I asked several questions where the answer was a single word ("Quote stores a full snapshot of the order payload") that I had to pattern-match back to "are you agreeing with that design note or questioning it?" Twice I asked the user to disambiguate between "yes do that" and "only do that part." Both times the answer was "yes do that."
- **Terseness and timezones.** Early in brainstorming I asked about time matching using `09:00`-style shorthand. The user corrected me that these should be full datetimes, and then separately that there was no timezone handling at all. Both corrections required me to restate the question and re-present the options. The spec now explicitly commits to naive `YYYY-MM-DD HH:MM:SS` in a single clock, and lexicographic comparison works because of that commitment.
- **Git wasn't initialized until the user told me to do it.** The plan started with `git init` as its first step, but the user had to prompt "add git" before I actually ran it. I should have either initialized git before writing the plan or made the plan independent of VCS state.
- **Post-implementation refactor round.** After the 12 tasks finished cleanly, the user pushed for substantive quality improvements: extract hardcoded strings to constants, extract JSON schemas to their own files, split long functions, move error handling to middleware, remove explanatory comments. Almost all of this was reasonable and should have been baked into the plan from the start. The plan was optimized for "get working software fast" and not "get well-factored software," and the refactor round was a necessary correction.
- **Comments vs. tests.** The user explicitly asked me to remove comments and verify their invariants are covered by tests. This forced me to audit what the comments were actually documenting — in several cases (half-open time rule, `BEGIN IMMEDIATE` serialization, UTC string format, double-book semantics) the comment was narrating behavior that a test already exercised, so the comment was redundant noise. In one case (the SQL prefilter comment in `quotingService`) the comment was justifying a design choice the code itself didn't encode. The refactor made the code express the invariant directly (by calling `windowMatchesOrder` as a defensive filter after the SQL fetch), and the comment became unnecessary.

### Net takeaway

The AI pipeline is excellent at "turn a rough idea into a spec, turn a spec into a plan, turn a plan into passing code" when the human is willing to answer clarifying questions carefully and push back on bad plans. It is not excellent at "judge code quality without being asked to." Every code-quality improvement in this codebase came from an explicit prompt — "review this," "remove comments," "extract constants" — not from the AI's own initiative. The right mental model is that the AI is a very fast, very literal contractor who does exactly what you ask and will gladly ship working-but-unpolished software if you don't ask for polish.
