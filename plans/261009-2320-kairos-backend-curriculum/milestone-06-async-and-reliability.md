# M6 — Async & Reliability

**~12h · Week 9 · Question: how does work happen after the response is sent?**

Redis finally arrives — not because the architecture diagram called for it in week 1, but because by
now you have a `setInterval` sweeper that double-processes across instances (KAI-046), an email send
sitting on the request path, and a webhook handler that must respond in under five seconds while doing
real work. You have the problems. Now you get the tool.

**Exit condition:** nothing slow happens on the request path, no event is ever lost to a rolled-back
transaction, and every job survives being run twice.

---

### KAI-060 · CHORE · 1h — Redis in compose

Add Redis 7 to `docker-compose.yml` with a healthcheck and persistence configured deliberately. Connect
with `ioredis`. Add it to config validation (KAI-004) so a missing URL fails at boot.

**Why this exists.** One decision deserves thought rather than a default: **persistence.** Redis offers
RDB snapshots (periodic, fast, lossy) and AOF (append-only log, slower, durable). For a cache, losing
data on restart is fine. For a **job queue holding a customer's confirmation email**, it is not.
Choose per use case and write down why — and note that this is the first time in the project you've
had data whose durability requirements differ by purpose.

**Done when:**
- [ ] Redis up with a healthcheck; app connects on boot
- [ ] Persistence mode chosen and justified in `docs/notes/redis-setup.md`
- [ ] Connection failure is handled — does your API still serve reads if Redis is down? Decide.
- [ ] Redis URL validated in config

**The trap:** treating Redis as always-available. It restarts, it evicts, it fills up. Decide now what
degraded mode looks like.

---

### KAI-061 · FEAT · 2.5h — The first real queue

Install BullMQ. Create an `email` queue. Move booking-confirmation email off the request path: the
handler enqueues a job and returns immediately. Add a separate worker process (`worker.ts`) that shares
your services layer but has its own entry point.

**Why this exists.** The request path should contain only what the user is waiting for. An email send
is 200–2000ms of latency that benefits the user not at all — and worse, if the email provider is down,
your *booking* fails. Coupling a critical write to a non-critical side effect is a reliability bug.

Note what the separate worker process demonstrates: the same services, a different entry point. That
only works because of KAI-005's layering — services don't know about `express`, so they don't care
whether a HTTP request or a job invoked them. This is the first time that discipline visibly pays off.

Now revisit `docs/notes/naive-scheduler.md` from KAI-046 and check off what the queue solved: multi-
instance coordination, restart durability, visibility, manual retry. Keep that list open — not
everything is fixed yet.

