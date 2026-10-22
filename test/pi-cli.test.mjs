import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { resolvePiCli } from "../lib/pi-cli.mjs";

// Resolving against the real dependency, not a fixture: what can break is the
// package layout (bin field moving, the entry leaving dist/), and a fixture
// would keep passing through exactly that break.
test("resolves the installed Pi CLI to an existing entry file", () => {
  const cli = resolvePiCli();
  assert.ok(existsSync(cli), `${cli} should exist`);
  assert.ok(cli.endsWith("cli.js"), `${cli} should be Pi's cli entry`);
});
