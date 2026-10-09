# M0 — Foundations

**~10h · Week 1 · Question: what actually happens between `curl` and a response?**

You will write more code by hand in this milestone than in any other, and almost all of it gets
replaced later. That is intentional. A middleware you wrote yourself is a middleware you can debug at
2am; a middleware you copied from a blog post is a middleware you reinstall and hope.

**Exit condition:** `docker compose up` + `npm run dev` gives you a layered Express app with validated
config, consistent errors, request IDs, and passing tests — and you can explain every line of it.

---

### KAI-001 · CHORE · 1.5h — Project skeleton

Initialize the repo: `package.json`, TypeScript (strict mode, no exceptions), Express 5, `tsx` for
watch-mode dev, ESLint + Prettier. One `GET /health` route returning `{ status: "ok" }`.

**Why this exists.** `strict: true` from the first commit, because retrofitting strictness onto 5,000
lines is miserable and you will simply never do it. Express **5**, not 4 — v5 handles async errors
natively, so a rejected promise in a handler reaches your error middleware instead of hanging the
request forever. In Express 4 that silent hang is the single most common beginner bug, and you get to
skip it entirely.

**Done when:**
- [ ] `npm run dev` hot-reloads on save
- [ ] `npm run build && npm start` runs compiled JS from `dist/`
- [ ] `npm run typecheck` and `npm run lint` both pass
- [ ] `curl localhost:3000/health` returns 200
- [ ] `.gitignore` covers `node_modules`, `dist`, `.env`

**The trap:** `"strict": false` to silence early noise. Every `any` you allow now is a bug you ship in
M5 when the money types stop protecting you.

---

### KAI-002 · CHORE · 1h — Postgres in Docker

`docker-compose.yml` with Postgres 17, a named volume, a healthcheck. Connect from Node with `pg` and
log the result of `SELECT NOW()`.

**Why this exists.** Containerizing the database on day one means your machine stays clean, your
Postgres version matches production exactly, and a teammate — or you, on a new laptop — is running in
one command. The healthcheck matters more than it looks: without it, your app races the database on
startup and fails intermittently, which is a genuinely confusing first bug.

**Done when:**
- [ ] `docker compose up -d` starts Postgres with a persistent volume
- [ ] Data survives `docker compose down && up` (and is destroyed by `down -v` — know the difference)
- [ ] App logs the server time on boot
- [ ] Connection details come from env vars, not literals

**The trap:** running `docker compose down -v` out of habit and wondering where your seed data went.

---

### KAI-003 · SPIKE · 1h — HTTP from first principles

No framework. Write a ~20-line server with `node:http` that parses a JSON body by hand from the raw
stream and returns a response. Then open a raw TCP connection and type an HTTP request manually:

```bash
printf 'GET /health HTTP/1.1\r\nHost: localhost\r\n\r\n' | nc localhost 3000
```

**Why this exists.** Express is a thin wrapper over `node:http`. Once you've assembled a request body
from stream chunks yourself, `express.json()` stops being magic and becomes "the thing that does the
loop I just wrote". This single hour changes how you read every framework for the rest of your career.

**Done when:**
- [ ] Your raw server handles `GET` and `POST` with a JSON body
- [ ] You've sent a request over `nc` and read the raw response bytes
- [ ] Written in `docs/notes/http-basics.md`, in your own words: what `Content-Length` does, why
      `Transfer-Encoding: chunked` exists, and what `req` actually is in Node (hint: a stream)
- [ ] You can answer: why must you read the body asynchronously?

**The trap:** skipping this because it's "not real work". It is the highest leverage hour in M0.

---

### KAI-004 · FEAT · 1h — Validated configuration

A `config.ts` that reads `process.env`, validates it with Zod, and exports a typed frozen object. The
process **exits on boot** if anything is missing or malformed. Include `.env.example`; never commit `.env`.

**Why this exists.** Two bugs die here. First, `process.env.PORT` is `string | undefined` and silently
becomes `NaN` — typed config makes that impossible. Second, and more important: **fail at startup, not
at 3am.** An app that boots with a missing `DATABASE_URL` and dies on the first request is strictly
worse than one that refuses to boot at all, because the first one passes your deploy healthcheck.

**Done when:**
- [ ] Deleting a required env var produces a clear error naming the variable, and exit code 1
- [ ] `config.port` is typed `number`, not `string`
- [ ] Nothing outside `config.ts` reads `process.env` — grep to confirm
- [ ] `NODE_ENV` is a Zod enum, not a free string

**The trap:** `process.env.X!` sprinkled across the codebase. The `!` is you promising the compiler
something you cannot actually guarantee.

---

### KAI-005 · FEAT · 1.5h — Layered architecture

Establish the structure and prove it with one vertical slice (`GET /services` returning hardcoded data
for now):

