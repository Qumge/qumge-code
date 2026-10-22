import { test } from "node:test";
import assert from "node:assert/strict";
import { planInvocation } from "../lib/args.mjs";

const creds = {
  api_key: "sk_qumge_test",
  api_base: "https://qumge.com",
  default_model: "deepseek/deepseek-chat"
};

test("starts Pi with our extension and the saved default model", () => {
  const { args, env } = planInvocation([], { creds, pkgRoot: "/pkg" });

  assert.deepEqual(args.slice(0, 2), ["-e", "/pkg"]);
  assert.deepEqual(args.slice(-4), ["--provider", "qumge", "--model", "deepseek/deepseek-chat"]);
  assert.equal(env.QUMGE_API_KEY, "sk_qumge_test");
  assert.equal(env.QUMGE_API_BASE, "https://qumge.com");
});

test("forwards arguments and does not duplicate -e", () => {
  const { args } = planInvocation(["-p", "fix the test"], { creds, pkgRoot: "/pkg" });
  assert.deepEqual(args.slice(2), ["-p", "fix the test", "--provider", "qumge", "--model", "deepseek/deepseek-chat"]);

  const twice = planInvocation(["-e", "/other"], { creds, pkgRoot: "/pkg" });
  assert.equal(twice.args.filter((a) => a === "-e").length, 1);
});

test("an explicit --model wins over the saved default", () => {
  const { args } = planInvocation(["--model", "x/y"], { creds, pkgRoot: "/pkg" });
  assert.deepEqual(args.slice(2), ["--model", "x/y", "--provider", "qumge"]);
});

test("does not inject anything when extensions are disabled", () => {
  const { args } = planInvocation(["-ne"], { creds, pkgRoot: "/pkg" });
  assert.equal(args.includes("-e"), false, "-ne means the user asked for no extensions");
});

test("does not overwrite a provider the user chose", () => {
  const { args } = planInvocation(["--provider", "openai", "--model", "gpt"], { creds, pkgRoot: "/pkg" });
  assert.deepEqual(args, ["-e", "/pkg", "--provider", "openai", "--model", "gpt"]);
});

// Staging and CI point the CLI at another host without rewriting ~/.qmg.
test("an exported QUMGE_API_BASE wins over the saved api_base", () => {
  process.env.QUMGE_API_BASE = "https://staging.example";
  try {
    const { env } = planInvocation([], { creds, pkgRoot: "/pkg" });
    assert.equal(env.QUMGE_API_BASE, "https://staging.example");
  } finally {
    delete process.env.QUMGE_API_BASE;
  }
});

// Pi 1.4.0 only parses the space-separated forms (dist/cli/args.js); `=` and
// `-m` fall into unknownFlags or "Unknown option". Normalizing here keeps an
// obvious invocation working instead of letting Pi drop it.
test("normalizes --model= and --provider= to the form Pi parses", () => {
  const { args } = planInvocation(["--model=x/y", "--provider=openai"], { creds, pkgRoot: "/pkg" });
  assert.deepEqual(args, ["-e", "/pkg", "--model", "x/y", "--provider", "openai"]);
});

test("-m is not a Pi flag, so it does not count as the model choice", () => {
  const { args } = planInvocation(["-m", "x/y"], { creds, pkgRoot: "/pkg" });
  assert.equal(args.includes("--model"), true, "the saved default is still injected");
});

test("injects no provider when there is no model to run", () => {
  const { args } = planInvocation([], { creds: { ...creds, default_model: null }, pkgRoot: "/pkg" });
  assert.deepEqual(args, ["-e", "/pkg"]);
});

test("disabled extensions mean vanilla Pi — no provider, no model", () => {
  const { args } = planInvocation(["-ne"], { creds, pkgRoot: "/pkg" });
  assert.deepEqual(args, ["-ne"]);

  // A user who names their own provider still gets it forwarded untouched.
  const own = planInvocation(["-ne", "--provider", "openai", "--model", "gpt"], { creds, pkgRoot: "/pkg" });
  assert.deepEqual(own.args, ["-ne", "--provider", "openai", "--model", "gpt"]);
});

test("never puts an undefined base or key into the child environment", () => {
  delete process.env.QUMGE_API_BASE;
  delete process.env.QUMGE_API_KEY;
  const { env } = planInvocation([], {
    creds: { api_key: "sk_qumge_test", default_model: "x/y" },
    pkgRoot: "/pkg"
  });
  assert.equal("QUMGE_API_BASE" in env, false, "spawn would turn undefined into the string \"undefined\"");
});

test("does not pair its default model with someone else's provider", () => {
  const { args } = planInvocation(["--provider", "openai"], { creds, pkgRoot: "/pkg" });
  assert.deepEqual(args, ["-e", "/pkg", "--provider", "openai"]);
});
