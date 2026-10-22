# Speed

The north-star requirement is that the agent starts fast and adds nothing to
the per-turn path. This document is the measurement, not a promise: it records
what QMG Code itself costs on top of Pi, on the machine and versions below.

## Method

`scripts/bench.mjs` runs every case in a fresh process (which is what the user
pays for), discards 3 warm-up runs, then reports min / p50 / p95 / max over
20 runs (`BENCH_RUNS` overrides the count).

The end-to-end cases spawn `qumge -p "say ok"` and bare Pi with the *same*
arguments (`-e <package root> -p … --provider qumge --model test/model`)
against the same local stub gateway (`test/helpers/stub-gateway.mjs`). The
difference between those two rows is the launcher's own cost; everything else
belongs to Pi, Node, or the model.

No request leaves the machine: the stub answers on 127.0.0.1.

```bash
npm run bench
BENCH_RUNS=50 npm run bench
```

## Result

Environment: macOS (darwin/arm64), Node v24.18.0, 10 runs after 3 warm-up
(re-measured 2026-10-22 for 0.1.8).

| metric | n | min | p50 | p95 | max |
| --- | ---: | ---: | ---: | ---: | ---: |
| `qumge --version` (our process) | 10 | 23 | 23 | 25 | 25 |
| `pi --version` (bare Pi) | 10 | 113 | 115 | 121 | 121 |
| extension load + register | 10 | 4 | 4 | 4 | 4 |
| `qumge -p` → first output (stub) | 5 | 217 | 219 | 226 | 226 |
| `qumge -p` → exit (stub) | 5 | 222 | 224 | 232 | 232 |
| `pi -p` → first output (same args, no launcher) | 5 | 194 | 197 | 197 | 197 |

**Launcher overhead: 22.6 ms (p50) to first output**, almost all of it Node
booting the launcher process. Registering the extension costs 4 ms.

Watch the extension-load row: 0.1.2–0.1.7 imported Pi's OpenAI Chat
Completions module at load (for the gzip transport) and it read 40 ms. It is
now imported on the first model request instead.

## What we deliberately do not do on startup

- No network in front of the first token: the model catalog is cached at
  `qumge login`. When it is older than a day the launcher starts a detached
  process to refresh it and does not wait; this run keeps the cached catalog,
  the next run gets the fresh one. A failed refresh is retried at most hourly.
- No dependency tree walk, no version check, no telemetry.

## If the launcher ever needs to get faster

The 24 ms is a second Node process; shaving the last 3 ms of our code would be
invisible. The only real win would be not starting Node twice — e.g. a tiny
POSIX-shell `qumge` that exports the saved credentials and `exec`s Pi directly.
That trades a ~20 ms gain for JSON parsing in shell and a second
implementation of the login file format; not worth it at the current numbers.
