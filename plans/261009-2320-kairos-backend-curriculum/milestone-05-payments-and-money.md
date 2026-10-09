# M5 — Payments & Money

**~20h · Weeks 7–8 · Question: how do I move money without ever losing any?**

Money code is different from other code, and the difference is cultural before it's technical. Elsewhere,
an occasional wrong value is a bug to fix next sprint. Here it is money that belonged to someone, and
there is no acceptable error rate.

That shift produces a different way of working: you stop asking "does it work?" and start asking **"what
invariant holds, and what proves it?"** That habit is the most transferable thing in this milestone.

**Exit condition:** a double-entry ledger that balances to zero after any sequence of bookings,
cancellations, refunds, and duplicate webhooks — proven by a test in CI.

---

### KAI-050 · SPIKE · 1.5h — How to represent money

Prove the problem in a REPL, don't just read about it:
```js
0.1 + 0.2                    // 0.30000000000000004
1.005 * 100                  // 100.49999999999999  → rounds to 100, not 101
(0.1 + 0.2).toFixed(2)       // "0.30" — the error is hidden, not gone
```
Then decide and document: integer minor units in `BIGINT`.

**Why this exists.** IEEE-754 doubles cannot represent most decimal fractions, so every float arithmetic
operation on currency carries error. The errors are tiny and they **accumulate** — across a million
transactions you are provably off, and reconciliation becomes impossible. `toFixed()` makes it worse by
hiding the drift behind a clean display.

Three decisions to record now, because retrofitting them is brutal:
- **Minor units** (`150000` = 1,500.00 VND) as `BIGINT`. Integer math is exact.
- **Currency travels with every amount.** A bare number is meaningless; `{ amountMinor, currency }`
  is not. Zero-decimal currencies exist (JPY, VND) — your formatter must know.
- **Rounding is a business rule.** A 15% fee on 1,000 minor units is 150. On 1,001 it's 150.15 — and
  whether that becomes 150 or 151 is a decision someone must make, document, and apply consistently.
  Decide who absorbs the remainder: platform or provider.

**Done when:**
- [ ] You've reproduced float error yourself
- [ ] `docs/notes/money.md` records representation, currency handling, rounding rule, and who eats the
      remainder
- [ ] A `Money` type exists that makes mixing currencies a **compile error**
- [ ] No `number` in the codebase represents currency — grep for `price`, `amount`, `fee`
- [ ] A formatter renders minor units per currency, zero-decimal cases included

**The trap:** `float8`/`REAL` in Postgres for money. Use `BIGINT` minor units (or `NUMERIC` if you must
have decimals — never floating point).

---

### KAI-051 · FEAT · 2h — The payment gateway, behind a port

Define a `PaymentGateway` interface in `domain/`. Two implementations: a `FakeGateway` for tests
(configurable to succeed, fail, delay, or duplicate) and a `StripeGateway` using **test mode only**.

**Why this exists.** The interface is the point. Payment providers are slow, rate-limited, occasionally
down, and impossible to make fail on demand — so testing against the real one is both unreliable and
incomplete. A fake you control lets you test the paths that matter most: timeout mid-charge, webhook
before API response, duplicate delivery, declined card.

This is the **ports and adapters** pattern, and payments are where its value is most obvious. Your
business logic depends on an interface you own, not on Stripe's SDK — which means swapping providers is
a new adapter, not a rewrite.

**Done when:**
- [ ] `PaymentGateway` interface defined in domain terms, not Stripe's vocabulary
- [ ] `FakeGateway` can be told to fail, delay, or duplicate
- [ ] `StripeGateway` works against test keys; live keys are impossible to configure by accident
- [ ] Tests use the fake; one smoke test hits Stripe test mode
- [ ] Secrets in env only, never in the repo

**The trap:** letting Stripe types leak into services. The moment a service imports `Stripe`, the
abstraction is gone and so is your ability to test failure modes.

---

### KAI-052 · FEAT · 2.5h — Idempotency keys

`POST /bookings` and payment creation accept an `Idempotency-Key` header. Store
`(key, user_id, request_hash, response, status)`. A replayed key returns the original response without
re-executing. A key reused with a *different* body is a 422 — that's a client bug worth surfacing loudly.

Handle the concurrent case: two requests with the same key arriving simultaneously. One proceeds, the
other waits or returns 409 `IDEMPOTENT_REQUEST_IN_PROGRESS`. (A unique index on `key` plus the
constraint-violation handling from KAI-043 is the clean approach.)

**Why this exists.** Networks fail *after* the server has done the work. The client sees a timeout, has
no idea whether the charge happened, and retries — which is the correct client behaviour. Idempotency is
what makes that retry safe, and without it, every flaky connection is a potential double charge.

The `request_hash` check catches a subtle, genuinely dangerous bug: a client that reuses a key with a
different payload. Returning the cached response would silently ignore the new request; the 422 makes
the mistake visible.

**Done when:**
- [ ] Same key + same body → identical response, one booking created
- [ ] Same key + different body → 422 with a clear code
- [ ] Concurrent same-key requests handled without duplication
- [ ] Keys expire (24h) — a cleanup job, or just a TTL index
- [ ] Only successful and client-error responses are cached; **5xx is not cached**, so a retry can
      actually succeed. Think about why that asymmetry is necessary.

