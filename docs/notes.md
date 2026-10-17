# Docker

- compose: .env interpolated on host before containers exist; env_file vars go to the container process only — never available to ${VAR}
- Server listens only after first DB query succeeds — readiness before accepting traffic

# Layered architecture

- routes (= the controller role) => services => repositories
- explicit return types on exported fns = layer contract. Infer module internals

# 007 - request logging

- req.headers[''] is converted to lowercase when hit the server
- req.hrtime.bigint() needs to be converted to number before dividing by 1e6 (nanosec to milisec)
- what's wrong with this logger (→ M8): unstructured, synchronous, no levels, no redaction, inbound X-Request-Id not validated
