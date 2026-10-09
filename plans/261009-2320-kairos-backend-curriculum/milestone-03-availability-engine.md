# M3 — The Availability Engine

**~20h · Weeks 4–5 · Question: when is this person actually free?**

The hardest *pure logic* in the project, and the part most likely to make you underestimate it. "Show
available slots" sounds like an afternoon. It is two weeks, because the real question is: given
recurring weekly rules in one timezone, date-specific exceptions, service durations, buffers, lead
times, existing bookings, and daylight saving — what times can a customer in a *different* timezone
actually pick?

Build it as **pure functions with no database access**. That constraint is what makes 200 test cases
cheap, and cheap tests are the only way to get this right.

**Exit condition:** a slot engine that survives DST in both directions, returns slots in the caller's
timezone, and computes a 90-day window in under 200ms.

---

### KAI-030 · SPIKE · 2h — Timezones, properly

No code for the first hour. Read and write up:
- UTC vs local time vs **wall-clock** time — three different things
- IANA zones (`Asia/Saigon`) vs offsets (`+07:00`) — why storing the offset is a bug
- DST: the hour that never happens (spring forward) and the hour that happens twice (fall back)
- `timestamptz` in Postgres — what it actually stores (hint: not a timezone)

Then prove each one in code with `date-fns-tz` or `Luxon`:
```ts
// 2026-03-29 02:30 Europe/London — a time that does not exist
// 2026-11-01 01:30 America/New_York — a time that happens twice
```

**Why this exists.** Every single bug in this milestone traces to one of these. The decisive insight:
**a recurring rule is wall-clock, an event is an instant.** "Every Monday at 9am" is a wall-clock
statement — it must stay 9am local through DST. A specific booking is an instant on the timeline. Store
the first as `(TIME, weekday, IANA zone)`; store the second as `timestamptz`. Confusing them is the bug
in KAI-034, and you'll write that bug on purpose.

Also: `timestamptz` does **not** store a timezone. It stores a UTC instant and converts on
input/output. The name is a lie that has misled a generation of developers.