**The trap:** caching the response *before* the operation completes. Then a crash mid-operation leaves a
cached success for work that never happened.

---

### KAI-053 · INCIDENT · 2h — "I was charged twice for one lesson"

> **Ticket from support.** Customer Minh reports two charges of 400,000 VND for a single booking. Our
> records show two `payments` rows, 1.2 seconds apart, same booking, same card, both succeeded.
> Minh says the page "hung and I clicked again".

**Your job:**
1. Reproduce: fire two identical requests 1 second apart with **no** idempotency key.
2. Trace exactly which guard was missing.
3. Fix: make the idempotency key *required* on payment creation; reject requests without one.
4. Reconcile: write a script that finds duplicate charges and refunds the extra, through the ledger.
5. Then handle the harder variant: the client sends the same key but the first request is **still in
   flight**. Verify your KAI-052 concurrency handling actually covers this.

**Why this exists.** Duplicate charges are the most common serious payment bug in production, and the
cause is rarely exotic — it's a user double-clicking a hung button. Treating the client as unreliable
by default isn't cynicism, it's accuracy: clients retry, networks duplicate, users click twice.

Step 4 matters as much as step 3. Real incidents require **remediating the damage already done**, not
just stopping the bleeding. Writing a reconciliation script that corrects historical data — correctly,
idempotently, through the ledger rather than around it — is a skill most developers first exercise under
severe pressure. Doing it calmly here is worth a great deal.

**Done when:**
- [ ] Reproduced, then prevented
- [ ] Idempotency key required on payment creation; missing → 400
- [ ] `scripts/reconcile-duplicate-charges.ts` finds and refunds duplicates idempotently
- [ ] The in-flight-duplicate case is handled and tested
- [ ] `docs/notes/incident-double-charge.md` written as a real postmortem: timeline, root cause,
      remediation, prevention — no blame, just mechanism

---

### KAI-054 · FEAT · 3h — Webhooks that survive reality

Receive gateway webhooks. Four non-negotiables:
1. **Verify the signature** against the raw body — before parsing, before trusting anything.
2. **Replay protection** — store `event_id`; a seen event returns 200 and does nothing.
3. **Order independence** — `payment.succeeded` may arrive *before* your API call returns, and
   `charge.refunded` may arrive before `payment.succeeded`.
4. **Respond fast** — acknowledge in under 5 seconds; do real work asynchronously (M6 makes this real;
   for now, keep the handler lean).

**Why this exists.** Webhooks are an untrusted public endpoint that moves money. Signature verification
is the only thing standing between you and anyone on the internet confirming their own bookings for
free.

The subtlety that catches people: **verify against the raw body bytes.** `express.json()` parses and
discards the original, and re-serializing produces different bytes (key order, whitespace), so the
signature fails. You need `express.raw()` on this route specifically — and discovering that yourself is
instructive.

Order independence is the one tutorials ignore. Gateways deliver at-least-once with no ordering
guarantee, so your handler must be **commutative**: processing refund-then-success must reach the same
final state as success-then-refund. Design for the state you're in, not the sequence you expected.

