# M2 — Identity & Access

**~10h · Week 3 · Question: how do I know who you are, and what you're allowed to touch?**

Authentication is a solved problem that is still got wrong constantly, because the failure modes are
invisible until someone exploits them. You will build it from primitives and attack your own
implementation twice.

**Exit condition:** registration, login, token rotation with reuse detection, and an authorization
layer that distinguishes *role* from *ownership* — with tests proving a user cannot read another
user's data.

---

### KAI-020 · FEAT · 1.5h — Password hashing

Register and store credentials using **Argon2id** (`argon2` package). Tune memory/time cost so a single
hash takes roughly 100–250ms on your machine, and record the parameters you chose.

**Why this exists.** The counter-intuitive core of password hashing: **you want it slow.** SHA-256 is a
catastrophic choice precisely because it's fast — a GPU does billions per second, so a leaked table of
SHA-256 hashes is a leaked table of passwords. Argon2id is deliberately memory-hard, which blunts GPU
and ASIC attacks in a way bcrypt can't. The salt (which Argon2 embeds in its output string) is what
stops one rainbow table from cracking every user at once.

**Done when:**
- [ ] Passwords stored as Argon2id hashes; plaintext appears in no log, no error, no response
- [ ] One hash takes 100–250ms — measure it
- [ ] Chosen parameters recorded in `docs/notes/password-hashing.md` with reasoning
- [ ] Verification uses the library's compare function, never `===`
- [ ] You can explain why a slow hash is a feature, and what "memory-hard" buys over bcrypt

**The trap:** a fast hash because login "felt sluggish". 250ms is invisible to a user and ruinous to an
attacker. That asymmetry is the entire design.

---

### KAI-021 · SPIKE · 1h — Sessions vs JWT: decide, then commit

Write up both. Server-side sessions (opaque ID in a cookie, state in Postgres/Redis) versus stateless
JWTs. Cover: revocation, horizontal scaling, payload size, XSS/CSRF exposure, and where each is stored.

**Why this exists.** "Use JWT" is cargo cult — JWTs have a real, serious drawback that tutorials skip:
**you cannot revoke them.** A stateless token is valid until it expires, so a banned user keeps their
access. The industry answer — short access tokens plus a revocable refresh token — is a *compromise*,
and understanding which problem each half solves is what makes the next ticket make sense.

**Done when:**
- [ ] `docs/notes/auth-decision.md` compares both honestly, with a decision and its reasoning
- [ ] You can answer: why can't you revoke a JWT? (the server stores nothing to revoke)
- [ ] You know why `localStorage` is XSS-exposed and `httpOnly` cookies are CSRF-exposed — and what
      mitigates each
- [ ] **Decision for this project:** 15-minute access token (JSON body) + 30-day refresh token
      (httpOnly, Secure, SameSite=Strict cookie), rotated on every use

---

### KAI-022 · FEAT · 2h — Register, login, refresh, logout

Four endpoints. Access tokens are signed JWTs with a short TTL. Refresh tokens are **random opaque
strings, hashed before storage** (treat them exactly like passwords), tracked in a `refresh_tokens`
table with a `family_id`, and **rotated** — every refresh issues a new token and marks the old one used.

**Why this exists.** Rotation shrinks the window a stolen refresh token is useful. The `family_id` is
what makes KAI-023's reuse detection possible: tokens descended from one login share a family, so
revoking the family logs out exactly that one compromised session and nothing else.

**Done when:**
- [ ] Register rejects duplicate emails without revealing that the email exists
- [ ] Login returns an access token and sets the refresh cookie
- [ ] Refresh rotates: old token invalid, new token issued, same family
- [ ] Logout revokes the entire family
- [ ] Refresh tokens are hashed at rest — a database leak doesn't hand over live sessions
- [ ] Expired tokens are rejected with a distinguishable error code so clients know to refresh

**The trap:** storing refresh tokens in plaintext. If they're in the database unhashed, a read-only SQL
injection becomes full account takeover for every user at once.

---

### KAI-023 · BUG · 1h — Attack your own tokens

Three deliberate vulnerabilities. Introduce each, exploit it, fix it, write it down.

1. **`algorithm: 'none'`** — verify without specifying allowed algorithms, then forge an unsigned token.
2. **No expiry** — issue a token with no `exp` and watch it work forever.
3. **Missing reuse detection** — use a rotated refresh token twice and keep your session alive after
   "logout".

**Why this exists.** Same principle as KAI-013: forging an admin token by hand, against your own
running server, builds a reflex that reading about `alg: none` never will. Fix #3 by detecting reuse of
an already-rotated token and revoking the whole family — **that is the mechanism that makes token theft
survivable**, because the attacker's use of the stolen token kicks out both of you, and the legitimate
user notices and re-authenticates.

