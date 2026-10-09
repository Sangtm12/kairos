# Kairos — Product Requirements Document

**Status:** Draft v1 · **Owner:** tran.minh.sang · **Last updated:** 2026-10-09

---

## 0. The learning charter (read this first)

This document describes two products at once, and you should never forget the second one.

**Product A** is Kairos: a scheduling and payments platform for independent service professionals.

**Product B** is you: a backend engineer with the judgement of someone 1–2 years into the job.

Where the two conflict, Product B wins. That has concrete consequences you will feel:

- **You will build things badly on purpose, then fix them.** Several tickets ask you to ship a naive
  implementation, break it under load, and only then reach for the correct tool. A race condition you
  have personally reproduced teaches more than ten articles about isolation levels.
- **You will hand-roll before you import.** Your first logger, your first rate limiter, and your first
  validation layer are ~30 lines each, written by you. Then you replace them with the real library and
  read its source. Now you know what the library *does*, not just what its README says.
- **Infrastructure arrives when it's earned.** Redis shows up in Milestone 6 — not because the stack
  diagram demands it, but because by then you will have a background job that silently loses emails and
  you will want a queue. A tool adopted before you feel its problem is cargo cult.
- **Refactoring is the curriculum, not a failure.** You said you don't mind changing code later. Good:
  roughly a third of the tickets change code you wrote weeks earlier. That is the actual job.

**Non-goals for Product B:** frontend polish, design, mobile. You will build a minimal HTML test
console only because clicking a button is a faster way to find bugs than curl.

---

## 1. Product summary

Kairos lets an independent professional — a piano tutor, a personal trainer, a tattoo artist, a
therapist, a consultant — publish bookable services, define when they are available, and take payment
when a customer books. The platform takes a percentage fee and pays out the remainder.

**One-sentence pitch:** Calendly and Stripe, fused into one product, for people who sell their time.

**Why this domain was chosen over a blog, shop, or task tracker:**

| Problem the domain forces | Why it's hard | Where tutorials stop |
|---|---|---|
| "When is this person free?" | Recurring rules × timezones × DST × buffers × exceptions | They hardcode 9–5 |
| "Two people clicked 3pm at once" | Transactions, isolation, locks, exclusion constraints | They do `SELECT` then `INSERT` |
| "The payment succeeded but the booking failed" | Distributed state, sagas, compensation | They have no payment |
| "Did we actually charge them twice?" | Idempotency, webhook replay, ledger invariants | They store a float |
| "The reminder email never sent" | At-least-once delivery, outbox, retries, DLQ | They `await sendEmail()` inline |

Each of these is a genuine mid-level interview question, and each one emerges naturally from the
product rather than being bolted on as an exercise.

---

## 2. Actors

| Actor | Who they are | Core needs |
|---|---|---|
| **Customer** | Books and pays for time | Find a provider, see real availability, book, pay, reschedule, cancel |
| **Provider** | Sells their time | Define services and availability, see their calendar, get paid, handle no-shows |
| **Staff** *(M9+)* | Works under an organization | Own a subset of a shared calendar |
| **Admin** | Platform operator (you) | Moderate, refund, inspect the audit log, watch the dashboards |
| **Partner** *(M9)* | Third-party system | Read availability and create bookings via a public API key |

Authorization is **not** just roles. A customer may read *their own* booking and no one else's; a
provider may cancel a booking *on their own calendar*. Resource-level ownership checks are a separate
concern from role checks, and conflating them is OWASP API #1. You will implement both.

---

## 3. Core user journeys

### J1 — Customer books and pays
1. Customer searches providers by service type, location, and price.
2. Opens a provider, sees available slots for the next 30 days **in their own timezone**.
3. Selects 3:00pm Thursday. A `pending_payment` booking is created and **held for 10 minutes**.
4. Pays. The gateway webhook confirms. Booking becomes `confirmed`.
5. Confirmation email sends asynchronously. A reminder is scheduled for 24h before.
6. If payment doesn't complete in 10 minutes, the hold expires and the slot returns to the pool.

