import { readFileSync } from "node:fs";

// The startup header and terminal title say QMG Code, not Pi.
//
// Pi's own header is replaced through the documented extension hook
// (ctx.ui.setHeader) — no fork, no patching node_modules. A small "built on Pi"
// stays in the header: Pi is MIT-licensed and NOTICE carries its licence, but
// naming it where users see it is the honest thing to do.

const ourPackage = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

function piVersion() {
  try {
    // package.json is not in Pi's exports map; it sits one level above the entry (dist/index.js).
    const entry = import.meta.resolve("@earendil-works/pi-coding-agent");
    return JSON.parse(readFileSync(new URL("../package.json", entry), "utf8")).version;
  } catch {
    return null;
  }
}

export function headerLines(theme, { version = ourPackage.version, pi = piVersion() } = {}) {
  const sep = theme.fg("muted", " · ");
  const hint = (key, label) => `${theme.fg("dim", key)} ${theme.fg("muted", label)}`;
  return [
    `${theme.fg("accent", "QMG Code")} ${theme.fg("dim", `v${version}`)}` +
      (pi ? theme.fg("dim", `  ·  built on Pi ${pi}`) : ""),
    [
      hint("escape", "interrupt"),
      hint("ctrl+c/ctrl+d", "clear/exit"),
      hint("/", "commands"),
      hint("!", "bash"),
      hint("ctrl+o", "more")
    ].join(sep),
    "",
    theme.fg("dim", "Switch models with /model, see prices with /models, check your balance with /balance.")
  ];
}

// Pi re-titles the terminal itself ("π - <folder>") at the end of startup and
// whenever the session changes, so a one-off setTitle is overwritten. Rewrite
// just that prefix on its own title calls; anything else passes through.
export function brandTitles(terminal) {
  if (!terminal || typeof terminal.setTitle !== "function" || terminal.setTitle.qmgBranded) return;
  const original = terminal.setTitle.bind(terminal);
  const branded = (title) => original(String(title).replace(/^π(?= - |$)/, "QMG Code"));
  branded.qmgBranded = true;
  terminal.setTitle = branded;
}

export function installBranding(pi) {
  pi.on("session_start", async (_event, ctx) => {
    if (ctx?.mode !== "tui" || !ctx.ui?.setHeader) return;
    ctx.ui.setHeader((tui, theme) => {
      brandTitles(tui?.terminal);
      return { render: () => headerLines(theme), invalidate() {} };
    });
    ctx.ui.setTitle?.("QMG Code");
  });
}
