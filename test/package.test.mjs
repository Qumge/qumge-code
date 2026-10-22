import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));

test("ships everything the CLI needs at runtime", () => {
  const output = execFileSync("npm", ["pack", "--dry-run", "--json"], { cwd: root, encoding: "utf8" });
  const parsed = JSON.parse(output);
  // npm 11 returns an object keyed by package name; older npm returns an array.
  const entry = Array.isArray(parsed) ? parsed[0] : Object.values(parsed)[0];
  const files = entry.files.map((file) => file.path);

  for (const expected of [
    "bin/qmg.mjs",
    "extension.js",
    "models.json",
    "lib/args.mjs",
    "lib/login.mjs",
    "LICENSE",
    "NOTICE",
    "README.md"
  ]) {
    assert.ok(files.includes(expected), `${expected} is missing from the package`);
  }

  // The tests and the generator are for maintainers, not for users.
  assert.ok(!files.some((file) => file.startsWith("test/")), "tests ship to every user");
  assert.ok(!files.some((file) => file.startsWith("scripts/")), "scripts ship to every user");
});

test("pins the Node floor and the exact Pi version", () => {
  assert.equal(pkg.engines.node, ">=22.19.0");
  assert.equal(pkg.dependencies["@earendil-works/pi-coding-agent"], "1.4.0");
});
