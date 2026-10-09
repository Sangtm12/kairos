# M7 — Performance

**~10h · Week 10 · Question: why is it slow, and how do I prove I fixed it?**

One rule governs this milestone: **measure first.** Every ticket requires a recorded baseline before
any change and a recorded number after. Optimization without measurement is guessing with extra steps,
and the most common outcome is a more complex codebase that is exactly as slow.

**Exit condition:** every number in FR-7 met, every improvement backed by before/after figures you
produced.

---

### KAI-070 · FEAT · 1.5h — Cursor pagination

Replace offset pagination on all collection endpoints with cursor-based paging. Cursor encodes the last
item's sort key plus its ID as a tiebreaker; `WHERE (created_at, id) < ($1, $2) ORDER BY created_at DESC,
id DESC LIMIT $3`.

First, prove the problem: seed 500k rows and compare `OFFSET 10` to `OFFSET 100000`. Record both.

**Why this exists.** `OFFSET n` makes the database **fetch and discard** n rows. Page 1 is instant, page
10,000 scans a million rows to return twenty. The cost grows linearly with page depth, so your slowest
queries are the ones nobody looks at — until a crawler walks your entire list endpoint and takes the
database with it.

The second problem is correctness, and it's the one people miss: with offset paging, a row inserted
while a user pages through results **shifts everything down**, so they see an item twice and miss
another. A cursor anchors to a position in the data rather than a count, so inserts don't disturb it.

The ID tiebreaker is essential. Sorting by a non-unique column alone gives you a cursor that can't
resolve ties, and rows at a boundary get skipped or repeated.

**Done when:**
- [ ] Baseline recorded: `OFFSET 10` vs `OFFSET 100000`
- [ ] All collection endpoints use cursors; `OFFSET` appears nowhere
- [ ] Cursors are opaque (base64) — clients must not construct them
- [ ] Page 10,000 is as fast as page 1 — measured
- [ ] An insert mid-pagination causes no duplicate or skip — tested
- [ ] A composite index supports the sort exactly

**The trap:** cursoring on a non-unique column with no tiebreaker. Rows sharing a timestamp fall through
the cracks, rarely, and you'll never reproduce the report.

---

### KAI-071 · PERF · 2h — The N+1 hunt

Build `GET /providers/me/dashboard` naively: upcoming bookings, each with its customer, service, and
payment. Then log the queries (`DEBUG=prisma:query`) and count them.

You'll see 1 + 3N. Fix with Prisma `include`/`select`, then measure again. Then write a test that
**asserts the query count** and fails if it grows.

**Why this exists.** N+1 is the most common performance bug in ORM-backed applications, and Prisma makes
it beautifully easy to create: a loop with an `await` inside is a loop of round trips. It's invisible in
development with ten seed rows and catastrophic in production with ten thousand — the classic shape of a
bug that passes every test you wrote.

Two things make this ticket land. First, you read Prisma's generated SQL back in KAI-018, so you can
see *why* a nested `include` becomes one query (or two) rather than N. Second, the **query-count
assertion** is the real deliverable: a performance characteristic that's enforced rather than
periodically rediscovered. Performance regressions are normally invisible until a user complains; this
makes them fail CI.

**Done when:**
- [ ] Baseline query count recorded
- [ ] Dashboard issues a bounded number of queries regardless of booking count
- [ ] A test asserts the query count and fails on regression
- [ ] You compared Prisma's `include` strategy against a hand-written `$queryRaw` join — and know
      which is faster here and why
- [ ] `docs/notes/n-plus-one.md` has before/after counts and timings

**The trap:** fixing it with `include` everywhere, including on endpoints that don't need the relations.
Over-fetching is the opposite bug, with the same symptom.

---

### KAI-072 · FEAT · 2h — Cache-aside, with the hard parts

Cache provider search results and availability in Redis. Cache-aside: check cache → miss → query →
store with TTL. Then handle the two problems that make caching genuinely difficult:

1. **Stampede.** A popular expired key means N concurrent requests all miss and all hit Postgres
   simultaneously. Fix with a short lock or single-flight.
2. **Invalidation.** A new booking must invalidate that provider's cached availability immediately —
   TTL alone means serving slots that are already taken.

**Why this exists.** Reading from cache is easy; knowing *when it's wrong* is the job. Cache
invalidation is famously hard because it's a distributed consistency problem wearing a performance
costume.

The design decision worth making explicitly: **TTL versus event-based invalidation.** TTL is simple and
self-healing but serves stale data for up to the TTL. Event-based is immediate but requires every write
path to remember — and the one that forgets produces a bug that's nearly impossible to reproduce. Here,
availability needs event-based (stale availability means double-booking attempts and angry users);
search results tolerate a 60-second TTL.

Also decide what happens when Redis is down. **A cache failure must degrade to a slow response, never an
error** — if your API 500s because the cache is unavailable, you've turned an optimization into a
dependency.

**Done when:**
- [ ] Cache-aside implemented with explicit, documented TTLs per key type
- [ ] A new or cancelled booking invalidates that provider's availability immediately
- [ ] Stampede prevented — demonstrate with 100 concurrent requests on a cold key, count DB hits
- [ ] Redis down → slower responses, no errors (test it: stop the container)
- [ ] Cache keys are namespaced and versioned so a deploy can invalidate wholesale
- [ ] Hit rate is measured and logged

**The trap:** caching the user-specific response of an endpoint under a key that ignores the user.
Instant data leak — one customer sees another's bookings.

---

### KAI-073 · BUG · 1h — "I booked a slot that was already taken"

> **Ticket from support.** A customer selected 3pm, clicked book, and got `SLOT_UNAVAILABLE`. They
> swear the UI showed it as free. Refreshing made it disappear.

Reproduce: book a slot, then immediately fetch availability from a different session.

**Why this exists.** The constraint from KAI-043 is doing its job — no double booking occurred. But the
*user experience* is broken, and the cause is the cache you just added. This is the characteristic shape
of a caching bug: **the data is correct, the view is stale**, and the symptom appears far from the
cause.

The deeper lesson is that caching moved your failure mode. Before M7 this endpoint was slow and correct;
now it's fast and sometimes wrong. That trade is often worth making, but it must be a *decision* —
complete with a bounded staleness window you can state out loud — rather than something you discover
from a support ticket.

**Done when:**
- [ ] Reproduced reliably
- [ ] Invalidation fixed so availability is correct within a stated, documented bound
- [ ] A test asserts: book → immediately fetch availability → slot is gone
- [ ] The booking endpoint never trusts the cache for its own check (it reads through)
- [ ] `docs/notes/cache-invalidation.md` records the bug, the fix, and the staleness guarantee you
      now offer

---

### KAI-074 · FEAT · 1.5h — Full-text search

Postgres full-text search over provider name, bio, and service titles. A `tsvector` column kept current
by a trigger, a GIN index, `ts_rank` ordering, combined with structured filters (price range, category,
availability window).

**Why this exists.** `LIKE '%query%'` cannot use a standard index and degrades linearly — fine at 1,000
rows, hopeless at a million. Full-text search also does things `LIKE` fundamentally can't: stemming
("running" matches "run"), stop-word removal, and relevance ranking.

The judgement call worth recording: **Postgres FTS versus Elasticsearch.** For this scale, Postgres is
obviously right — one less system to run, operate, back up, and keep in sync. Knowing *when* that stops
being true (tens of millions of documents, fuzzy matching, faceting, multi-language analysis) is the
mid-level version of the answer. Reaching for Elasticsearch at 10k rows is a common and expensive
mistake.

Keep the `tsvector` current with a **trigger**, not application code. Same reasoning as KAI-043: the
database enforces it for every writer, including the ones you haven't written yet.

**Done when:**
- [ ] `tsvector` column, GIN index, trigger maintaining it on insert and update
- [ ] Results ranked by `ts_rank`, combined with structured filters
- [ ] Baseline vs after timings recorded on 500k rows
- [ ] Empty queries, special characters, and very long input all handled safely
- [ ] `docs/notes/search.md` records when you'd outgrow this

---

### KAI-075 · PERF · 1h — Load test and find the ceiling

Run k6 or autocannon against the booking and availability endpoints. Push until something breaks.
Record throughput, p50/p95/p99, and error rate. Then find the first bottleneck — it will almost
certainly be the Postgres connection pool.

**Why this exists.** You need to know your limits before a user finds them. The specific lesson here is
usually surprising: **more connections is not more throughput.** Postgres handles a modest number of
connections efficiently and degrades past that, because every connection is a process competing for the
same CPUs. The right pool size is typically small (`cores × 2 + effective_spindles` is the classic
starting heuristic), and discovering that your 100-connection pool is slower than 20 is a genuinely
clarifying experience.

Also learn to read percentiles. **p99 is the number that matters**, because at 1,000 requests/second it
describes ten users per second having a bad time. An average hides exactly the tail you care about.

**Done when:**
- [ ] Load test script in `scripts/load-test/`, committed
- [ ] Baseline throughput and p50/p95/p99 recorded for key endpoints
- [ ] You found the breaking point and identified what broke
- [ ] Pool size tuned empirically, with numbers at 3+ settings
- [ ] FR-7 targets met and evidenced
- [ ] `docs/notes/load-test.md` holds the numbers and the bottleneck analysis

**The trap:** load testing against your dev database with 50 seeded rows. Everything is fast when the
whole dataset fits in cache. Test against realistic volume.

---

### KAI-076 · FEAT · 1h — Rate limiting, the version that works

Replace KAI-026's in-memory limiter with a Redis-backed sliding-window (or token bucket)
implementation. Different limits per endpoint class: auth strict, search moderate, authenticated
generous. Return 429 with `Retry-After` and `X-RateLimit-*` headers.

**Why this exists.** Close the loop from KAI-026. Open `docs/notes/rate-limiting.md`, read what you
wrote about why the in-memory version was wrong, and verify each item is now fixed: shared state across
instances, survival across restarts, bounded memory.

The sliding window also fixes the fixed-window boundary burst you identified back then — 5 requests at
14:59:59 plus 5 at 15:00:01 passes a "5 per 15 minutes" fixed window, which is double the intended rate
at the worst possible moment.

Implement it with a Lua script so the read-and-increment is **atomic in Redis**. A `GET` followed by a
`SET` from Node is a race condition, and by now you should feel that instantly — it's KAI-041 wearing
different clothes.

**Done when:**
- [ ] Redis-backed, shared correctly across two running instances — verify
- [ ] Sliding window; the boundary burst is gone — test it specifically
- [ ] Increment is atomic (Lua script or `INCR` with TTL, not read-then-write)
- [ ] `Retry-After` and `X-RateLimit-Limit/Remaining/Reset` headers present
- [ ] Limits differ sensibly by endpoint class
- [ ] Redis down → fail **open** (serve the request) rather than closed. Decide deliberately and
      document — for rate limiting, availability usually beats enforcement.

---

## Closing M7

- [ ] Every FR-7 target met, with numbers
- [ ] A query-count test guards against N+1 regressions
- [ ] Caching correct, invalidated, and degrades gracefully
- [ ] You can explain: why `OFFSET` degrades, cache stampede, why more connections ≠ more throughput,
      and why p99 matters more than the mean
- [ ] Every optimization in `docs/notes/` has before/after figures

**Log it in `plan.md`.**