**Done when:**
- [ ] You forged a valid-looking token with `alg: none` and the server accepted it
- [ ] Fixed: verification pins `algorithms: ['HS256']` explicitly
- [ ] Fixed: `exp` is mandatory and verified
- [ ] Fixed: reusing a rotated refresh token revokes the family and returns 401
- [ ] `docs/notes/jwt-attacks.md` records each attack, the fix, and why it works

---

### KAI-024 · FEAT · 1h — Authentication middleware

`requireAuth` middleware: extract the bearer token, verify, load the user, attach to the request.
Extend Express's `Request` type properly — no `as any`.

**Why this exists.** The TypeScript declaration merging needed to add `req.user` cleanly is a small
puzzle worth solving once. And placing this in middleware rather than in each handler means an endpoint
is protected by *registration*, not by a developer remembering — the same principle as KAI-019.

**Done when:**
- [ ] `req.user` is typed, with no casts
- [ ] Missing/malformed/expired tokens each return 401 with distinct codes
- [ ] An optional variant exists for endpoints that behave differently when logged in
- [ ] Protected routes are protected by router-level registration, not per-handler calls

---

### KAI-025 · FEAT · 2h — Authorization: role *and* ownership

Two independent checks:
- **Role:** is this user a provider? an admin?
- **Ownership:** is this *that provider's* service? *that customer's* booking?

Implement `requireRole(...)` middleware and a policy module (`can(user, 'cancel', booking)`) for
ownership. Then demonstrate the vulnerability: with `requireAuth` but no ownership check, log in as
user A and `GET /services/{B's-id}` — or `DELETE` it.

**Why this exists.** This is **OWASP API Security #1: Broken Object Level Authorization**, and it is
the most common serious vulnerability in real APIs. It happens because authentication *feels* like it
finished the job: the user is logged in, the endpoint is protected, everything looks right. But "you
are logged in" says nothing about "this row is yours." Conflating the two is how a logged-in user reads
every other user's data by incrementing an ID.

This is also why UUIDs beat sequential IDs — not as a security control (obscurity isn't security), but
because sequential IDs make the exploit trivially enumerable instead of merely possible.

**Done when:**
- [ ] You exploited the missing check as one user against another's data
- [ ] Ownership verified by querying *scoped to the user*, not by fetching then comparing in JS
- [ ] Role and ownership are separate, composable checks
- [ ] Unauthorized access returns **404, not 403**, for resources the user shouldn't know exist —
      and you can explain why that choice prevents enumeration
- [ ] Tests cover: wrong user, wrong role, right user right role, unauthenticated

**The trap:** `if (resource.ownerId === req.user.id)` after an unscoped fetch. It works, but one
forgotten check anywhere leaks data. Prefer `WHERE owner_id = $1` in the query — then forgetting it
returns nothing rather than returning someone else's row.

---

### KAI-026 · SEC · 1h — Rate limit authentication (the broken version)

Hand-roll a fixed-window limiter in a `Map`: 5 login attempts per IP per 15 min, and a separate
per-account limit. Return 429 with `Retry-After`.

**Why this exists.** Without this, your login endpoint is an offline password cracker with an HTTP
interface. The per-account limit matters independently of per-IP: a distributed attack spreads across
thousands of IPs but still targets one account.

Now the deliberate flaw, which you will fix in M7: **this limiter lives in one process's memory.** Run
two instances and the effective limit doubles. Restart the process and every counter resets. That is
precisely the problem Redis solves — and meeting the problem before the solution is the whole method.

**Done when:**
- [ ] Six rapid failed logins return 429 with `Retry-After`
- [ ] Per-IP and per-account limits are separate
- [ ] A successful login resets that account's counter
- [ ] `docs/notes/rate-limiting.md` records *why this implementation is wrong* — multi-instance,
      restart amnesia, memory growth with no eviction, and fixed-window burst at the boundary
      (10 requests at 14:59:59 and 15:00:01 pass a "5 per 15 min" rule — think about why)

---

### KAI-027 · TEST · 1h — The auth test suite

Integration tests covering every path: happy login, wrong password, unknown email, expired token,
forged token, rotated-token reuse, cross-user access, role failure, rate limit.

**Why this exists.** Auth is the code most dangerous to change and most likely to need changing. These
tests are what let you refactor it in month two without fear — and writing the attack cases as tests
means a regression that reopens KAI-023's holes fails CI instead of reaching production.

**Done when:**
- [ ] Every KAI-023 attack has a test asserting it now fails
- [ ] A test proves user A cannot read user B's resource
- [ ] A helper mints authenticated requests so later milestones' tests stay readable
- [ ] Tests use a real database (via transactional rollback or a per-test schema), not mocks

---

## Closing M2

- [ ] Registration, login, rotation, logout all working and tested
- [ ] You have personally forged a token and stolen another user's data — then closed both holes
- [ ] You can explain: why slow hashing, why rotation, why reuse detection revokes a family, and why
      role ≠ ownership
- [ ] `docs/notes/auth-decision.md` would convince a skeptical reviewer

**Log it in `plan.md`.** Next milestone is the hardest pure-logic work in the project.
