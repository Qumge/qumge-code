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

Environment: macOS (darwin/arm64), Node v24.18.0, 20 runs after 3 warm-up.

| metric | n | min | p50 | p95 | max |
| --- | ---: | ---: | ---: | ---: | ---: |
| `qumge --version` (our process) | 20 | 22 | 23 | 26 | 26 |
| `pi --version` (bare Pi) | 20 | 110 | 112 | 117 | 117 |
| extension load + register | 20 | 2 | 2 | 2 | 2 |
| `qumge -p` → first output (stub) | 10 | 186 | 188 | 201 | 201 |
| `qumge -p` → exit (stub) | 10 | 191 | 193 | 208 | 208 |
| `pi -p` → first output (same args, no launcher) | 10 | 163 | 164 | 167 | 167 |

**Launcher overhead: 24.3 ms (p50) to first output.** Of that, ~20 ms is Node
booting the launcher process at all (`node -e ""` measures ~20 ms here) and
~3 ms is our own argument planning, credentials read and catalog parse.
Registering the extension costs 2 ms and makes no network request.

Against a real model call, which is measured in seconds, 24 ms is noise; the
number to watch is that it stays flat and stays a single Node boot.

## What we deliberately do not do on startup

- No network: the model catalog is bundled in the package and refreshed at
  `qumge login`, which is already a network conversation. A fetch here would
  put a catalog download in front of the first token.
- No dependency tree walk, no version check, no telemetry.

## If the launcher ever needs to get faster

The 24 ms is a second Node process; shaving the last 3 ms of our code would be
invisible. The only real win would be not starting Node twice — e.g. a tiny
POSIX-shell `qumge` that exports the saved credentials and `exec`s Pi directly.
That trades a ~20 ms gain for JSON parsing in shell and a second
implementation of the login file format; not worth it at the current numbers.