**Done when:**
- [ ] `docs/notes/timezones.md` explains all of the above in your own words
- [ ] You've printed a nonexistent time and an ambiguous time and seen what your library does with each
- [ ] You can answer: why is `+07:00` not a timezone? (offsets don't carry DST rules — Vietnam doesn't
      observe DST, but your users won't all be in Vietnam)
- [ ] You know what Postgres `timestamptz` physically stores
- [ ] **Decision recorded:** `Luxon` or `date-fns-tz`, with a reason. Not `moment` — deprecated.

**The trap:** "I'll just store everything in UTC and convert at the edges." Correct for *instants*,
catastrophically wrong for *recurring rules*. 9am Monday local is not a fixed UTC time year-round.

---

### KAI-031 · FEAT · 2h — Recurring availability rules

Model and expose CRUD for `availability_rules`:
```
provider_id, weekday (0–6), start_time TIME, end_time TIME, timezone TEXT (IANA)
```
Note `TIME`, not `timestamptz` — wall-clock, per KAI-030.

**Why this exists.** The schema is the lesson. Storing `start_time` as a `TIME` plus an IANA zone name
is what lets "Mondays 9–5" survive a DST shift. Validate the timezone string against the IANA database
at write time — a typo'd `"Asia/Saigon "` with a trailing space silently breaks slot generation weeks
later, in a way that's miserable to trace.

**Done when:**
- [ ] CRUD works, scoped to the owning provider (ownership from KAI-025 applies)
- [ ] `end_time > start_time` enforced by a `CHECK` constraint
- [ ] Invalid IANA names rejected at the boundary
- [ ] Overlapping rules for the same weekday are rejected (or deliberately merged — decide, document)
- [ ] A rule crossing midnight is either supported or explicitly rejected with a clear error

**The trap:** `storing 09:00` with no timezone and assuming server-local. Your server runs UTC in
production and Asia/Saigon on your laptop. Those are seven hours apart and your tests will pass locally.

---

### KAI-032 · FEAT · 2h — Exceptions and overrides

`availability_exceptions`: date-specific overrides, both **subtractive** (holiday — unavailable despite
the rule) and **additive** (a one-off Saturday). Support partial-day blocks (dentist, 14:00–15:00).

**Why this exists.** Rules alone can't express reality. The design question worth sitting with: do
exceptions *replace* the day's rules or *layer onto* them? Layering composes better and is what real
calendars do, but it means your resolution order must be explicit and documented. Precedence ambiguity
is a bug factory — write the order down before you write the code.

**Done when:**
- [ ] Full-day and partial-day exceptions both work, subtractive and additive
- [ ] Precedence is documented in `docs/notes/availability-model.md` and enforced consistently
- [ ] An exception on a day with no rule still works (additive case)
- [ ] Exceptions are timezone-aware — "2026-12-25" means that date *in the provider's zone*

---

### KAI-033 · FEAT · 4h — The slot generation engine

The centerpiece. A **pure function**:

```ts
generateSlots(input: {
  rules: AvailabilityRule[]
  exceptions: AvailabilityException[]
  existingBookings: TimeRange[]
  service: { durationMin: number; bufferBeforeMin: number; bufferAfterMin: number }
  window: { from: DateTime; to: DateTime }
  constraints: { leadTimeMin: number; maxAdvanceDays: number }
  now: DateTime            // injected, never read from the clock
}): Slot[]
```

Pipeline: expand rules across the window → apply exceptions → subtract bookings *inflated by buffers* →
slice into `duration`-sized candidates → drop anything inside lead time or beyond max advance.

**Why this exists.** Two things make this ticket the backbone of the milestone.

**It takes `now` as a parameter.** A function that reads the clock internally cannot be tested
deterministically — you'd be mocking time, and time mocking is a tar pit. Inject it and "what slots are
available on a Tuesday in March 2027" becomes an ordinary test case.

**It touches no database.** Data comes in as arguments; slots come out. This is what lets you write 200
test cases that run in milliseconds. Hard logic plus a database is hard logic you can only test slowly,
which means hard logic you won't test enough.

Buffers deserve care: a 15-minute buffer means a booking at 10:00–11:00 blocks 09:45–11:15. You
subtract the *inflated* range, not the booking.

**Done when:**
- [ ] Pure — no I/O, no `Date.now()`, no `new Date()` without arguments
- [ ] Buffers inflate existing bookings on both sides
- [ ] Lead time and max advance both enforced
- [ ] Returns slots with both UTC instants and provider-local representation
- [ ] Lives in `src/domain/` and imports nothing from `repositories/`
- [ ] Handles: no rules, rules but no window overlap, fully booked day, exception-only day

**The trap:** generating slots by looping over minutes. It works and it's 60× slower than it needs to
be. Work with intervals: subtract ranges from ranges, then slice.

---

### KAI-034 · BUG · 2h — The DST bug

Find a provider rule of Mon–Fri 09:00–17:00 in a DST-observing zone (`Europe/London`,
`America/New_York`). Generate slots across the March and November transitions.

Depending on your KAI-033 implementation, you'll see one of: slots at 08:00 or 10:00 instead of 09:00;
a missing hour; a duplicated hour; or an off-by-one that only appears on two days a year.

**If your implementation is already correct, you still owe this ticket a test** — write the cases,
watch them pass, and then deliberately break the engine (convert to UTC once, reuse that offset across
the window) to see the failure mode you avoided.

**Why this exists.** This is the bug that teaches why KAI-030's wall-clock/instant distinction matters,
and it's the one class of bug that *cannot* be found by testing with today's date. Two days a year,
quietly wrong. The root cause is almost always: computing the UTC offset once and applying it to the
whole window. The offset must be resolved **per occurrence**, in the rule's own timezone.

**Done when:**
- [ ] Test cases pinned to real DST transition dates, in both directions, in at least two zones
- [ ] 9am local stays 9am local across both transitions
- [ ] The ambiguous hour (fall back) is handled deliberately, documented
- [ ] The nonexistent hour (spring forward) doesn't produce a bookable slot
- [ ] `docs/notes/dst-bug.md` describes the failure and the root cause
- [ ] A southern-hemisphere zone (`Australia/Sydney`) is in the suite — DST runs the other way there

**The trap:** testing only with Asia/Saigon. Vietnam has no DST, so your entire suite passes and the bug
ships to every international user.

---

### KAI-035 · FEAT · 2.5h — `tstzrange` and the bookings table

Create `bookings` with `time_range tstzrange` as the canonical representation of "when", rather than
separate `start_at`/`end_at`. Enable `btree_gist`. Write the range-overlap query that feeds
`existingBookings` into KAI-033.

Prisma's schema language does not model `tstzrange` — so this migration contains **hand-written SQL
inside a Prisma migration file**, and the field is read via `$queryRaw`. Map it to a domain `TimeRange`
inside the repository so nothing upstream knows.

**Why this exists.** Range types are the Postgres feature that makes M4 possible. The `&&` overlap
operator plus a GiST index turns "does this booking collide with any other?" into one indexed
expression — and in KAI-043 it becomes a **constraint**, which is correctness the application cannot
bypass.

This is also your first real encounter with Prisma's ceiling, two tickets after adopting it. The lesson
is calibration: an ORM that covers 90% of your queries is excellent, and the remaining 10% is why
`$queryRaw` exists. Reaching for raw SQL here is not a defeat; refusing to is.

**Done when:**
- [ ] `btree_gist` extension enabled via migration (not by hand in `psql`)
- [ ] `time_range tstzrange NOT NULL`, inclusive-exclusive bounds `[)` — and you know why `[)` avoids
      the "10:00–11:00 and 11:00–12:00 overlap" false positive
- [ ] GiST index on `time_range`
- [ ] Overlap query uses `&&` and is served by the index (prove with `EXPLAIN ANALYZE`)
- [ ] Raw SQL confined to the repository; services see a plain `TimeRange`
- [ ] `docs/notes/prisma-limits.md` started: what Prisma couldn't express, and how you handled it

---

### KAI-036 · TEST · 2.5h — Exhaustive slot engine tests

Table-driven tests. Aim for 40+ cases. Minimum coverage:

| Category | Cases |
|---|---|
| Basic | empty rules · one rule · multiple rules per day · back-to-back days |
| Boundaries | slot exactly at window edge · booking at a rule boundary · zero-length gap |
| Buffers | before only · after only · both · buffer exceeding the gap between bookings |
| Exceptions | full-day block · partial block · additive · exception with no underlying rule |
| Time | DST forward · DST back · southern hemisphere · leap day · year boundary |
| Constraints | lead time excludes imminent slots · max advance truncates the window |
| Adversarial | rule ending exactly as another begins · booking spanning midnight · 1-minute service |

**Why this exists.** Pure functions are cheap to test exhaustively, so there's no excuse not to. More
practically: KAI-037 is about to optimize this engine, and a thorough suite is the only thing that lets
you change the algorithm aggressively without breaking correctness. **Tests are what make optimization
safe.**

**Done when:**
- [ ] 40+ cases, table-driven rather than copy-pasted
- [ ] Suite runs in under 2 seconds
- [ ] Each case names the behaviour it pins, not "test 17"
- [ ] You found at least one real bug writing these (you will)
- [ ] Coverage on `domain/availability` above 95%

---

### KAI-037 · PERF · 2h — Make a 90-day window fast

Measure first. Generate slots for 90 days with 5 rules, 20 exceptions, 200 bookings. Record the time.
Then optimize to meet FR-3.5 (<200ms), measuring after each change.

Likely wins: stop re-resolving timezone offsets per slot (resolve once per day); sort bookings and use
a merge-style sweep instead of scanning all bookings per candidate; avoid allocating a `DateTime`
object per minute.

**Why this exists.** The discipline is **measure → change → measure**, and this is where you build it.
Optimizing without a baseline isn't engineering, it's superstition. The specific lesson available here:
the naive version is usually O(slots × bookings), and sorting once to make it O(slots + bookings)
typically yields a 10–50× win. Algorithmic improvements dwarf micro-optimizations, and you'll see that
with your own numbers rather than taking it on faith.

**Done when:**
- [ ] Baseline recorded in `docs/notes/slot-performance.md` before any change
- [ ] p95 under 200ms for the 90-day scenario
- [ ] Every KAI-036 test still passes — unchanged
- [ ] Each optimization logged with before/after numbers
- [ ] You profiled rather than guessed (`node --cpu-prof`, or `console.time` on stages)

**The trap:** optimizing the part that *feels* slow. Profile. It's almost never where you think.

---

### KAI-038 · FEAT · 1h — The availability endpoint

`GET /providers/:id/availability?serviceId=…&from=…&to=…&timezone=…`

Loads rules, exceptions, and bookings; calls the pure engine; returns slots with both the UTC instant
and the time rendered in the **caller's** timezone.

**Why this exists.** The thin-wrapper shape is the payoff for KAI-033's purity — the endpoint is maybe
20 lines because all the difficulty lives in a tested function. Returning both representations means
clients never have to do timezone math, which is a kindness, since they'd get it wrong.

**Done when:**
- [ ] Returns `{ startUtc, endUtc, startLocal, endLocal, timezone }` per slot
- [ ] Caller timezone comes from the query param, falling back to the user's stored preference
- [ ] Window is capped (reject `to - from > maxAdvanceDays`) — an unbounded range is a cheap DoS
- [ ] Response is deterministic for identical input (sets up caching in M7)
- [ ] Integration test asserts the same instant renders differently for `Asia/Saigon` vs `Europe/London`

---

## Closing M3

- [ ] Slot engine is pure, fast, and exhaustively tested
- [ ] DST handled in both directions, both hemispheres
- [ ] `tstzrange` in place, GiST-indexed, ready for M4
- [ ] You can explain the wall-clock/instant distinction to someone else and have them get it

**Log it in `plan.md`.** You've just built the piece most candidates can't. Next: break it on purpose.
