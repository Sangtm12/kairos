# 003 - HTTP basics

- `req` in Node is an `http.IncomingMessage` = a readable stream. Headers are parsed up front; the body is not — it arrives as chunks
- body must be read async: bytes come off the socket over time, so collect chunks on `data`, join + `JSON.parse` on `end`. `express.json()` is exactly that loop + size limit + error on bad JSON
- `Content-Length`: byte count of the body — how the receiver knows where this message ends and the next one on the same keep-alive connection begins
- `Transfer-Encoding: chunked`: for when the sender doesn't know the length up front (streaming). Each chunk is prefixed with its size; a 0-size chunk ends the body
- raw request over TCP: `printf 'GET /health HTTP/1.1\r\nHost: localhost\r\n\r\n' | nc localhost 3000` — HTTP/1.1 is just text: request line, headers, blank line (`\r\n\r\n`), body

# Docker

- compose: .env interpolated on host before containers exist; env_file vars go to the container process only — never available to ${VAR}
- Server listens only after first DB query succeeds — readiness before accepting traffic

# Layered architecture

- routes (= the controller role) => services => repositories
- explicit return types on exported fns = layer contract. Infer module internals

# 007 - request logging

- `req.headers` keys arrive lowercased in Node, whatever case the client sent (`req.get()` is case-insensitive)
- `process.hrtime.bigint()` returns a bigint — convert with `Number()` before dividing by 1e6 (ns → ms)
- what's wrong with this logger (→ M8): unstructured, synchronous, no levels, no redaction, inbound X-Request-Id not validated

# M0 recap - explain out loud

- middleware = `(req, res, next)` function in a chain; each one does its bit then calls `next()`, or ends the response. Error middleware has 4 args `(err, req, res, next)` and is registered last
- `app` / `server` split: `app.ts` builds the Express app with no side effects, `server.ts` connects the DB, listens, handles signals. Tests import `app` into Supertest — no port, no DB boot
- `AsyncLocalStorage`: per-request context (requestId) that follows the async call chain, so any code can read it without passing `req` through every function
- config validated at boot: fail fast with a clear error on startup, instead of a `undefined` blowing up on the first request that happens to use it

# 010 - migrations

- node-pg-migrate records applied migrations in the `pgmigrations` table; `migrate:up` only runs files not in it → running it twice is a no-op
- forward-only: once a migration has run anywhere shared, never edit it — write a new one. Editing means each DB has a different schema history and they silently diverge
- `down` is often a lie in production: dropping a column/table destroys data that `up` can't bring back, and other code may already depend on the new shape. Real rollback = a new forward migration
- never `ALTER TABLE` by hand in `psql` — the migration history stops describing the real schema