```
src/
  routes/        parse request, call service, send response — ~10 lines each
  services/      business logic — never imports express
  repositories/  data access — the ONLY place that talks to the database
  domain/        pure functions, types, state machines
  middleware/
  db/
  config.ts
  app.ts         builds the app (exported, for tests)
  server.ts      listens (not imported by tests)
```

**Why this exists.** The `app.ts` / `server.ts` split is what makes Supertest work in KAI-008 — tests
import the app without binding a port. The repository boundary is what makes KAI-018 (swapping raw SQL
for Prisma) a contained change rather than a rewrite. You are buying optionality before you need it,
which is the one time abstraction is actually free.

**Done when:**
- [ ] No file in `services/` imports `express` — grep to confirm
- [ ] No file in `routes/` touches the database
- [ ] `app.ts` exports an app; `server.ts` calls `.listen()`
- [ ] The slice works end to end

**The trap:** "controllers" that are 200 lines of business logic. If a route handler has an `if` about
business rules, it's in the wrong file.

---

### KAI-006 · FEAT · 1.5h — Errors and the response envelope

An `AppError` base class with subclasses (`NotFoundError`, `ValidationError`, `ConflictError`,
`UnauthorizedError`), each carrying an HTTP status and a stable string code. One error-handling
middleware, registered last, that maps them to:

```json
{ "error": { "code": "BOOKING_SLOT_TAKEN", "message": "That slot is no longer available", "details": {} } }
```

Unknown errors become a generic 500 — **log the stack, never return it.**

**Why this exists.** Stable machine-readable `code` values let clients branch on failure without string
matching your prose. Leaked stack traces are an information disclosure vulnerability: they expose file
paths, dependency versions, and sometimes query fragments. And having exactly one place that formats
errors means you change the shape once, not in forty handlers.

**Done when:**
- [ ] Throwing `new NotFoundError('service')` anywhere yields a clean 404
- [ ] An unexpected `throw new Error('boom')` yields 500 with no stack in the body
- [ ] A rejected promise inside an async handler is caught (verify — this is Express 5's gift)
- [ ] Status codes are correct: 400 malformed, 401 unauthenticated, 403 unauthorized, 404 missing,
      409 conflict, 422 semantically invalid
- [ ] You can articulate the difference between 401 and 403, and between 400 and 422

**The trap:** `res.status(500).json({ error: err.message })` as a catch-all. It leaks internals and
tells the client nothing actionable.

---

### KAI-007 · FEAT · 1h — Hand-rolled request logging and request IDs

Write it yourself, no library. Middleware that assigns each request a UUID, stashes it in
`AsyncLocalStorage`, logs method/path/status/duration on completion, and returns it as an
`X-Request-Id` header (reusing an inbound one if present).

**Why this exists.** `AsyncLocalStorage` is the mechanism that makes a request ID available deep in a
service without threading it through every function signature — and it's how every real logging setup
works under the hood. Writing the naive version now means that when Pino replaces it in M8, you'll
recognize exactly which problem each Pino feature solves. The returned header is what lets a user paste
you an ID and have you find their exact request in M8's logs.

**Done when:**
- [ ] Every log line carries the request ID
- [ ] A function three layers deep can read the current ID without being passed it
- [ ] Response includes `X-Request-Id`; an inbound one is honoured rather than replaced
- [ ] Duration measured with `process.hrtime.bigint()`, not `Date.now()`
- [ ] Noted in `docs/notes/`: what's wrong with this logger? (unstructured, synchronous, no levels,
      no redaction — that list is M8's backlog, written by you)

**The trap:** `console.log(JSON.stringify(req.body))` — one day that body contains a password, and now
it's in your log aggregator forever.

---

### KAI-008 · TEST · 1.5h — The testing foundation

Vitest + Supertest. Cover `/health`, a 404 path, a validation failure, and an unexpected error.
Add `npm test` and `npm run test:watch`.

**Why this exists.** Tests written in week 1 are what make weeks 2–12 fast. Specifically: KAI-018 swaps
your entire data layer for Prisma, and the only thing that will tell you whether it still works is a
test suite written before the change. Starting the habit on trivial endpoints means it's automatic by
the time the logic is hard.

**Done when:**
- [ ] Tests import `app.ts`, never start a real server, and need no free port
- [ ] Error-shape assertions check `code`, not message prose
- [ ] Suite runs in under 5 seconds
- [ ] One deliberately broken test proves the suite actually fails (watch it go red, then fix it)

**The trap:** testing implementation instead of behaviour. Assert the response; don't assert that a
particular internal function got called.

---

## Closing M0

- [ ] All eight tickets checked off
- [ ] `docs/notes/http-basics.md` written in your own words
- [ ] Commit history is small and conventional (`feat:`, `chore:`, `test:`)
- [ ] You can explain, out loud: what middleware *is*, why `app`/`server` are split, what
      `AsyncLocalStorage` solves, and why config validation happens at boot

**Log it in `plan.md`.** The "what surprised me" column starts now, while you still remember being
confused — that memory is worth more than the code.
