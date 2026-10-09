# M1 — Data & SQL

**~12h · Week 2 · Question: how do I model and query data without an ORM — and what does an ORM do for me once I switch?**

This milestone has two halves, and the order is the entire point. First you write raw parameterized
SQL against a schema you designed by hand. Then, in KAI-018, you replace all of it with Prisma. You
will have written the queries before you read the ones Prisma generates, which is the difference
between *understanding* your ORM and *trusting* it.

**Exit condition:** a real schema, migrations, working CRUD through Prisma, a SQL injection you
exploited yourself, and an index you can prove was necessary.

---

### KAI-010 · CHORE · 1h — Migrations, forward-only

Set up `node-pg-migrate` with plain SQL up/down files. Create the first migration: the `users` table.
Add `npm run migrate:up`, `migrate:down`, `migrate:create`.

**Why this exists.** The schema is code and belongs in git. More importantly, learn the law now:
**a migration that has run anywhere shared is never edited.** You write a new one. Editing an applied
migration means your machine and production silently diverge, and you won't find out until something
breaks in a way that makes no sense.

> You switch to Prisma Migrate in KAI-018. Doing one week with raw SQL migrations first means you'll
> understand what Prisma generates rather than treating `migrate dev` as a spell.

**Done when:**
- [ ] `migrate:up` creates the table; `migrate:down` cleanly reverses it
- [ ] A migrations tracking table exists in the DB — go look at it
- [ ] Running `migrate:up` twice is a no-op, not an error
- [ ] `docs/notes/migrations.md` answers: why forward-only? why is `down` often a lie in production?

**The trap:** `ALTER TABLE` by hand in `psql` "just this once". Now your migration history is fiction.

---

### KAI-011 · FEAT · 2h — The core schema

Migrations for `users`, `provider_profiles`, `services`. Real constraints: `NOT NULL`, `UNIQUE`,
foreign keys with deliberate `ON DELETE` behaviour, `CHECK (price_minor >= 0)`, enum types for role.

Decide and record in `docs/notes/schema-decisions.md`:
- **UUID vs bigserial for PKs?** (UUIDs don't leak row counts and let clients generate IDs; they're
  wider and randomly ordered, which fragments B-tree inserts. UUIDv7 is time-sortable and fixes most
  of that — strongly preferred here.)
- **`timestamptz` vs `timestamp`?** (`timestamptz` — always. `timestamp` silently discards the offset,
  and M3 will punish you for it.)