**Done when:**
- [ ] Signature verified against raw bytes; invalid → 401, logged
- [ ] Replayed `event_id` → 200, no side effect (test by sending the same event 5 times)
- [ ] Out-of-order delivery reaches correct final state — test both orders explicitly
- [ ] An event for an unknown booking is handled gracefully, not a 500
- [ ] Handler responds in <100ms; heavy work deferred
- [ ] Unhandled event types return 200 (don't make the gateway retry things you ignore)

**The trap:** returning 500 for an event you don't recognize. The gateway retries with backoff, your
error rate climbs, and eventually it disables your endpoint entirely.

---

### KAI-055 · FEAT · 3h — The double-entry ledger

Every money movement writes **two or more** `ledger_entries` rows summing to zero.

```
Customer books a 400,000 VND lesson (15% platform fee):
  customer_source    -400000
  provider_payable   +340000
  platform_fee        +60000
                     ────────
                           0
```

Accounts: `customer_source`, `provider_payable`, `platform_fee`, `refund_sink`. Entries are
**append-only** — never updated, never deleted. A correction is a new reversing entry.

**Why this exists.** The naive design is a `balance` column on `providers` that you increment. It works
until the first bug, and then you have a wrong number and *no way to find out why*. With a ledger, the
balance is derived (`SUM(amount) WHERE account = 'provider_payable' AND provider_id = …`) and every
component is attributable to a specific event.

Append-only is what makes it trustworthy. If entries could be edited, the history is just a mutable
cache. Reversing entries mean mistakes are **visible and auditable** rather than erased — which is what
accountants have required for six centuries, and they were right.

The zero-sum invariant is the gift: it makes a whole class of bugs **detectable automatically**. You
cannot lose money without the sum going non-zero, and KAI-057 turns that into a test.

**Done when:**
- [ ] Every movement writes balanced entries in one transaction
- [ ] Entries are immutable — enforced by a database rule or trigger, not convention
- [ ] Provider balance is derived by query, never stored
- [ ] Each entry references its cause (`booking_id`, `payment_id`, `event_type`)
- [ ] `docs/notes/ledger.md` shows worked examples: booking, full refund, partial refund, no-show
- [ ] Fee rounding follows KAI-050's documented rule, and the remainder has an owner

**The trap:** a mutable `balance` column "for performance". If you genuinely need it later, make it a
cache that a background job recomputes and reconciles — never the source of truth.

---

### KAI-056 · FEAT · 2.5h — Cancellation policy and refunds

Tiered policy, configurable per provider: >48h → 100%, 24–48h → 50%, <24h → 0%. Plus: provider-initiated
cancellation always refunds 100%; `no_show` refunds nothing.

Implement the policy as a **pure function** — `(booking, cancelledAt, policy) => RefundAmount` — and the
execution as ledger entries plus a gateway refund call.

**Why this exists.** Separating *policy* from *execution* is the design lesson. The policy is a pure
function, so every boundary gets a test: exactly 48h, one second either side, a booking already started,
a booking in the past. Those boundaries are where disputes come from.

The execution side raises a hard ordering question worth thinking through: do you write ledger entries
first, or call the gateway first? Neither is safe alone — the gateway call can succeed while your
transaction rolls back, or your transaction commits while the gateway call fails. This is exactly the
problem KAI-058 addresses, and feeling the tension here makes that ticket land.

**Done when:**
- [ ] Policy is pure and exhaustively tested at every boundary
- [ ] Tier boundaries tested to the second
- [ ] Partial refunds produce correct balanced entries
- [ ] Refunds go through the state machine (KAI-045) — a double refund is structurally impossible
- [ ] Refunds are idempotent — a replayed refund webhook doesn't refund twice
- [ ] Per-provider policy overrides work; a sensible default applies when unset

---

### KAI-057 · TEST · 1.5h — The invariant test

A property-style test: generate a few hundred random operations (book, cancel at random times, refund,
no-show, duplicate webhooks, concurrent bookings) against a real database. After every operation,
assert:

```sql
SELECT SUM(amount_minor) FROM ledger_entries;  -- must be exactly 0
```

Plus: no provider balance is negative; every `confirmed` booking has exactly one successful payment; no
booking has refunds exceeding its price.

**Why this exists.** This is the most valuable test in the project and a genuinely different *kind* of
test. Example-based tests check cases you thought of. An invariant test checks a property that must hold
across **every sequence**, including ones you'd never think to write — and random sequences find the
interleavings your imagination doesn't.

When it fails, print the operation sequence that broke it. That reproduction is the whole value.

**Done when:**
- [ ] Runs 500+ random operations against a real Postgres
- [ ] Asserts all four invariants after every operation
- [ ] Failures print the exact reproducing sequence
- [ ] Runs in CI (M9) — this one must never be skipped
- [ ] It found at least one real bug (it very likely will)

**The trap:** making the generator too tame. Include illegal operations, duplicates, and concurrency —
the value is in sequences you wouldn't write by hand.

---

### KAI-058 · SPIKE · 2h — When payment succeeds but booking fails

Force the failure: `FakeGateway` charges successfully, then the booking confirmation transaction throws.
You now hold money for a booking that doesn't exist.

Work through the options and implement one:
1. **Compensating transaction** — detect and automatically refund.
2. **Retry forward** — persist intent, retry confirmation until it succeeds.
3. **Manual reconciliation queue** — flag it for a human.

**Why this exists.** This is the two-generals problem in miniature, and it's unavoidable the moment two
systems must agree. **There is no way to make a database write and an HTTP call atomic.** No clever
ordering fixes it; you can only choose which failure you prefer and how you detect it.

The transferable insight: at the boundary between systems, you choose between **at-most-once** (risk
losing work) and **at-least-once** (risk duplicating it). There is no third option. Payments choose
at-least-once plus idempotency — which is why KAI-052 is load-bearing for this ticket.

Whichever strategy you pick, you need **detection**: a reconciliation job comparing gateway state to
yours, surfacing anything that diverges. Money systems always have one.

**Done when:**
- [ ] You forced the failure and observed the orphaned charge
- [ ] A strategy is implemented, with its reasoning in `docs/notes/saga-compensation.md`
- [ ] `scripts/reconcile-payments.ts` finds charges without confirmed bookings
- [ ] The compensating path is tested, including the case where **compensation itself fails**
- [ ] You can explain at-most-once vs at-least-once and why exactly-once is a comfortable fiction

---

## Closing M5

- [ ] Ledger balances to zero after 500 random operations
- [ ] Duplicate charges impossible — key required, replays safe
- [ ] Webhooks survive replay, reordering, and forgery attempts
- [ ] You can explain: why not floats, why double-entry, why idempotency, why exactly-once is a myth
- [ ] Two postmortems written in `docs/notes/`

**Log it in `plan.md`.**

> **This is the cut line.** M0–M5 is a genuinely strong portfolio project and covers the two hardest
> topics in backend work. If you stop here, you've got something real. M6–M9 are what make you useful
> on an on-call rotation.
