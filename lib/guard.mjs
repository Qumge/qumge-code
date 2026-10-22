// Asks before the few things that cannot be undone.
// Not covered on purpose: `> file` redirection. Agents create files that way all
// the time and the text alone cannot tell a new file from an existing one, so a
// prompt there would fire on ordinary work. Everything else — reading,
// editing, tests, installs, ordinary git — runs without a prompt.
//
// Pi itself never asks before a tool call. This is a guard against the model
// slipping, not a security boundary: it matches command text, so a command
// hidden in a script it wrote first is not seen. Isolation (a container) is the
// only real boundary.

const SECRET_PATH =
  /(^|[\s"'=/\\])(\.env(\.[\w-]+)?(?=$|[\s"'/\\;|&)<>])|\.ssh[/\\]|\.aws[/\\]|\.qmg[/\\]|\.netrc\b|\.npmrc\b|\.pypirc\b|id_(rsa|ed25519|ecdsa)\b)/;
// Templates are meant to be read and committed. Removed before matching, so
// `cp .env.example .env` still asks (it would overwrite a real .env).
const SECRET_TEMPLATE = /\.env\.(example|sample|template|dist)\b/g;

const COMMAND_RULES = [
  {
    category: "delete",
    label: "recursive delete",
    test: (c) =>
      /\brm\s+(-[a-zA-Z]*[rR][a-zA-Z]*|--recursive)\b/.test(c) ||
      /\bRemove-Item\b.*-Recurse\b/i.test(c) ||
      /\b(rmdir|rd|del)\s+\/s\b/i.test(c) ||
      /\bfind\b[^|;&]*\s-delete\b/.test(c) ||
      /\bfind\b[^|;&]*-exec\s+rm\b/.test(c) ||
      /\brimraf\b/.test(c) ||
      /\bshred\b/.test(c)
  },
  {
    category: "disk",
    label: "overwrites a disk or wipes file contents",
    test: (c) =>
      /\bdd\b[^|;&]*\bof=\/dev\//.test(c) ||
      /\bmkfs(\.\w+)?\b/.test(c) ||
      /\btruncate\b[^|;&]*-s\s*0\b/.test(c)
  },
  {
    category: "git",
    label: "git history or uncommitted work would be lost",
    test: (c) =>
      /\bgit\s+reset\b[^|;&]*--hard\b/.test(c) ||
      /\bgit\s+push\b[^|;&]*(\s--force(-with-lease)?\b|\s-f\b)/.test(c) ||
      /\bgit\s+clean\b[^|;&]*\s-[a-zA-Z]*f/.test(c) ||
      /\bgit\s+branch\b[^|;&]*\s-D\b/.test(c)
  },
  // sudo followed by a space or the end — `sudo-rs install` is a package name, not root.
  { category: "sudo", label: "runs as root", test: (c) => /(^|[\s;&|(])sudo(?=\s|$)/.test(c) },
  { category: "secrets", label: "touches a secrets file", test: (c) => mentionsSecret(c) }
];

function mentionsSecret(text) {
  return SECRET_PATH.test(text.replace(SECRET_TEMPLATE, ""));
}

// What the call would do that needs asking, or null when it can just run.
export function classify(toolName, input = {}) {
  if (toolName === "bash" || toolName === "powershell") {
    const command = String(input.command || "");
    const rule = COMMAND_RULES.find((r) => r.test(command));
    return rule ? { category: rule.category, label: rule.label, detail: command } : null;
  }
  if (toolName === "read" || toolName === "write" || toolName === "edit") {
    const path = String(input.path || "");
    if (mentionsSecret(` ${path}`)) {
      return { category: "secrets", label: "touches a secrets file", detail: `${toolName} ${path}` };
    }
  }
  return null;
}

export const ALLOW_ONCE = "Allow once";
export const ALLOW_SESSION = "Allow for this session";
export const DENY = "Deny";

export function installGuard(pi, { env = process.env } = {}) {
  pi.registerFlag?.("yolo", {
    type: "boolean",
    default: false,
    description: "Do not ask before destructive commands or secrets files"
  });

  // Categories the user allowed for the rest of this session.
  let allowed = new Set();
  pi.on("session_start", () => {
    allowed = new Set();
  });

  pi.on("tool_call", async (event, ctx) => {
    if (env.QUMGE_YOLO === "1" || pi.getFlag?.("yolo") === true) return undefined;

    const risk = classify(event.toolName, event.input);
    if (!risk || allowed.has(risk.category)) return undefined;

    // The reason goes back to the model as the tool result: it must say the
    // user decided, so the model stops instead of retrying the same command.
    if (!ctx?.hasUI) {
      return {
        block: true,
        reason: `Blocked (${risk.label}): QMG Code asks before this and there is no terminal to ask in. ` +
          "Re-run with --yolo to allow it."
      };
    }

    const choice = await ctx.ui.select(
      `QMG Code asks before this (${risk.label}):\n\n  ${risk.detail}\n`,
      [ALLOW_ONCE, ALLOW_SESSION, DENY]
    );
    if (choice === ALLOW_SESSION) allowed.add(risk.category);
    if (choice === ALLOW_ONCE || choice === ALLOW_SESSION) return undefined;

    return { block: true, reason: `The user declined (${risk.label}). Do not retry it; ask the user what to do instead.` };
  });
}
