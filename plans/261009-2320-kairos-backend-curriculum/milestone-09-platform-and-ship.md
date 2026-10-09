# M9 — Platform & Ship

**~12h · Week 12 · Question: how does this become something other people can actually use?**

Everything so far ran on your laptop. This milestone makes it real: a public URL, automated tests
guarding every push, a documented API, a security pass, and a backup you have personally restored.

**Exit condition:** a stranger can read your docs, get an API key, and create a booking against a live
URL — and you can take the database down and bring it back.

---

### KAI-090 · TEST · 2h — The test pyramid, deliberately

Audit what you have. Classify every test as unit, integration, or end-to-end. Then fix the shape:
- **Unit** (many, fast, no I/O) — slot engine, refund policy, state machine, money math
- **Integration** (fewer, real Postgres via Testcontainers) — repositories, constraints, transactions
- **E2E** (few, slow) — register → book → pay → cancel → refund, through the real HTTP API

Add Testcontainers so integration tests spin up a disposable Postgres per run.

**Why this exists.** The shape matters because of feedback speed. A thousand fast unit tests you run on
every save catch most bugs in seconds. A hundred slow integration tests you run before pushing catch the
rest. Invert that — mostly slow tests — and you stop running them, which is strictly worse than not
having them.

Testcontainers deserves its own note. **Mocking the database would have hidden every bug this project
taught you.** The exclusion constraint in KAI-043, the deadlock in KAI-047, the transaction rollback in
KAI-064 — none of those exist against a mock. Testing against a real Postgres is the only way to verify
the behaviour you're actually depending on.

**Done when:**
- [ ] Tests classified; the shape is a pyramid, not an hourglass
- [ ] Integration tests use Testcontainers, no shared local database
- [ ] Each test is isolated (transactional rollback or a fresh schema) and order-independent —
      verify by running in random order
- [ ] Unit suite under 5 seconds; full suite under 2 minutes
- [ ] >80% coverage on `domain/` and `services/`
- [ ] At least one full E2E journey passes

**The trap:** shared mutable test fixtures. Tests pass individually, fail together, and the failure
moves around depending on order. Hours disappear into this.

---

### KAI-091 · CHORE · 1.5h — CI

GitHub Actions on every push: typecheck → lint → unit → integration (with a Postgres service and
migrations applied) → build. Cache dependencies. Fail the build on any step.

**Why this exists.** CI is the mechanism that converts your standards from intentions into facts.
Everything you've enforced by discipline — passing tests, type safety, lint rules, the KAI-019 import
boundary — becomes enforced by a machine that doesn't get tired at 11pm.

Run the **real** migrations against a **real** Postgres in CI. A migration that works locally and fails
on a clean database is a classic deploy-day failure, and the only way to catch it is to run it against a
clean database on every push.

Include KAI-057's ledger invariant test. That one must never be skipped for being slow.

**Done when:**
- [ ] CI runs on push and PR, green on main
- [ ] Integration tests run against a real Postgres service container
- [ ] Migrations run from scratch every time
- [ ] Dependencies cached — total run under 5 minutes
- [ ] Any failing step fails the build; no `continue-on-error`
- [ ] A status badge in the README

---

### KAI-092 · FEAT · 2.5h — The public API

Version everything under `/v1`. Add scoped API keys for partner access: `key_id` + hashed secret,
scopes (`availability:read`, `bookings:write`), per-key rate limits (reusing KAI-076), and a usage log.

**Why this exists.** API keys are a third authentication scheme alongside sessions and JWTs, and they
exist because machines have different needs than humans: long-lived, no refresh flow, revocable
individually, scoped narrowly. Hash them at rest for exactly the KAI-022 reason.

**Scopes are least privilege made concrete.** A partner that only reads availability should hold a key
that *cannot* create a booking — then a leaked key is a much smaller incident. Role-based access would
give them a "partner" role with everything a partner can do; scopes let the key carry less authority
than its owner.

Versioning is a commitment. Once an external partner depends on `/v1`, you cannot change its shape — you
add `/v2` and run both. Think about what that means for your database schema: a column rename is now a
breaking change for somebody, and this is where API design stops being aesthetic and starts being a
contract.

**Done when:**
- [ ] All routes under `/v1`
- [ ] Keys generated with a displayed-once secret, hashed at rest
- [ ] Scopes enforced per endpoint; an out-of-scope call returns 403
- [ ] Per-key rate limits and a usage log
- [ ] Keys are revocable, with immediate effect
- [ ] `docs/notes/api-versioning.md` records your deprecation policy — what you'd promise partners

---

### KAI-093 · DOC · 1h — OpenAPI

Generate an OpenAPI 3.1 spec from your Zod schemas (`zod-to-openapi`). Serve Scalar or Swagger UI at
`/docs`.

**Why this exists.** Generated-from-code is the only kind of documentation that stays true. Hand-written
API docs are accurate on the day they're written and lying within a month — and documentation that lies
is worse than none, because people trust it.

Since your Zod schemas already define both runtime validation and static types (KAI-014), generating the
spec from them means **one definition driving validation, types, and documentation**. Drift becomes
structurally impossible, which is a much stronger guarantee than a review checklist.

**Done when:**
- [ ] Spec generated from Zod schemas, not maintained by hand
- [ ] Every endpoint documented with request, response, and error shapes
- [ ] Auth schemes documented (bearer and API key)
- [ ] Interactive docs at `/docs`, with working examples
- [ ] Spec is valid (run a linter against it)
- [ ] A CI check fails if the committed spec is stale

---

### KAI-094 · SEC · 2h — Security pass

Walk the OWASP API Security Top 10 against your own code, writing a finding or an explicit "not
applicable, because…" for each. Then fix what you find.

