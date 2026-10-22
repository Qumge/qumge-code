# QMG Code

A coding agent for your terminal, powered by Qumge models. One account, one
key, pay as you go — no per-seat subscription.

```bash
curl -fsSL https://qumge.com/install.sh | sh
qmg login
cd your-repo
qmg
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
qmg login
```

It prints a link and a code. Open the link, approve the device, and the key is
saved to `~/.qmg/credentials.json` (readable only by you).

```bash
qmg logout     # forget the saved account
```

## Use

Run `qmg` inside a repository to start the agent. Everything after `qmg` is
passed through to the agent, so the usual flags work:

```bash
qmg -p "fix the failing test"         # one-off, print the answer, exit
qmg --model deepseek/deepseek-chat    # pick a model for this run
qmg help                              # the full flag list
```

## Commands

| Command | What it does |
| --- | --- |
| `qmg` | Start the agent with your default model |
| `qmg login` | Sign in through the device flow |
| `qmg logout` | Delete the saved account |
| `qmg balance` | Wallet balance, withdrawable amount, earnings this month |
| `qmg models` | Coding models and their prices |
| `/models` | The same list, inside a session |
| `/balance` | The same balance, inside a session |

## Models

The model list shown by `qmg models` is live. The catalog bundled with the
package is refreshed with each release, so launching never waits on a network
request; run `qmg models` when you want the current prices.

## Troubleshooting

**`Invalid API key — run qmg login again.`** — the saved key was revoked or
belongs to another account.

**`Insufficient balance ... top up at ...`** — open the link to add funds.

**`Qumge returned a non-JSON response — the request was blocked before it
reached the API.`** — a network edge refused the request before it reached
Qumge. Retry; if it persists, report it at
https://github.com/Qumge/qumge-code/issues.

**`Could not reach Qumge`** — check your connection or proxy settings.

## Licence

MIT. QMG Code uses [Pi](https://github.com/earendil-works/pi) as its agent
runtime; see `NOTICE` for that licence.