### J2 — Customer cancels
1. Customer cancels 50 hours ahead → full refund per policy.
2. Cancels 10 hours ahead → 50% refund; provider keeps the rest.
3. Ledger entries move money. The provider's balance updates. Both parties are notified.

### J3 — Provider sets up
1. Signs up, creates a profile, publishes a service ("60-min lesson, 400,000 VND, 15-min buffer").
2. Sets recurring availability: Mon–Fri 09:00–17:00 Asia/Saigon.
3. Blocks out a holiday week as an exception.
4. Sees their calendar, upcoming payouts, and a dashboard of earnings.

### J4 — Provider handles a no-show
1. Customer doesn't arrive. Provider marks `no_show` after the slot ends.
2. Per policy, no refund; funds settle to the provider.
3. The transition is recorded in the audit log with actor and reason.

### J5 — Admin investigates *(M8)*
1. A customer claims a double charge.
2. Admin finds the booking by ID, reads its full state-transition history and ledger entries, and
   confirms whether the idempotency key was reused.

---

## 4. Domain model

Sketch, not final DDL. You will evolve this across milestones — that evolution is the point.

```
users ──1:1── provider_profiles ──1:N── services
  │                   │                    │
  │                   ├──1:N── availability_rules      (recurring weekly)
  │                   └──1:N── availability_exceptions (blackouts / one-offs)
  │
  └──1:N── bookings ──1:N── booking_events      (state transition log)
               │
               ├──1:1── payments ──1:N── ledger_entries
               └──0:1── reviews
```

### Key entities

**`users`** — identity only. Email, password hash, role, timezone. Auth concerns live here and nowhere
else.

**`provider_profiles`** — the sellable identity: display name, bio, location, search vector.
Deliberately separate from `users` so a user can exist without being a provider.

**`services`** — what's for sale. Duration, price in **minor units as `BIGINT`** (never float — see
FR-5.1), buffer before/after, lead time, max advance booking window.

**`availability_rules`** — recurring weekly windows stored as `(weekday, start_time, end_time, timezone)`.
Note that `start_time` is a wall-clock `TIME`, not a timestamp — "Mondays at 9am local" survives DST,
"Mondays at 02:00 UTC" does not.

**`availability_exceptions`** — date-specific overrides, both subtractive (holiday) and additive
(one-off Saturday).

**`bookings`** — the heart of the system.
```sql
id              uuid primary key
customer_id     uuid not null references users
provider_id     uuid not null references provider_profiles
service_id      uuid not null references services
time_range      tstzrange not null          -- the single source of truth for "when"
status          booking_status not null      -- see state machine below
price_minor     bigint not null              -- snapshot at booking time, not a join
currency        char(3) not null
hold_expires_at timestamptz                  -- only set while pending_payment
```
`time_range` as a `tstzrange` rather than `start_at`/`end_at` is what makes the exclusion constraint in
FR-4.3 possible. Storing the price as a snapshot rather than joining to `services` means a later price
change doesn't rewrite history.

**`payments`** — gateway reference, idempotency key, status, amount. One row per charge attempt, never
updated in place for a new attempt.

**`ledger_entries`** — **double-entry**. Every money movement writes at least two rows that sum to zero.
Accounts: `customer_source`, `platform_fee`, `provider_payable`, `refund_sink`. An invariant test asserts
the global sum is always zero (TEST-057).

**`booking_events`** — append-only transition log: `(booking_id, from_status, to_status, actor_id, reason, at)`.
This is your audit trail, your debugging tool, and later your event source for the outbox.

### Booking state machine

```
                   ┌──────────────────┐
                   │ pending_payment  │──── hold expires ────▶ expired
                   └────────┬─────────┘
                    payment │ confirmed
                            ▼
                   ┌──────────────────┐
         ┌─────────│    confirmed     │─────────┐
         │         └────────┬─────────┘         │
  cancel │                  │ slot ends          │ provider cancels
 (policy)│                  ▼                    ▼
         ▼         ┌──────────────────┐   ┌──────────────┐
  ┌─────────────┐  │    completed     │   │  cancelled_  │
  │ cancelled_  │  └──────────────────┘   │  by_provider │
  │ by_customer │           │             └──────┬───────┘
  └──────┬──────┘           │ no attend          │
         │                  ▼                    │
         │         ┌──────────────────┐          │
         │         │     no_show      │          │
         │         └──────────────────┘          │
         └────────────▶ refunded ◀───────────────┘
```

