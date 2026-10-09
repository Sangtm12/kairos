# M4 — Booking & Concurrency

**~13h · Week 6 · Question: what happens when two people click at the same instant?**

The centerpiece of the project. You will ship a booking endpoint that works perfectly in manual
testing, then break it with twenty concurrent requests, then fix it properly — and in doing so learn
the single most important lesson in backend engineering:

> **Application-level checks cannot enforce invariants under concurrency. Only the database can.**

Every developer eventually learns this. Most learn it from a production incident. You get to learn it
on purpose, on a Tuesday, with a reproduction script.

**Exit condition:** 100 concurrent requests for one slot produce exactly one booking — enforced by a
database constraint, not by hope.

---

### KAI-040 · FEAT · 1h — The naive booking endpoint

`POST /bookings`. Write it the obvious way, the way every tutorial does:

```ts
const slots = await getAvailability(providerId, serviceId, requestedRange);
if (!slots.some(s => s.start === requestedStart)) throw new ConflictError('SLOT_UNAVAILABLE');
return bookingRepo.create({ ... });          // check, then act
```

Ship it. Test it by hand. **It will work flawlessly** — that's the point.

**Why this exists.** You need this specific code, working and apparently correct, so that KAI-041 can
destroy it. The gap between "passes every manual test" and "correct under concurrency" is invisible
until you measure it, and that invisibility is exactly why this bug reaches production so often.

The flaw has a name worth knowing: **time-of-check to time-of-use (TOCTOU)**. Between your `if` and
your `INSERT`, the world can change. Right now that window is maybe 20ms — small enough to never hit by
hand, large enough to hit constantly at scale.

**Done when:**
- [ ] Booking succeeds and persists with status `pending_payment`
- [ ] Booking an already-booked slot returns 409 *when tested sequentially*
- [ ] Validates: service belongs to provider, time matches a real slot, customer is authenticated
- [ ] Manual testing shows no problems whatsoever
- [ ] You've written down, before moving on, where exactly you think the race window is

---

### KAI-041 · INCIDENT · 2h — "Two customers were charged for the same 3pm slot"

> **Ticket from support.** Provider Linh reports two different customers showed up for the same 3:00pm
> Thursday lesson. Both have confirmation emails. Both were charged. She had to turn one away.
>
> Our logs show two successful bookings for the same `provider_id` and overlapping `time_range`,
> created 4 milliseconds apart.

**Your job, in order:**
1. **Reproduce it deterministically.** Write a script firing 50 simultaneous requests for one slot.
   (`Promise.all` over 50 `fetch` calls, or `autocannon -a 50 -c 50`.) Count the rows created.
2. **Explain it.** Write the interleaving — request A's check, request B's check, A's insert, B's
   insert — as a timeline, line by line.
3. **Do not fix it yet.** KAI-042 and KAI-044 come first.

**Why this exists.** This is the most valuable two hours in the curriculum. A race condition you have
personally reproduced, with a script you can rerun on demand, is understanding of a different kind than
anything reading provides. You'll also have a permanent regression test: every subsequent fix gets
validated against this script.

Note how hostile this bug is in the wild. It's non-deterministic, it vanishes under a debugger, it
never reproduces locally, and it scales with traffic — so it appears exactly when you're busiest and
least able to investigate. That profile is why "it works on my machine" is not evidence of anything.

**Done when:**
- [ ] `scripts/stress-booking.ts` reliably produces 2+ bookings for one slot
- [ ] You can state how many of 50 requests succeed, and roughly why that number
- [ ] `docs/notes/race-condition.md` contains the interleaving timeline
- [ ] The script is reusable as a verification tool
- [ ] You can define TOCTOU without looking it up

**The trap:** "I'll just add a `SELECT` right before the `INSERT`." That shrinks the window; it does not
close it. There is no number of checks that closes it.

---

### KAI-042 · SPIKE · 2h — Transactions and isolation levels, demonstrated

Two `psql` sessions side by side. Run each scenario manually and record what you observe:

1. **Dirty read** — try it. Postgres won't let you; `READ UNCOMMITTED` is an alias for `READ COMMITTED`.
   Understand why that's a deliberate design choice.
2. **Non-repeatable read** — in `READ COMMITTED`: read a row, have session 2 update and commit, read
   again. Different value, same transaction.
3. **Phantom read** — same shape, with `INSERT` and a range query.
4. **Lost update** — both sessions read a counter, both increment, both write. One update vanishes.
5. **`REPEATABLE READ`** — repeat #2 and #3. Watch them stop happening.
6. **`SERIALIZABLE`** — repeat #4. Watch Postgres abort one transaction with a serialization failure.
7. **`SELECT … FOR UPDATE`** — watch session 2 block until session 1 commits.

