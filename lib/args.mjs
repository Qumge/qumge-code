// Decides what the child Pi process gets. Pure on purpose: the argv/env rules
// are the part worth testing, and spawning Pi to test them would be slow and
// would depend on a real terminal.
export function planInvocation(argv, { creds, pkgRoot }) {
  const args = [];

  // A user who passed -ne asked for no extensions; loading ours anyway would
  // silently ignore the flag.
  const extensionsDisabled = argv.some((a) => a === "-ne" || a === "--no-extensions");
  const hasExtensionFlag = argv.some(
    (a) => a === "-e" || a === "--extension" || a.startsWith("--extension=")
  );
  if (!extensionsDisabled && !hasExtensionFlag) args.push("-e", pkgRoot);

  args.push(...argv);

  const hasProvider = args.some((a) => a === "--provider" || a.startsWith("--provider="));
  const hasModel = args.some(
    (a) => a === "--model" || a === "-m" || a.startsWith("--model=")
  );

  if (!hasProvider) args.push("--provider", "qumge");
  // Pi rejects --provider without --model; if we have no default yet, leave the
  // picker to the user rather than inventing an id.
  if (!hasModel && creds.default_model) args.push("--model", creds.default_model);

  const env = {
    ...process.env,
    // An exported key or base is an explicit choice (CI, staging, one-off
    // runs) and wins over the saved credentials.
    QUMGE_API_KEY: process.env.QUMGE_API_KEY || creds.api_key,
    QUMGE_API_BASE: process.env.QUMGE_API_BASE || creds.api_base
  };

  return { args, env };
}
