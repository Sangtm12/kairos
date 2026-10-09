# M8 — Observability

**~8h · Week 11 · Question: it's broken in production and you can't reproduce it. Now what?**

The shortest milestone and one of the most career-relevant. Up to now, debugging meant adding a
`console.log` and re-running. In production you cannot re-run, you cannot attach a debugger, and the
user who hit the bug is already gone. Everything you'll ever know about that failure had to be recorded
*while it was happening*.

Observability is the discipline of recording enough, in advance, to answer questions you haven't thought
of yet.

**Exit condition:** you can diagnose a failure you cannot reproduce, using only logs, metrics, and
traces — demonstrated under self-imposed conditions in KAI-084.

---

### KAI-080 · CHORE · 1.5h — Structured logging with Pino

Replace KAI-007's hand-rolled logger with Pino. Keep the `AsyncLocalStorage` request ID — it was right.
Add: log levels, automatic redaction of sensitive fields, child loggers carrying context, and pretty
printing in dev with raw JSON in production. Propagate the request ID **into background jobs**.

**Why this exists.** Open `docs/notes/` from KAI-007, where you listed what was wrong with your logger.
Each item maps to a Pino feature, and because you wrote that list from experience, you'll understand
each one rather than copying a config.

The central shift is **structured over human-readable**. `log.info({ bookingId, providerId, durationMs },
'booking created')` can be queried — "every booking for provider X that took over 2 seconds" is a filter.
`console.log('Created booking ' + id)` can only be grepped, and grep can't aggregate. Your logs become a
queryable dataset rather than a wall of prose.

Redaction is not optional. Passwords, tokens, card details, and PII in logs are a breach waiting for an
audit. Configure it centrally so it cannot be forgotten at a call site.

Propagating the request ID into jobs is what makes the trail continuous: a user reports a missing email,
you search their request ID, and you see the HTTP request *and* the job it spawned.

**Done when:**
- [ ] Pino configured; the hand-rolled logger is deleted
- [ ] Request ID appears on every log line, including inside job handlers
- [ ] Redaction covers `password`, `token`, `authorization`, `card`, `secret` — tested by attempting
      to log one
- [ ] Levels used deliberately; a documented convention for what belongs at each
- [ ] Dev is readable, production is JSON
- [ ] Every item from your KAI-007 list is now addressed

**The trap:** logging entire request bodies "to be thorough". That's how passwords reach your log
aggregator, where they're retained for 90 days and readable by everyone.

---

### KAI-081 · CHORE · 1.5h — RED metrics

Expose `/metrics` for Prometheus. Instrument the **RED** method: **R**ate (requests/sec), **E**rrors
(failures/sec), **D**uration (latency histogram) — per route and status class. Add domain metrics:
bookings created, payments succeeded/failed, queue depth, job duration, cache hit rate.

Run Prometheus and Grafana in compose and build one dashboard.

**Why this exists.** Logs tell you about one request; metrics tell you about the system. "Is it slow?"
is unanswerable from logs without aggregating millions of lines, and immediate from a latency
histogram.

Use **histograms, not averages**, for latency. An average of 200ms is consistent with everyone
experiencing 200ms, or with 95% at 50ms and 5% at 3 seconds. Those are completely different systems and
only the histogram distinguishes them.

The domain metrics matter as much as the technical ones. "Bookings created per hour" catches a class of
outage that infrastructure monitoring misses entirely: every endpoint returns 200, every pod is healthy,
and nobody can book because a validation rule went wrong in a deploy. **Business metrics detect silent
failures.**

**Done when:**
- [ ] `/metrics` exposes RED per route, plus domain counters
- [ ] Latency as a histogram with sensible buckets, p50/p95/p99 derivable
- [ ] Prometheus scraping; one Grafana dashboard committed as JSON
- [ ] Queue depth and job duration tracked
- [ ] `/metrics` is not publicly exposed (or is auth-protected — it leaks system detail)
- [ ] You can answer from the dashboard alone: what's the p99 on booking creation right now?

**The trap:** high-cardinality labels. A label containing `user_id` or `booking_id` creates a separate
time series per value and will take Prometheus down. Labels are for bounded sets: route, method, status.

---

### KAI-082 · CHORE · 2h — Distributed tracing

OpenTelemetry auto-instrumentation for Express, `pg`/Prisma, Redis, and BullMQ. Export to Jaeger in
compose. Add manual spans around the slot engine and payment calls. Propagate trace context into jobs so
a trace spans HTTP → service → database → queue → worker.

**Why this exists.** Metrics say *something* is slow; traces say *what*. A trace is a waterfall of a
single request across every component, and the answer is usually visible at a glance: 400ms total, 380ms
in one query, or — more often than you'd guess — 340ms spread over fifty 7ms queries, which is the N+1
you thought you fixed.