**Why this exists.** Isolation levels are abstract until you watch one session block on another in a
terminal. Three things you'll carry forward:

- **Postgres defaults to `READ COMMITTED`**, which permits lost updates. Your framework didn't choose a
  safe default for you.
- **`SERIALIZABLE` doesn't block — it aborts.** Using it means your application *must* catch
  serialization failures and retry. That's a real cost, and it's why it isn't the default.
- **Wrapping code in `BEGIN`/`COMMIT` does not make it atomic in the way you assumed.** A transaction
  guarantees all-or-nothing, not mutual exclusion. KAI-040's bug survives being wrapped in a
  transaction at the default isolation level — verify that yourself, because it's the most common
  misconception in this entire area.

**Done when:**
- [ ] All seven scenarios run by hand, outcomes recorded in `docs/notes/isolation-levels.md`
- [ ] You've confirmed KAI-040's race still happens inside a `READ COMMITTED` transaction
- [ ] You can explain ACID with a concrete example of each letter, not a definition
- [ ] You know what a serialization failure looks like and what the application must do about it

---

### KAI-044 · SPIKE · 1.5h — Four ways to stop a double booking

Prototype each against the KAI-041 stress script. Record correctness, throughput, and failure mode.

| Approach | Mechanism | Think about |
|---|---|---|
| **`SELECT … FOR UPDATE`** | Lock the provider's existing bookings, then insert | What do you lock when the conflicting row *doesn't exist yet*? |
| **Advisory lock** | `pg_advisory_xact_lock(hash(provider_id))` | Serializes the whole provider — correct, but how much throughput? |
| **`SERIALIZABLE`** | Let Postgres detect the conflict | Now you must catch `40001` and retry. Where does that retry live? |
| **Exclusion constraint** | The database rejects overlapping ranges, structurally | Can any code path bypass it? |

**Why this exists.** There is rarely one right answer, and "which concurrency control fits this
problem" is a genuine mid-level judgement call. Working through all four teaches the shape of the
trade-off: pessimistic locking costs throughput, optimistic costs retry complexity, and constraints
cost flexibility but are the only option that **cannot be bypassed by a future code path**.

That last property is decisive here. In six months there will be an admin tool, a CSV importer, and a
migration script that all create bookings. Every one of them will forget your careful locking. None of
them can get past a constraint.

Note the trap hiding in `FOR UPDATE`: row locks only lock rows that **exist**. Two transactions
inserting *new* overlapping bookings lock nothing in common, so it doesn't help — which is a genuinely
surprising result worth discovering yourself.

**Done when:**
- [ ] All four prototyped and stress-tested
- [ ] `docs/notes/concurrency-approaches.md` holds results and a reasoned recommendation
- [ ] You discovered why plain `FOR UPDATE` fails for inserts
- [ ] You measured throughput under advisory locking vs the constraint

---

### KAI-043 · FEAT · 2h — Fix it in the database

```sql
ALTER TABLE bookings ADD CONSTRAINT bookings_no_overlap
  EXCLUDE USING gist (
    provider_id WITH =,
    time_range  WITH &&
  ) WHERE (status IN ('pending_payment', 'confirmed'));
```

Hand-written SQL in a Prisma migration (Prisma's DSL can't express this). Catch Postgres error code
`23P01` in the repository and translate it to a clean 409 with code `SLOT_UNAVAILABLE`.

**Keep the application-level availability check from KAI-040.** It is not redundant — it gives a fast,
friendly error for the common case. But it is now an *optimization*, not the guarantee. That reframing
is the whole lesson.

**Why this exists.** Read the constraint closely:

- `provider_id WITH =` — only conflicts within one provider's calendar.
- `time_range WITH &&` — "overlaps", via the range operator from KAI-035.
- `WHERE (status IN …)` — a **partial** constraint. Cancelled and expired bookings keep their rows for
  audit and ledger history but stop blocking the slot. Without this clause, one cancellation would
  poison that time forever.

This single declaration is stronger than any amount of application code, because it holds for every
writer — your API, a psql session, a future importer, a buggy migration. **The database is the last
line of defence and the only one that can't be forgotten.**

**Done when:**
- [ ] Migration adds `btree_gist` (if not already) and the constraint
- [ ] KAI-041's stress script creates **exactly one** booking out of 50 — run it ten times
- [ ] Losers get 409 `SLOT_UNAVAILABLE`, not a raw 500 with a Postgres error
- [ ] `23P01` is caught in the repository, not leaked to the service layer
- [ ] A cancelled booking frees its slot for rebooking — tested
- [ ] You tried to violate it directly in `psql` and were refused
- [ ] Raised to 100 concurrent: still exactly one

**The trap:** forgetting the `WHERE` clause. Everything passes until the first cancellation, after
which that slot is permanently unbookable — and that bug is miserable to diagnose because the data
looks fine.