- **`ON DELETE CASCADE` vs `RESTRICT`?** (What *should* happen to bookings when a provider deletes
  their account? There is a real answer and it isn't "whatever's easiest".)
- **Soft delete or hard delete?** (You have paid bookings referencing providers. Think about it.)

**Why this exists.** Constraints are the cheapest correctness you will ever buy. A `CHECK` runs on
every write forever, costs nothing, and cannot be bypassed by a bug in your Node code. Application
validation is a nicer error message on top of a database guarantee — never a replacement for one.

**Done when:**
- [ ] Every FK has a deliberate, documented `ON DELETE`
- [ ] A negative price is rejected **by the database** — prove it in `psql`
- [ ] Email uniqueness is case-insensitive (`CITEXT` or a functional unique index — decide which)
- [ ] Every table has `created_at`/`updated_at` with sane defaults
- [ ] `docs/notes/schema-decisions.md` records each choice with a reason

**The trap:** no FK constraints "for flexibility". Flexibility here means orphaned rows you discover
in month three.

---

### KAI-012 · FEAT · 1.5h — Repositories with raw SQL

Implement `UserRepository` and `ServiceRepository` with the `pg` pool. Parameterized queries only.
Map `snake_case` columns to `camelCase` domain objects at this boundary. Add a `withTransaction`
helper that takes a callback and handles `BEGIN`/`COMMIT`/`ROLLBACK`.

**Why this exists.** The mapping layer is what keeps database naming out of your API responses — and
the `withTransaction` helper is load-bearing for the rest of the project. In M4 you'll pass a client
through it to run a locked read and an insert in one atomic unit; in M6 the outbox pattern depends on
it. Build it now while it's a five-line function you fully understand.

**Done when:**
- [ ] Every query uses `$1, $2` placeholders — zero string interpolation
- [ ] `withTransaction` rolls back on a thrown error (write a test that throws mid-transaction)
- [ ] Connections are always released, including on error (`try/finally`)
- [ ] Repositories return domain objects, never raw `pg` result rows

**The trap:** `client.query()` without releasing the client on the error path. Pool exhaustion is a
slow, mystifying production hang — your app just stops responding with no error at all.

---

### KAI-013 · BUG · 1h — Exploit your own SQL injection

Deliberately write one vulnerable query:
```ts
const sql = `SELECT * FROM services WHERE title LIKE '%${q}%'`;
```
Then attack it. `'; DROP TABLE services; --` and `' OR '1'='1`. Watch it work. Then fix it, and try the
same payloads again.

**Why this exists.** You will read "always parameterize" a hundred times and it will remain abstract
until you personally drop your own table. Five minutes of hands-on exploitation produces a reflex that
a hundred blog posts cannot. This matters for the rest of the project too: when `$queryRawUnsafe`
appears in Prisma's API in M4, you'll recognize the danger instantly.

**Done when:**
- [ ] You extracted data you shouldn't have, from your own running app
- [ ] You dropped a table (restore it with `migrate:up`)
- [ ] Fixed, and the same payloads now return zero rows harmlessly
- [ ] `docs/notes/sql-injection.md` records the payloads and why parameterization defeats them
      (the answer is *not* "escaping" — it's that the query plan is built before data is bound)

**The trap:** concluding "I'll just escape quotes." You will miss a case. Parameterize, always.

---

### KAI-014 · FEAT · 1.5h — Validated CRUD for services

Full CRUD for `services`, validated with Zod at the route boundary. Shared schema objects produce both
the runtime validator and the static TypeScript type via `z.infer`.

**Why this exists.** One definition, two guarantees — compile-time and runtime — that cannot drift
apart. And note *where* validation sits: at the boundary, before anything reaches a service. Every
layer behind it can then assume well-formed input, which is what makes the inner layers simple.

**Done when:**
- [ ] Create, read (one + list), update, delete all work
- [ ] Invalid payloads return 422 with per-field details
- [ ] Unknown fields are stripped or rejected (`.strict()`) — decide and be deliberate
- [ ] `price_minor` is validated as a positive integer; a float is rejected
- [ ] Types are inferred from schemas, never written twice

**The trap:** validating in the service layer too, "to be safe". Pick one boundary and trust it, or
you'll maintain two drifting copies of every rule.

---

### KAI-015 · PERF · 1.5h — Seed, measure, index

Write a seed script generating ~100,000 services across ~2,000 providers. Then:
1. `EXPLAIN ANALYZE` a filtered query. Record the plan and timing.
2. Add the index.
3. `EXPLAIN ANALYZE` again. Record both.

**Why this exists.** Indexes stop being folklore the moment you watch `Seq Scan on services (actual
time=142ms)` become `Index Scan (actual time=0.4ms)`. Learn to read a plan now — you'll need it in M7
when the problem is subtler than a missing index. Also learn the cost side: indexes slow writes and
consume disk, so "index everything" is its own bug.

**Done when:**
- [ ] Seed script runs in reasonable time (batch inserts — row-by-row will take minutes, and noticing
      *that* is itself the lesson)
- [ ] `docs/notes/indexes.md` has before/after plans with real numbers
- [ ] You can read: `Seq Scan`, `Index Scan`, `Bitmap Heap Scan`, `Nested Loop`, `Hash Join`
- [ ] You understand why a composite index on `(a, b)` serves a query filtering on `a` but not one
      filtering only on `b`
- [ ] You've measured insert throughput with and without the indexes

**The trap:** `EXPLAIN` without `ANALYZE`. The first gives estimates; only the second actually runs the
query and gives you truth.

---

### KAI-016 · SPIKE · 0.5h — SQL beyond SELECT *

Write these against your seeded data, by hand, no ORM:
1. Top 10 providers by service count (`JOIN` + `GROUP BY` + `ORDER BY`)
2. Each provider's cheapest and most expensive service (window functions or `DISTINCT ON`)
3. Providers with zero services (`LEFT JOIN … IS NULL` — then rewrite as `NOT EXISTS` and compare plans)
4. A recursive CTE over anything (just to have met one)

**Why this exists.** This is the floor of SQL competence that separates someone who can only use an ORM
from someone who reaches for SQL when the ORM runs out of road — which happens in M4, M7, and most real
jobs. Prisma arrives in two tickets; these are the queries you'll be dropping into `$queryRaw` for.

**Done when:**
- [ ] All four run correctly, saved in `docs/notes/sql-practice.sql`
- [ ] You can explain `LEFT JOIN` vs `INNER JOIN` without hedging
- [ ] You know why `WHERE` filters before grouping and `HAVING` after

---

### KAI-018 · REFACTOR · 2.5h — Adopt Prisma

Install Prisma. Introspect your existing database (`prisma db pull`) to generate `schema.prisma` from
the schema **you** designed — not the other way round. Switch to Prisma Migrate going forward. Rewrite
`UserRepository` and `ServiceRepository` to use `PrismaClient`. **Change no other file.**

**Why this exists.** Three lessons stacked in one ticket, and it's the most realistic work in this repo.

*First:* you now read Prisma's generated SQL (`DEBUG=prisma:query npm run dev`) against queries you
wrote yourself last week. You'll see what it does well — eager loading, type safety, parameterization
by default — and where it's clumsy. That comparison is only available to you because you did it the
hard way first.

*Second:* this is a **data-layer swap under a passing test suite**, which is exactly the kind of
migration you'll be handed in a real job. The tests from KAI-008 and KAI-014 are your safety net. If
they all pass and nothing outside `repositories/` changed, your architecture from KAI-005 worked.

*Third:* you'll hit Prisma's limits and learn the escape hatch. Keep `withTransaction` — reimplement it
over `prisma.$transaction()` with the same signature, so callers never notice.

**Done when:**
- [ ] `schema.prisma` is introspected from your hand-designed schema
- [ ] Prisma Migrate is the migration tool from here on; `node-pg-migrate` is removed
- [ ] Both repositories use `PrismaClient`; **every test from M0–M1 still passes, unchanged**
- [ ] `git diff --stat` shows changes confined to `repositories/`, `db/`, and config
- [ ] You've read the SQL Prisma generates for a nested read and written down whether it's one query
      or several — and what that implies for M7's N+1 hunt
- [ ] `withTransaction` keeps its old signature on top of `$transaction`
- [ ] `docs/notes/prisma-migration.md`: what got better, what got worse, what you'd miss most if it
      were taken away

**The trap:** letting `prisma db push` replace migrations because it's faster. `push` skips migration
history entirely — fine for a scratch database, a catastrophe for anything you deploy. Use
`prisma migrate dev` locally and `prisma migrate deploy` in CI.

**Second trap:** deleting the raw-SQL repositories from git history. Keep those commits — reading your
own before/after is the whole return on this ticket.

---

### KAI-019 · CHORE · 0.5h — Enforce the data-layer boundary

ESLint `no-restricted-imports`: `@prisma/client` may be imported **only** inside `src/repositories/`
and `src/db/`. A violation fails the lint run.

**Why this exists.** The boundary you just proved valuable in KAI-018 will erode the first time it's
inconvenient — someone (you, at 11pm) imports `prisma` directly into a service for "just one query".
Then it's in five services, then your business logic can't be tested without a database and can't be
reasoned about without knowing Prisma. **Discipline you have to remember is discipline you will lose.**
Make the linter remember instead.

**Done when:**
- [ ] A deliberate `import { PrismaClient }` inside `services/` fails `npm run lint`
- [ ] The rule is documented in `docs/notes/architecture-rules.md` with the reasoning, not just the config

---

## Closing M1

- [ ] Schema under migration control, constraints doing real work
- [ ] You've exploited and fixed a SQL injection
- [ ] You can read an `EXPLAIN ANALYZE` plan
- [ ] Prisma adopted, all prior tests still green, boundary enforced by lint
- [ ] You can explain what Prisma gave you, what it cost, and when you'd drop to `$queryRaw`

**Log it in `plan.md`** — especially anything about KAI-018 that surprised you.