**Every transition is a method on a state machine object, not an `UPDATE bookings SET status = ?`
scattered across controllers.** Invalid transitions throw. This is FR-4.5 and it will save you in M5.

---

## 5. Functional requirements

Each requirement names the milestone that delivers it. `M0`–`M9` map to `plans/261009-2320-kairos-backend-curriculum/`.

### 5.1 Foundations · M0–M1
- **FR-1.1** Every endpoint returns a consistent envelope: `{ data }` on success, `{ error: { code, message, details } }` on failure. HTTP status codes used correctly (201 for creation, 409 for conflict, 422 for validation).
- **FR-1.2** All input is validated at the boundary before reaching business logic. Unvalidated input never crosses into a service.
- **FR-1.3** All configuration comes from validated environment variables. The process refuses to boot with a missing or malformed config value — failing at startup beats failing at 3am.
- **FR-1.4** Schema changes happen only through forward-only migrations. A migration that has run on any shared environment is never edited. Parts of the schema Prisma's DSL cannot express (`btree_gist`, `tstzrange`, `EXCLUDE` constraints) are hand-written SQL inside Prisma migration files — not applied out-of-band, or your migration history lies to you.
- **FR-1.5** Every SQL query is parameterized. No string concatenation reaches the driver, ever. This survives the move to Prisma: `$queryRaw` with a tagged template is safe, `$queryRawUnsafe` with an interpolated string is the same vulnerability wearing an ORM's clothes.
- **FR-1.6** Money is stored as integer minor units in `BIGINT`. Floats never touch a currency value. `0.1 + 0.2 !== 0.3` is not an acceptable property of your billing system.

