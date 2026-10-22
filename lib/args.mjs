// Decides what the child Pi process gets. Pure on purpose: the argv/env rules
// are the part worth testing, and spawning Pi to test them would be slow and
// would depend on a real terminal.
export function planInvocation(argv, { creds, pkgRoot }) {
  // Pi 1.4 parses only the space-separated `--model x` / `--provider x` forms
  // (dist/cli/args.js); the `=` forms land in unknownFlags and are dropped. A
  // user typing the obvious `--model=x` should not silently get Pi's own
  // default, so normalize before the flags are inspected or forwarded.
  const forwarded = [];
  for (const arg of argv) {
    if (arg.startsWith("--model=")) forwarded.push("--model", arg.slice("--model=".length));
    else if (arg.startsWith("--provider=")) forwarded.push("--provider", arg.slice("--provider=".length));
    else forwarded.push(arg);
  }

  // A user who passed -ne asked for vanilla Pi; loading our extension anyway
  // would silently ignore the flag.
  const extensionsDisabled = forwarded.some((a) => a === "-ne" || a === "--no-extensions");
  const hasExtensionFlag = forwarded.some(
    (a) => a === "-e" || a === "--extension" || a.startsWith("--extension=")
  );

  const args = [];
  if (!extensionsDisabled && !hasExtensionFlag) args.push("-e", pkgRoot);
  args.push(...forwarded);

  const hasProvider = forwarded.includes("--provider");
  const hasModel = forwarded.includes("--model");
  const providerValue = hasProvider ? forwarded[forwarded.lastIndexOf("--provider") + 1] : undefined;
  // Our default model belongs to our provider. With someone else's provider
  // selected, appending a qumge model id would pair the two wrongly.
  const defaultModel = providerValue && providerValue !== "qumge" ? null : creds.default_model;

  // -ne means no extensions, so no `qumge` provider exists in the child —
  // injecting --provider qumge there is a guaranteed "--provider requires
  // --model" (or an unknown-provider) error.
  if (!extensionsDisabled) {
    // Pi rejects --provider without --model. Inject neither unless a model is
    // actually available: a login that found no coding models leaves
    // default_model null, and vanilla Pi is a better outcome than a hard error.
    if (!hasProvider && (hasModel || defaultModel)) args.push("--provider", "qumge");
    if (!hasModel && defaultModel) args.push("--model", defaultModel);
  }

  const env = { ...process.env };
  // An exported key or base is an explicit choice (CI, staging, one-off runs)
  // and wins over the saved credentials. Only defined values go in: spawn
  // stringifies `undefined`, and "undefined" is a truthy base URL.
  const apiKey = process.env.QUMGE_API_KEY || creds.api_key;
  if (apiKey) env.QUMGE_API_KEY = apiKey;
  const apiBase = process.env.QUMGE_API_BASE || creds.api_base;
  if (apiBase) env.QUMGE_API_BASE = apiBase;

  return { args, env };
}