Trace context propagation into jobs is the part worth the effort. Without it you have two disconnected
traces and no way to know the job came from that request. With it, the causal chain is one picture.

This also sets up the mental model for distributed systems generally. You have one service today, but
tracing is how anyone understands a request crossing a dozen of them — and the tooling is identical.

**Done when:**
- [ ] Traces exported to Jaeger and browsable
- [ ] A single trace spans HTTP → service → DB → queue → job
- [ ] Manual spans on the slot engine and payment calls
- [ ] Trace ID is in every log line — so a log search jumps you to a trace
- [ ] You used a trace to find something you didn't already know about your own code (you will)
- [ ] Sampling configured — 100% in dev, lower in production, and you know why

---

### KAI-083 · FEAT · 1h — Health, readiness, and graceful shutdown

Two endpoints: `/health/live` (is the process alive?) and `/health/ready` (can it serve traffic — DB
reachable, Redis reachable, migrations applied?). Then graceful shutdown on `SIGTERM`: stop accepting
connections, finish in-flight requests, let the worker finish its current job, close pools, exit.

**Why this exists.** The liveness/readiness distinction is subtle and matters enormously. **Liveness
failing means restart me. Readiness failing means stop sending me traffic, but I may recover.** Conflate
them and a brief database blip triggers a restart loop across every instance, turning a 10-second
degradation into a full outage.

Graceful shutdown is what makes zero-downtime deploys real. Without it, every deploy kills in-flight
requests — users see random 502s during each release, and it looks like a mysterious intermittent bug
rather than a deploy artifact. The worker side matters too: a job killed mid-execution gets retried, and
retrying is only safe because of KAI-062. These pieces interlock.

**Done when:**
- [ ] `/health/live` is cheap and has no dependencies
- [ ] `/health/ready` checks DB and Redis and returns 503 when either is down
- [ ] `SIGTERM` drains in-flight requests before exiting — tested with a slow request mid-shutdown
- [ ] The worker finishes its current job before exiting
- [ ] Shutdown has a timeout (30s) and force-exits after it
- [ ] Zero dropped requests during a restart under load — verify with the KAI-075 load test running

**The trap:** readiness that returns 200 unconditionally. Your orchestrator then routes traffic to an
instance that can't reach the database, and every request fails.

---

### KAI-084 · INCIDENT · 2h — The production incident

Have someone (or your past self, via a seeded branch) introduce a subtle fault, then diagnose it using
**only** logs, metrics, and traces. No reading the diff, no local reproduction.

Candidate faults — pick blind:
- A query loses its index; p99 climbs but p50 is fine.
- A job handler silently swallows an exception; queue depth looks healthy, emails never send.
- A connection leak; the app degrades over 20 minutes and recovers on restart.
- Cache invalidation breaks for one key type only.
- A timezone bug affecting one region's bookings.

Then write a real postmortem: timeline, impact, detection, root cause, resolution, prevention.

**Why this exists.** This is the exam for the whole milestone, and for the project. Every previous
ticket could be solved by reading your own code. This one cannot — and that constraint is exactly what
production is.

The method is worth internalizing as a sequence. **Metrics tell you what changed and when.** Narrow to
the time window. **Traces tell you where** in the request path the time or errors went. **Logs tell you
why**, once you know which requests to look at. If any layer is missing or badly instrumented, you'll
discover it here — which is the most useful possible failure, because the fix is cheap now and expensive
at 3am.

The postmortem is not paperwork. Writing "we had no metric for queue processing *rate*, only depth, so a
stalled worker looked identical to an idle one" is how the next incident gets caught in two minutes
instead of two hours. **Blameless, mechanism-focused.** The question is never who, it's what made this
possible and what makes it visible next time.

**Done when:**
- [ ] You diagnosed it without reading the diff or reproducing locally
- [ ] Time-to-diagnosis recorded honestly, including the wrong turns
- [ ] `docs/notes/postmortem-{slug}.md` written: timeline, impact, detection, root cause, resolution,
      prevention
- [ ] At least one observability gap found and **fixed** — a missing metric, an unlogged field, an
      uninstrumented span
- [ ] An alert added that would have caught it faster
- [ ] You can narrate the diagnosis out loud, in order, as a story

**The trap:** peeking at the code. The constraint *is* the exercise — remove it and you've learned
nothing you didn't already know.

---

## Closing M8

- [ ] Structured logs, RED metrics, end-to-end traces all working
- [ ] Health checks distinguish liveness from readiness; shutdown drains cleanly
- [ ] One incident diagnosed blind, one postmortem written, one gap closed
- [ ] You can explain: structured vs unstructured logging, why histograms beat averages, why
      high-cardinality labels are dangerous, and liveness vs readiness

**Log it in `plan.md`.** One milestone left — make it public.