### 5.2 Identity & access · M2
- **FR-2.1** Passwords hashed with Argon2id. Never MD5/SHA — those are fast, and fast is the enemy here.
- **FR-2.2** Short-lived access token (15 min) + long-lived refresh token (30 days) with **rotation**: each refresh issues a new token and invalidates the old.
- **FR-2.3** Refresh token **reuse detection** — presenting an already-rotated token revokes the whole family and forces re-login. This is what makes token theft survivable.
- **FR-2.4** Authorization is two independent checks: *role* (is this user a provider?) and *ownership* (is this that provider's booking?). Both must pass.
- **FR-2.5** Authentication endpoints are rate limited per IP and per account.
- **FR-2.6** Error responses never leak whether an email exists ("invalid credentials", not "no such user").

### 5.3 Availability · M3
- **FR-3.1** All timestamps stored in UTC (`timestamptz`). Recurring rules stored as local wall-clock time plus an IANA timezone name.
- **FR-3.2** Available slots computed from: recurring rules − exceptions − existing bookings − buffers − lead time, bounded by the max advance window.
- **FR-3.3** Slot generation is correct across DST transitions in both directions. A 9am Monday lesson stays 9am local through the March and November shifts.
- **FR-3.4** Slots are returned in the **caller's** timezone, with the UTC instant included so clients never have to guess.
- **FR-3.5** Computing a 90-day availability window for one provider responds in under 200ms.

### 5.4 Booking & concurrency · M4
- **FR-4.1** A slot can be held as `pending_payment` for 10 minutes, after which it automatically returns to the pool.
- **FR-4.2** **Two concurrent requests for the same slot: exactly one succeeds, the other receives 409.** Not "usually one". Exactly one, under sustained parallel load.
- **FR-4.3** Overlap prevention is enforced by a **database constraint**, not application logic. Application checks are an optimization for a better error message; the database is the authority. If your only protection is an `if` statement in Node, you have no protection.
- **FR-4.4** `POST /bookings` is idempotent on an `Idempotency-Key` header. The same key replayed returns the original result without creating a second booking.
- **FR-4.5** Status changes go through an explicit state machine. Illegal transitions (`completed` → `pending_payment`) are rejected with 409 and logged.
- **FR-4.6** Every transition appends to `booking_events` with actor and reason.

### 5.5 Payments & money · M5
- **FR-5.1** Every money movement writes balanced double-entry ledger rows. The sum of all entries across the platform is always exactly zero — asserted by a test that runs in CI.
- **FR-5.2** Payment gateway webhooks are signature-verified, replay-protected, and **order-independent** — webhooks arrive out of order in production and the handler must cope.
- **FR-5.3** Webhook handlers are idempotent. The same event delivered five times has the same effect as once.
- **FR-5.4** Cancellation refunds follow a tiered policy (>48h: 100%, 24–48h: 50%, <24h: 0%) that is configurable per provider.
- **FR-5.5** When payment succeeds but booking confirmation fails, the system compensates — either completing or refunding. It never silently keeps the money.
- **FR-5.6** Platform fee is calculated with explicit, documented rounding. Rounding direction is a business decision, not an accident of `Math.round`.

### 5.6 Asynchronous work · M6
- **FR-6.1** No email, webhook, or third-party call happens on the request path. The HTTP response does not wait on anything a user doesn't need.
- **FR-6.2** Jobs retry with exponential backoff and land in a dead-letter queue after exhausting attempts.
- **FR-6.3** Every job handler is idempotent — the queue guarantees *at-least-once*, never exactly-once, so the handler carries that burden.
- **FR-6.4** Events are published via a **transactional outbox**: the event row is written in the same transaction as the state change. A rolled-back booking cannot send a confirmation email.
- **FR-6.5** Reminder emails are scheduled 24h before a booking and cancelled if the booking is cancelled.
- **FR-6.6** Outbound webhooks to partners are HMAC-signed and retried on failure.

### 5.7 Performance · M7
- **FR-7.1** All collection endpoints use **cursor-based** pagination. `OFFSET 10000` is not a paging strategy.
- **FR-7.2** No endpoint issues N+1 queries. Verified by asserting query counts in tests, not by eyeballing.
- **FR-7.3** Provider search results are cached with explicit TTL and invalidated on write.
- **FR-7.4** Cache stampede is prevented — a cold popular key does not send 500 concurrent requests to Postgres.
- **FR-7.5** Full-text provider search over name, bio, and service titles, with filters and ranking.
- **FR-7.6** Per-key rate limiting returns 429 with `Retry-After`.
- **FR-7.7** Every query in a hot path has a supporting index, demonstrated with `EXPLAIN ANALYZE` before and after.

### 5.8 Operability · M8
- **FR-8.1** Structured JSON logs with a request ID propagated through every layer including background jobs. Secrets and PII are redacted.
- **FR-8.2** RED metrics (Rate, Errors, Duration) exposed for Prometheus.
- **FR-8.3** Distributed traces spanning HTTP → service → database → queue → job handler.
- **FR-8.4** Liveness and readiness probes that distinguish "process alive" from "can serve traffic".
- **FR-8.5** Graceful shutdown: stop accepting connections, finish in-flight requests, drain jobs, close pools.
- **FR-8.6** Any production error can be traced to a request ID, a user, and a stack trace within two minutes.

### 5.9 Platform & release · M9
- **FR-9.1** CI runs typecheck, lint, unit tests, and integration tests against a real Postgres on every push.
- **FR-9.2** Migrations run automatically on deploy and are safe to run while the old version is still serving.
- **FR-9.3** Public API authenticated by scoped API keys, versioned under `/v1`.
- **FR-9.4** OpenAPI spec generated from the code, not maintained by hand beside it.
- **FR-9.5** Deployed to a public URL with TLS and automated database backups.
- **FR-9.6** A documented, **rehearsed** restore from backup. An untested backup is a rumour.

---

## 6. Non-functional requirements

| Area | Target | Why this number |
|---|---|---|
| Availability query | p95 < 200ms for a 90-day window | The slowest realistic read; if this is fast, everything is |
| Booking write | p95 < 500ms including payment hold | Users abandon above ~1s |
| Concurrency | 0 double-bookings under 100 parallel requests for one slot | Binary correctness, not a percentage |
| Ledger | Global balance = 0, always | Money has no acceptable error rate |
| Test coverage | >80% on services and domain logic | Controllers and glue code matter less |
| Startup | Boots in <5s, fails fast on bad config | Deploy speed and debuggability |

**Security baseline:** OWASP API Top 10 reviewed explicitly in M9; Helmet headers; CORS allowlist; no
secrets in the repo (CI scans for them); dependency audit in CI; request body size limits; SQL always
parameterized.

---

## 7. Explicitly out of scope

Named here so you don't drift into them at week 7 and lose a milestone:

- Real money. Stripe **test mode** only — no live keys, no real cards, ever.
- A production frontend. A single scrappy HTML page for manual testing is fine and encouraged.
- Mobile apps, native anything.
- Real-time chat between customer and provider (WebSockets are tempting; they are a different curriculum).
- Machine learning, recommendations, dynamic pricing.
- Multi-region, sharding, microservices. **A well-built modular monolith is the correct architecture at
  this scale, and knowing that is itself a mid-level signal.** Splitting into services here would teach
  you distributed-systems pain you haven't earned and don't need.
- Video calls, calendar sync (Google/Outlook), SMS.

---

## 8. Tech stack, and why each piece

| Choice | Why | What was rejected and why |
|---|---|---|
| **TypeScript** | Booking states as discriminated unions; money types that resist misuse; contracts between layers | JS — weaker for exactly the domain modelling this project is about |
| **Express 5** | You asked for it. Native async error handling; small enough that you see the mechanics | Nest (too much magic for learning), Fastify (great, but Express is what jobs ask for) |
| **PostgreSQL 17** | `tstzrange`, exclusion constraints, advisory locks, full-text search, `LISTEN/NOTIFY` — this project is a tour of Postgres's good parts | MySQL (no range types — would gut M4), Mongo (this data is deeply relational) |
| **`pg` + raw SQL** *(M0–M1 only)* | You cannot learn SQL through an abstraction that hides it. Two weeks writing joins, CTEs, and query plans by hand | Starting with an ORM — you'd never learn what it generates |
| **Prisma** *(M2 onward)* | Type-safe client, excellent migrations, the ORM most Express/TS job posts name. Adopted **after** you've hand-written the equivalent SQL, so you can read what it emits | Drizzle/Kysely (closer to SQL, but Prisma is the one hiring managers ask about), TypeORM (declining) |
| **`$queryRaw` escape hatch** | Prisma cannot express `SELECT … FOR UPDATE`, exclusion constraints, advisory locks, or `tsvector` ranking. You will drop to SQL in M4, M7 — **and knowing when your ORM runs out of road is itself the lesson** | Fighting the ORM; abandoning the ORM |
| **Prisma Migrate + custom SQL migrations** | Schema-first migrations, with hand-written SQL for the parts Prisma's schema language can't model (`btree_gist`, `tstzrange`, `EXCLUDE`) | node-pg-migrate (fine, but splitting migration tooling across two systems invites drift) |
| **Zod** | Runtime validation that infers static types — one source of truth for a shape | Joi (no type inference), class-validator (decorator-heavy) |
| **Vitest + Supertest + Testcontainers** | Integration tests against a **real** Postgres. Mocked databases prove nothing about constraints, which is where your hardest bugs live | Jest (slower), sqlite-in-memory (different engine, different behaviour, false confidence) |
| **Docker Compose** | Postgres from day one; Redis joins in M6 | Local installs — "works on my machine" starts here |
| **Redis + BullMQ** *(M6)* | Queues, scheduled jobs, caching, distributed locks, rate limiting — four curriculum topics in one dependency | pg-boss (fine, but Redis is the one employers ask about) |
| **Pino + OpenTelemetry** *(M8)* | Structured logs and traces, the actual production debugging toolkit | Winston (slower), console.log (you start here on purpose, then feel why it fails) |
| **Fly.io** *(M9)* | Real Postgres, real TLS, cheap, straightforward migrations | Vercel (wrong shape for a stateful server with background workers) |

**An intentionally light hand:** no DI framework, no GraphQL, no service mesh. Every abstraction you add
is one you can no longer see through, and seeing through things is the entire point of this project.

**On Prisma specifically — the sequencing matters more than the choice.** An ORM adopted on day one is a
black box you learn to operate. An ORM adopted in week 3, after you have hand-written the same queries,
is a tool you understand. The migration itself (KAI-018) is also the single most realistic ticket in
this repo: replacing a data-access layer under a working test suite is work you will do again in your
career, and the tests you wrote in M1 are what make it survivable. Keep the raw-SQL repository files in
git history — reading your own `before` and `after` is worth more than any tutorial.

---

## 9. Architecture

A modular monolith, layered, with dependencies pointing inward:

```
  HTTP  ─────────────────────────────────────────────────────
   │  routes/        thin — parse, validate, delegate
   │  middleware/    auth, request id, error handler, rate limit
   ▼
  DOMAIN ───────────────────────────────────────────────────
   │  services/      business rules. No req/res. No SQL.
   │  domain/        state machines, policies, money, slot engine
   ▼                 (pure functions — trivially testable)
  DATA ─────────────────────────────────────────────────────
   │  repositories/  data access lives here and NOWHERE else
   │                 M0–M1: raw SQL via `pg`  →  M2+: Prisma (+ $queryRaw)
   │  db/            client, transaction helper, migrations
   ▼
  Postgres · Redis (M6+)

  WORKERS ──────────────────────────────────────────────────
      jobs/          same services layer, different entry point
```

**The rule that makes this work:** a service never imports `express`, and a route never touches the
database. One corollary deserves its own sentence, because it is what makes the Prisma migration in
KAI-018 a two-day job instead of a two-week one: **`PrismaClient` is imported only inside
`repositories/`.** Services receive plain domain objects and call repository methods. The moment a
`prisma.booking.findMany()` appears in a service, your data layer is welded to your business logic and
you can never swap, mock, or reason about either one independently. Enforce it with an ESLint
`no-restricted-imports` rule in KAI-019 — discipline you have to remember is discipline you will lose. If
you can't test your booking logic without an HTTP request, the layering has failed. By M4 you will have
a slot engine that is a pure function — hundreds of test cases, zero database.

---

## 10. Glossary

| Term | Meaning |
|---|---|
| **Slot** | A candidate bookable time range, computed — never stored |
| **Hold** | A `pending_payment` booking occupying a slot for 10 minutes |
| **Buffer** | Padding before/after a service for travel or setup |
| **Lead time** | Minimum notice before a booking can start ("not within 2 hours") |
| **Minor units** | Smallest currency denomination; `150000` = 1,500.00 VND |
| **Idempotency key** | Client-supplied token making a retried request safe |
| **Outbox** | Event table written in the same transaction as a state change, drained by a worker |
| **DLQ** | Dead-letter queue — where jobs go after exhausting retries |
| **Exclusion constraint** | Postgres constraint rejecting rows whose ranges overlap |
| **Saga** | Multi-step workflow with compensating actions on failure |

---

## 11. Definition of done for the whole project

You are done when all of these are true:

- [ ] A stranger can `git clone`, run `docker compose up`, `npm run dev`, and have a working API in under 5 minutes.
- [ ] The API is live at a public URL with real TLS.
- [ ] CI is green and runs integration tests against a real Postgres.
- [ ] You can fire 100 concurrent requests at one slot and get exactly one booking.
- [ ] The ledger balances to zero after a chaotic sequence of bookings, cancellations, and refunds.
- [ ] You can trace a single request from log line to database query to background job.
- [ ] You have restored the database from a backup at least once, for real.
- [ ] You can explain, out loud and without notes, why each of these exists: the exclusion constraint,
      the outbox pattern, refresh token rotation, cursor pagination, and the double-entry ledger.

That last one is the real exit exam. Everything else is evidence.