**Done when:**
- [ ] `POST /bookings` returns without waiting on email
- [ ] Worker runs as a separate process, started independently
- [ ] Jobs survive an API restart (they're in Redis, not memory)
- [ ] Failed jobs are visible — add Bull Board or query the queue directly
- [ ] Worker shares `services/`; no business logic is duplicated
- [ ] Response time for `POST /bookings` measurably dropped — record before/after

---

### KAI-062 · SPIKE · 1h — At-least-once, and what it demands of you

Prove it to yourself: make a job handler throw *after* its side effect. Watch BullMQ retry. Watch the
side effect happen twice.

Then write down the rule: **queues guarantee at-least-once delivery; the handler must be idempotent.**

**Why this exists.** "Exactly-once delivery" is marketing. A worker can crash between doing the work and
acknowledging the job — the queue cannot distinguish that from a worker that crashed before doing it, so
it redelivers. The only correct response is handlers that are safe to run repeatedly.

This is the same lesson as KAI-054 (webhook replays) and KAI-052 (idempotency keys), arriving from a
third direction. That repetition is the point: **idempotency is the central idea in distributed
systems**, and by now you should be reaching for it reflexively.

Practical techniques: a dedupe key checked before the side effect; a conditional write (`UPDATE … WHERE
status = 'pending'`); or making the operation naturally idempotent (`SET x = 5`, not `SET x = x + 1`).

**Done when:**
- [ ] You caused and observed a duplicate side effect
- [ ] `docs/notes/at-least-once.md` explains why exactly-once is impossible and lists the techniques
- [ ] Every existing handler is audited for idempotency; the unsafe ones are fixed
- [ ] The email handler won't send twice for the same booking — tested by running the job twice

---

### KAI-063 · FEAT · 2h — Retries, backoff, and the dead-letter queue

Configure exponential backoff with jitter, 5 attempts, then route to a DLQ. Build a tiny admin endpoint
to list DLQ jobs and replay one.

**Why this exists.** Most job failures are transient — a timeout, a brief provider outage, a deploy
restarting a pod. Retrying fixes them for free. But three details separate a working retry policy from
a harmful one:

- **Exponential, not fixed.** Retrying every second against a struggling service is a denial-of-service
  attack you wrote yourself.
- **Jitter.** Without it, 500 jobs that failed together retry together, forever, in a synchronized
  thundering herd.
- **A DLQ with a bound.** Infinite retries hide permanent failures — a job with a genuine bug retries
  until someone notices the queue depth, which may be never. A DLQ turns a silent loop into a visible,
  inspectable list.

**Done when:**
- [ ] Exponential backoff with jitter configured
- [ ] Jobs exhausting retries land in the DLQ with their full error history
- [ ] DLQ is listable and a job is replayable
- [ ] Permanent failures (invalid email address) fail fast rather than retrying 5 times — distinguish
      retryable from non-retryable errors
- [ ] `docs/notes/retry-policy.md` records the numbers and the reasoning behind them

**The trap:** retrying non-retryable errors. A 400 from an API will be a 400 every time; retrying it
wastes capacity and delays the DLQ signal that something is actually wrong.

---

### KAI-064 · FEAT · 3h — The transactional outbox

Find the bug first. In KAI-061, `POST /bookings` does roughly this:

```ts
await withTransaction(async (tx) => {
  const booking = await bookingRepo.create(tx, data);
  await emailQueue.add('confirmation', { bookingId: booking.id });   // ← outside the transaction
  return booking;
});
```

Two failure modes, both real:
- Transaction **rolls back** after the job is enqueued → email sent for a booking that doesn't exist.
- Process **crashes** between commit and enqueue → booking exists, email never sends, silently.

Fix with an outbox: write an `outbox_events` row **inside the same transaction** as the state change. A
poller (or `LISTEN/NOTIFY`) drains it into the queue and marks it dispatched.

**Why this exists.** This is the same impossibility as KAI-058 — you cannot atomically write to Postgres
and Redis — but with a clean solution available, because the outbox turns a cross-system problem into a
single-system one. Both writes go to Postgres, so the transaction covers both. The queue becomes a
*derived* system fed by committed facts.

The key reframe: **the database is the source of truth about what happened; the queue is just a delivery
mechanism.** Once you see it that way, the design is obvious — and you'll recognize the pattern
everywhere, because it's how event-driven systems avoid lying.

You already have most of it. `booking_events` from KAI-045 is written transactionally with every state
change. The outbox is that idea generalized.

**Done when:**
- [ ] `outbox_events` written in the same transaction as the state change
- [ ] A rolled-back booking enqueues nothing — tested by forcing a rollback
- [ ] Poller drains reliably, marks dispatched, and is safe to run on multiple instances (`FOR UPDATE
      SKIP LOCKED` — look it up, it's the right tool and worth knowing)
- [ ] A crash between dispatch and mark causes a duplicate, not a loss — and the handler tolerates it
- [ ] Poll interval is tuned, or `LISTEN/NOTIFY` makes it near-instant
- [ ] `docs/notes/outbox.md` explains the pattern and why dual writes are unsafe

**The trap:** marking the event dispatched *before* enqueueing. Then a crash in between loses it
permanently — and losing is always worse than duplicating, given you've built idempotent handlers.

---

### KAI-065 · FEAT · 1.5h — Scheduled work, properly

Two jobs onto BullMQ's scheduler:
1. **Booking reminders** — 24h before start, cancelled if the booking is cancelled.
2. **Hold expiry** — migrate the KAI-046 `setInterval` sweeper to a repeatable job, then **delete the
   old sweeper**.

**Why this exists.** Close the loop opened in KAI-046. Open `docs/notes/naive-scheduler.md` and check off
each problem: multi-instance double-processing (gone — Redis coordinates), restart amnesia (gone —
state is in Redis), silent death on exception (gone — failures are visible and retried), no history
(gone — completed and failed jobs are inspectable).

The reminder job teaches a distinct skill: **scheduling work that may need cancelling.** Give the job a
deterministic ID (`reminder:{bookingId}`) so cancellation is a removal by known key rather than a search.
Then handle the race anyway — the job may already be running when the cancellation arrives, so the
handler must re-check the booking's current state before sending. **Defence in depth: cancel the job
*and* verify at execution time.**

**Done when:**
- [ ] Reminders fire ~24h before start, in the customer's timezone
- [ ] Cancelling a booking removes its pending reminder
- [ ] The handler re-checks booking status before sending, regardless
- [ ] Hold expiry runs as a repeatable job; `setInterval` is deleted from the codebase
- [ ] Two API instances no longer double-process — verify by running two
- [ ] A booking created less than 24h out doesn't schedule a reminder in the past

---

### KAI-066 · FEAT · 1h — Outbound webhooks

Let providers register a URL for `booking.created`, `booking.cancelled`, `payment.succeeded`. Sign each
delivery with HMAC-SHA256, include a timestamp, retry on failure, and record delivery attempts.

**Why this exists.** You've been a webhook *consumer* since KAI-054; now be the producer, and the
requirements you imposed on Stripe become requirements on you. Sign payloads so receivers can verify.
Include a timestamp in the signed content so an attacker can't replay a captured delivery. Retry with
backoff. Record attempts so a provider debugging their integration can see what you actually sent.

One new concern that only appears on this side: **SSRF.** A provider-supplied URL is attacker-controlled
input. If someone registers `http://169.254.169.254/latest/meta-data/`, your server will dutifully fetch
cloud credentials and POST your data at them. Validate the URL, block private IP ranges, and resolve DNS
before connecting (a hostname can resolve to a private address). This is a real, frequently-exploited
vulnerability class.

**Done when:**
- [ ] Providers register and verify a webhook URL
- [ ] Deliveries are HMAC-signed, timestamp included in the signed payload
- [ ] Failures retry with backoff; attempts are recorded and inspectable
- [ ] Private/loopback/link-local addresses are rejected, **after** DNS resolution
- [ ] Delivery timeout is short (5s) — a slow receiver must not back up your queue
- [ ] You tested against a real receiver (webhook.site or a local endpoint)

**The trap:** validating the URL string without resolving it. `http://internal.evil.com` can resolve to
`127.0.0.1`, and your allowlist never noticed.

---

## Closing M6

- [ ] No slow work on the request path
- [ ] No event lost to a rolled-back transaction
- [ ] Every handler is idempotent and you can say why for each
- [ ] The `setInterval` sweeper is gone and you can enumerate what replaced it
- [ ] You can explain: at-least-once, why exactly-once is impossible, the outbox pattern, and
      `FOR UPDATE SKIP LOCKED`

**Log it in `plan.md`.**
