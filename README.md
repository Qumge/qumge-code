# QMG Code

A coding agent for your terminal, powered by Qumge models. One account, one
key, pay as you go — no per-seat subscription.

```bash
curl -fsSL https://qumge.com/install.sh | sh
qumge login
cd your-repo
qumge
```

## Requirements

- Node.js 22.19 or newer
- A Qumge account

## Install

```bash
curl -fsSL https://qumge.com/install.sh | sh
```

The installer checks Node, then installs into `~/.local/bin` (no sudo, no
change to a system Node's global prefix). If `~/.local/bin` is not on your
`PATH`, it prints the one line to add.

The package is served from qumge.com, not from npm. The same command upgrades:

```bash
curl -fsSL https://qumge.com/install.sh | sh
```

## Sign in

```bash
qumge login
```

It prints a link and a code. Open the link, approve the device, and the key is
saved to `~/.qmg/credentials.json` (readable only by you).

```bash
qumge logout     # forget the saved account
```

## Use

Run `qumge` inside a repository to start the agent. Everything after `qumge` is
passed through to the agent, so the usual flags work:

```bash
qumge -p "fix the failing test"         # one-off, print the answer, exit
qumge --model deepseek/deepseek-chat    # pick a model for this run
qumge help                            # the full flag list
```

## Commands

| Command | What it does |
| --- | --- |
| `qumge` | Start the agent with your default model |
| `qumge login` | Sign in through the device flow |
| `qumge logout` | Delete the saved account |
| `qumge balance` | Wallet balance, withdrawable amount, earnings this month |
| `qumge models` | Coding models and their prices |
| `/models` | The same list, inside a session |
| `/balance` | The same balance, inside a session |

## What it asks before doing

The agent reads, edits, runs tests and uses git without asking. It stops and
asks only before the few things that cannot be undone:

- deletes that cannot be undone (`rm -rf`, `find … -delete`, `rimraf`, `shred`, `Remove-Item -Recurse`)
- overwriting a disk or wiping a file (`dd of=/dev/…`, `mkfs`, `truncate -s 0`)
- `git reset --hard`, `git push --force`, `git clean -f`, `git branch -D`
- `sudo`
- reading or writing secrets files (`.env`, `~/.ssh`, `~/.aws`, `~/.qmg`, …)

Choose **Allow once**, **Allow for this session** (stops asking for that kind
until you start a new session), or **Deny**. In print mode (`qumge -p`) there
is no one to ask, so those calls are refused; pass `--yolo` (or set
`QUMGE_YOLO=1`) to allow everything.

This catches the model slipping; it is not a sandbox. It matches command text,
so a command hidden inside a script is not seen, and the agent runs with your
user's permissions. Work in a git repository with your changes committed, or
run it in a container.

## Models

The model list shown by `qumge models` is live. The catalog bundled with the
package is refreshed with each release, so launching never waits on a network
request; run `qumge models` when you want the current prices.

## Troubleshooting

**`Invalid API key — run qumge login again.`** — the saved key was revoked or
belongs to another account.

**`Insufficient balance ... top up at ...`** — open the link to add funds.

**`Qumge's network edge blocked this request before it reached the API`** —
the firewall in front of Qumge refused something in the conversation. Start a
new session with `/new`; if it keeps happening, report it at
https://github.com/Qumge/qumge-code/issues.

**`Qumge returned a non-JSON response`** (from `qumge balance` / `qumge models`)
— the same edge refused a request. Retry; if it persists, report it as above.

**`Could not reach Qumge`** — check your connection or proxy settings.

## Licence

MIT. QMG Code uses [Pi](https://github.com/earendil-works/pi) as its agent
runtime; see `NOTICE` for that licence.
