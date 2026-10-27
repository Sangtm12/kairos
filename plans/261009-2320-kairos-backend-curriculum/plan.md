# Kairos — Execution Roadmap

**PRD:** [`docs/product-requirements.md`](../../docs/product-requirements.md)
**Budget:** ~10h/week × 12 weeks ≈ 120h · **Started:** 2026-10-09

---

## How to use this

Each milestone is one file of tickets. Work them **in order** — later tickets assume the mess earlier
ones leave behind. Every ticket carries:

- **Why this exists** — the concept being taught. Read this before writing code.
- **Done when** — checkboxes. No "it works on my machine".
- **The trap** — the mistake most people make here. Read it *after* you get stuck, not before.

Ticket types: `FEAT` build · `CHORE` setup · `SPIKE` learn then decide · `BUG` planted defect ·
`INCIDENT` production-style failure you must diagnose · `PERF` · `SEC` · `TEST` · `REFACTOR` · `DOC`

**`INCIDENT` tickets are the most valuable in this repo.** They describe a symptom, not a cause. Resist
reading ahead — the diagnosis is the lesson.

---

## Milestones

| # | Milestone | Hrs | The question it answers | Status |
|---|---|---|---|---|
| [M0](milestone-00-foundations.md) | Foundations | 10 | What actually happens between `curl` and a response? | 🟡 code done · closing notes pending (KAI-003 http-basics) |
| [M1](milestone-01-data-and-sql.md) | Data & SQL | 12 | Raw SQL first — then what does Prisma actually do for me? | 🟡 KAI-010 (migrations notes pending) |
| [M2](milestone-02-auth.md) | Identity & access | 10 | How do I know who you are, and what you may touch? | ⬜ |
| [M3](milestone-03-availability-engine.md) | Availability engine | 20 | When is this person actually free? | ⬜ |
| [M4](milestone-04-booking-concurrency.md) | Booking & concurrency | 13 | What happens when two people click at once? | ⬜ |
| [M5](milestone-05-payments-and-money.md) | Payments & money | 20 | How do I move money without ever losing any? | ⬜ |
| [M6](milestone-06-async-and-reliability.md) | Async & reliability | 12 | How does work happen after the response is sent? | ⬜ |
| [M7](milestone-07-performance.md) | Performance | 10 | Why is it slow, and how do I prove I fixed it? | ⬜ |
| [M8](milestone-08-observability.md) | Observability | 8 | It's broken in production. Now what? | ⬜ |
| [M9](milestone-09-platform-and-ship.md) | Platform & ship | 12 | How does this become something other people can use? | ⬜ |

**Total ≈ 127h** against a ~120h budget — the slack is deliberate, because KAI-033 (slot engine) and
KAI-055 (ledger) always take longer than they look.

**Cut line:** finishing **M0–M5** (~85h) already gives you a portfolio-worthy project and the two
hardest topics (concurrency, money). M6–M9 are what separate "built a project" from "could hold an
on-call pager" — but if life intervenes, M5 is a clean place to stop.

---

## The arc

```
M0  hand-roll everything          ──▶ you understand what frameworks hide
M1  raw SQL, then swap to Prisma  ──▶ you can read a query plan AND your ORM
M2  auth from primitives          ──▶ you know why each token exists
M3  pure-function domain logic    ──▶ you can test hard logic without a database
M4  break it, then fix it in SQL  ──▶ you trust databases over application code
M5  money, ledgers, idempotency   ──▶ you think in invariants
M6  queues, outbox, retries       ──▶ you assume everything fails twice
M7  measure, then optimize        ──▶ you stop guessing
M8  logs, metrics, traces         ──▶ you can debug what you cannot reproduce
M9  CI, deploy, backups, API      ──▶ you can ship
```

**Dependencies:** strictly sequential. Two you may pull forward if impatient — `KAI-091` (CI) any time
after M1, `KAI-095` (deploy) any time after M2. Shipping early is a habit, not a distraction.

## Progress log

One line per session. The first three columns are bookkeeping. **The fourth is the one that matters.**

Surprise means reality diverged from your mental model — precisely where the learning happened. But
hindsight destroys it within hours: once you understand the race condition it becomes obvious, and you
lose access to the version of you who found it baffling. Same day, or not at all.

**Format: a wrong belief you held, and what corrected it** — not "learned about transactions", that's
a topic. Like this:

> Wrapping the booking in BEGIN/COMMIT didn't fix the race at all. I was *certain* it would.
> `SELECT FOR UPDATE` can't lock rows that don't exist yet. Invisible before, obvious after.
> The DST test only failed in Europe/London — every other test I'd written used Asia/Saigon.

That's also the honest answer to "tell me about a hard bug" twelve weeks from now. *"I used exclusion
constraints to prevent double bookings"* sounds memorized; what you believed first, and what broke it,
proves you understood it.

Blank is fine — pure execution is honest data. **Several blank weeks is a signal:** you're
pattern-matching, not learning, and the next milestone should be harder.

| Date | Hrs | Closed | What surprised me |
|---|---|---|---|
|12/10 |  | KAI-001 | |
|14/10 |  | KAI-002 | - compose: `.env` interpolated on host before containers exist; `env_file` vars go to the container process only — never available to `${VAR}`<br/>- Server listens only after first DB query succeeds — readiness before accepting traffic|
|15/10 |  | KAI-004 | |
|17/10 |  | KAI-005, KAI-006 | - routes (= the controller role) => services => repositories <br/>- explicit return types on exported fns = layer contract. Infer module internals |
|18/10 |  | KAI-007 | - `req.headers` keys arrive lowercased<br/>- `process.hrtime.bigint()` must become a number before dividing by 1e6 (ns → ms)<br/>- what's wrong with this logger (→ M8): unstructured, synchronous, no levels, no redaction, inbound X-Request-Id not validated |
|21/10 |  | KAI-008 | |
|24/10 |  | KAI-010 (partial) | |