Already covered: BOLA (KAI-025), broken auth (M2), injection (KAI-013), SSRF (KAI-066). Still to check:
- **Excessive data exposure** — does any response return fields the client doesn't need? Password
  hashes, internal IDs, other users' emails?
- **Resource consumption** — unbounded `limit` params, giant request bodies, expensive queries with no
  guard
- **Mass assignment** — can a user set `role: 'admin'` by including it in a profile update?
- **Security misconfiguration** — Helmet headers, CORS allowlist (not `*`), stack traces off in prod,
  `X-Powered-By` removed
- **Inventory** — any undocumented, forgotten, or debug endpoints still routable?

Add `npm audit` and a secret scanner to CI.

**Why this exists.** You've fixed vulnerabilities one at a time as they came up; this is the systematic
pass, which finds a different class of problem. **Mass assignment** is the one most likely to bite here:
`prisma.user.update({ data: req.body })` is concise, convenient, and lets anyone make themselves an
admin. Explicit field allowlists are the fix, and the Zod `.strict()` decision from KAI-014 may already
have saved you — go check whether it actually did.

**Done when:**
- [ ] All ten categories assessed in writing in `docs/notes/security-review.md`
- [ ] Every finding fixed or accepted with a documented reason
- [ ] Mass assignment specifically tested — try to escalate your own role
- [ ] Helmet, CORS allowlist, body size limits, request timeouts in place
- [ ] `npm audit` and secret scanning in CI
- [ ] No endpoint returns a password hash or another user's PII — verified by test

---

### KAI-095 · CHORE · 2h — Deploy

Deploy to Fly.io (or Railway): the API, the worker as a separate process, managed Postgres, managed
Redis. Migrations run on deploy via a release command. Secrets in the platform's store, never in the
repo. TLS on a real domain.

**Why this exists.** Deploying is where theoretical decisions become concrete, and the migration
question is the sharpest. During a rolling deploy, **old and new code run simultaneously against one
database.** That makes any destructive migration dangerous: drop a column and the still-running old
version crashes on every request referencing it.

The industry answer is the **expand/contract** pattern, and you should do it once deliberately: add the
new column (expand), deploy code writing to both, backfill, deploy code reading only the new one, then
drop the old column in a later deploy (contract). Three deploys to rename a column — tedious, and the
only way to do it without downtime. Practise it on a real column so the shape is in your hands.

Running the worker as a separate process is the payoff for KAI-061's separation: you can scale API and
worker independently, because they have genuinely different load profiles.

**Done when:**
- [ ] API live on a public HTTPS URL
- [ ] Worker deployed as a separate process; jobs process in production
- [ ] Managed Postgres and Redis, with connection limits respected (see KAI-075)
- [ ] Migrations run automatically on deploy
- [ ] Secrets in the platform store; nothing sensitive in git — verify with the secret scanner
- [ ] Health checks wired to the platform's probes
- [ ] You performed one expand/contract column rename with zero downtime
- [ ] A smoke test runs against production after each deploy

**The trap:** `prisma migrate dev` in production. Use `migrate deploy` — `dev` can reset the database,
and it will, and you will remember that day for a long time.

---

### KAI-096 · CHORE · 1h — Backups, and a real restore

Enable automated daily backups. Then **restore one** into a scratch database, point a local app at it,
and confirm it works. Document the procedure with actual commands and the time it took.

**Why this exists.** An untested backup is a rumour. The failure modes are mundane and common: backups
silently stopped weeks ago, they're missing a table, nobody has credentials, the restore takes six hours
and nobody knew, or the documented command has a typo. Every one of those is discovered at the worst
possible moment unless you rehearse.

Two numbers every engineer should be able to state about their system: **RPO** (recovery point
objective — how much data can we lose?) and **RTO** (recovery time objective — how long until we're
back?). Daily backups mean an RPO of up to 24 hours. Is that acceptable for a system holding payment
records? If not, you need point-in-time recovery, and knowing to ask is the mid-level instinct.

**Done when:**
- [ ] Automated daily backups enabled and verified as actually running
- [ ] You restored a backup into a scratch database and ran the app against it
- [ ] Restore time measured and recorded
- [ ] `docs/notes/disaster-recovery.md` has the exact commands, RPO, and RTO
- [ ] You know what you'd lose in a worst-case failure, in hours
- [ ] Point-in-time recovery evaluated, with a decision and reasoning

---

## Closing M9 — and the project

- [ ] Live URL, CI green, docs published, backups rehearsed
- [ ] A stranger can clone, `docker compose up`, and run in under 5 minutes
- [ ] `README.md` written: what it is, architecture diagram, how to run, what you'd do differently
- [ ] Architecture decision records for the big calls — Prisma adoption, exclusion constraint,
      outbox, ledger design

### The exit exam

Go back to `docs/product-requirements.md` §11 and work the checklist. The last item is the real one:

> Explain, out loud and without notes, why each of these exists: the exclusion constraint, the outbox
> pattern, refresh token rotation, cursor pagination, and the double-entry ledger.

If you can do that — not recite definitions, but explain the *problem each one solves* and what breaks
without it — you are past junior. The code is evidence; the explanation is the qualification.

### Where to go next

Having built this, these are the natural next frontiers, roughly in order of value:

1. **Multi-tenancy** — organizations with staff, shared calendars, row-level security
2. **Event sourcing** — you already have `booking_events`; make it the source of truth and derive state
3. **CQRS read models** — materialized provider dashboards, updated from the outbox
4. **Real-time** — WebSockets for live availability as other customers book
5. **Kubernetes** — if you want the ops track rather than the architecture track

But finish this first. **A deployed, documented, tested system beats three abandoned prototypes**, and
the ability to carry something all the way to done is itself the thing employers are trying to detect.