---

### KAI-045 · FEAT · 2h — The booking state machine

Extract transitions into an explicit machine in `src/domain/booking-state.ts`. A transition table, a
`transition(booking, event, actor)` function that throws on illegal moves, and an append to
`booking_events` for every successful change — in the **same transaction** as the status update.

**Why this exists.** Without this, status changes scatter as `UPDATE bookings SET status = ?` across a
dozen call sites, and nothing stops `completed → pending_payment`. With it, legal transitions are data
you can read in one place, print as a diagram, and test exhaustively.

It also pays off directly in M5. When a refund arrives for a booking already refunded, the state
machine rejects it structurally — you don't need a defensive `if` in the refund handler, because the
illegal transition is impossible by construction.

`booking_events` is your audit log, your debugging timeline, and — in M6 — the natural foundation for
the transactional outbox. Writing it in the same transaction as the status change is what makes it
trustworthy: there is no state the log can miss.

**Done when:**
- [ ] Transition table matches the PRD diagram exactly
- [ ] Illegal transitions throw a typed error → 409, and are logged
- [ ] Every transition appends to `booking_events` with actor, reason, and timestamp
- [ ] Status update and event insert share one transaction — verified by forcing a failure between them
- [ ] Tests cover every legal transition and a representative sample of illegal ones
- [ ] No `UPDATE bookings SET status` exists outside the state machine — grep to confirm

**The trap:** allowing a status update that skips the machine "just for the expiry sweeper". The one
bypass becomes three.

---

### KAI-046 · FEAT · 1.5h — Holds that expire (the version that leaks)

A `pending_payment` booking holds its slot for 10 minutes via `hold_expires_at`. Build a sweeper that
transitions expired holds to `expired`, releasing the slot.

**Build it naively: `setInterval` inside the API process.** This is deliberate.

**Why this exists.** Holds are what make payment possible — the slot must be reserved while the
customer enters card details, but not forever.

The naive sweeper is a catalogue of problems you need to *feel* before M6 fixes them:
- Run two API instances and two sweepers race on the same rows.
- Restart during a sweep and work is silently lost.
- A sweep that throws kills the interval, permanently, with no alert.
- Nothing records whether it ran, or when.
- You cannot trigger it manually, retry it, or see its history.

Every one of those is solved by a real job queue, which arrives in M6 — **after** you've lived with
this. Write the problems down as you hit them; that list becomes KAI-061's acceptance criteria.

**Done when:**
- [ ] Holds expire after 10 minutes and the slot becomes bookable again
- [ ] Expiry goes through the state machine (no bypass)
- [ ] A hold already paid for is never expired — check the race between payment and sweep
- [ ] You ran two instances and observed the double-sweep
- [ ] `docs/notes/naive-scheduler.md` lists everything wrong with this approach, from experience

**The trap:** `setInterval` with an async callback and no overlap guard. A slow sweep overlapping the
next one gives you the double-processing bug inside a single process.

---

### KAI-047 · BUG · 1h — Deadlock

Construct one deliberately: two transactions that lock the same two rows in opposite order. Watch
Postgres detect it and kill one with error `40P01`.

**Why this exists.** Deadlocks are inevitable in any system with multi-row transactions, and the fix is
usually boringly simple — **always acquire locks in a consistent order** (sort by ID before locking).
Knowing that rule, and knowing Postgres auto-detects and aborts rather than hanging forever, turns a
terrifying production incident into a known quantity.

You also need the application-side habit: a deadlock victim should be **retried**, not surfaced as a
500. It's a transient failure, and the transaction that lost did nothing wrong.

**Done when:**
- [ ] You reproduced a deadlock and read the Postgres log entry describing both transactions
- [ ] You fixed it by ordering lock acquisition consistently
- [ ] A retry wrapper handles `40001` (serialization) and `40P01` (deadlock) with bounded backoff
- [ ] The retry wrapper is tested by forcing a failure
- [ ] `docs/notes/deadlocks.md` explains the cause and the ordering rule

**The trap:** retrying forever. Bound the attempts — an unbounded retry on a genuine logic error
becomes an outage.

---

## Closing M4

- [ ] 100 concurrent requests for one slot → exactly one booking, ten runs in a row
- [ ] Enforced by a constraint; the application check is an optimization and you can say why
- [ ] State machine owns every transition; `booking_events` is complete
- [ ] You can explain: TOCTOU, `READ COMMITTED` vs `SERIALIZABLE`, why `FOR UPDATE` doesn't help for
      inserts, and why the partial `WHERE` clause on the constraint is essential
- [ ] You have a written list of everything wrong with your sweeper

**Log it in `plan.md`.** This milestone is the one to talk about in interviews — have the stress script
and the before/after numbers ready.
