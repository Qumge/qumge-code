import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

function fakePi() {
  const calls = { providers: [], commands: [] };
  return {
    calls,
    registerProvider: (name, config) => calls.providers.push({ name, config }),
    registerCommand: (name, options) => calls.commands.push({ name, options })
  };
}

const { default: extension } = await import("../extension.js");

test("registers the Qumge provider against the gateway", () => {
  delete process.env.QUMGE_API_BASE;
  const pi = fakePi();
  extension(pi);

  assert.equal(pi.calls.providers.length, 1);
  const { name, config } = pi.calls.providers[0];
  assert.equal(name, "qumge");
  assert.equal(config.baseUrl, "https://qumge.com/v1");
  assert.equal(config.api, "openai-completions");
  assert.equal(config.apiKey, "$QUMGE_API_KEY");
  assert.ok(Array.isArray(config.models), "models come from the bundled catalog");
  assert.equal(config.refreshModels, undefined, "no network at startup");
});

test("honours QUMGE_API_BASE for staging and local runs", () => {
  process.env.QUMGE_API_BASE = "https://staging.example/";
  const pi = fakePi();
  extension(pi);
  assert.equal(pi.calls.providers[0].config.baseUrl, "https://staging.example/v1");
  delete process.env.QUMGE_API_BASE;
});

// The end-to-end test points the extension at a catalog it controls; without
// this seam it would have to rewrite the shipped models.json.
test("loads the catalog from QUMGE_MODELS_FILE when set", () => {
  const file = path.join(mkdtempSync(path.join(tmpdir(), "qmg-models-")), "models.json");
  writeFileSync(
    file,
    JSON.stringify({
      generated_at: null,
      data: [
        { id: "test/model", display_name: "Test", context_window: 8192, max_tokens: 1024,
          input_price_per_mtoken_usd: 1, output_price_per_mtoken_usd: 2,
          featured: true, coding: true, capabilities: { tools: true, vision: false },
          input_modalities: ["text"] }
      ]
    })
  );

  process.env.QUMGE_MODELS_FILE = file;
  const pi = fakePi();
  extension(pi);
  delete process.env.QUMGE_MODELS_FILE;

  assert.deepEqual(pi.calls.providers[0].config.models.map((m) => m.id), ["test/model"]);
});

test("adds /models and /balance without shadowing Pi's commands", () => {
  const pi = fakePi();
  extension(pi);
  assert.deepEqual(pi.calls.commands.map((c) => c.name).sort(), ["balance", "models"]);
});

test("an in-session command without a key points at qumge login", async () => {
  delete process.env.QUMGE_API_KEY;
  const pi = fakePi();
  extension(pi);
  const balance = pi.calls.commands.find((c) => c.name === "balance");
  const notices = [];
  await balance.options.handler("", { hasUI: true, ui: { notify: (message) => notices.push(message) } });
  assert.match(notices.join("\n"), /qumge login/);
});

// 启动时一次 fetch 就等于把目录下载摆在第一个 token 前面。
test("does no network while loading", () => {  const original = globalThis.fetch;
  let fetches = 0;
  globalThis.fetch = () => {
    fetches++;
    throw new Error("network during startup");
  };
  try {
    extension(fakePi());
  } finally {
    globalThis.fetch = original;
  }
  assert.equal(fetches, 0);
});

test("treats a literal 'undefined' base as missing", () => {
  process.env.QUMGE_API_BASE = "undefined";
  const pi = fakePi();
  extension(pi);
  assert.equal(pi.calls.providers[0].config.baseUrl, "https://qumge.com/v1");
  delete process.env.QUMGE_API_BASE;
});

// 登录时缓存下来的目录优先于随包的那份：价格只在网关里是真的，随包的目录
// 在发布那一刻就开始变旧。
test("prefers the catalog cached by qumge login over the bundled one", () => {
  const home = mkdtempSync(path.join(tmpdir(), "qmg-home-"));
  writeFileSync(
    path.join(home, "models.json"),
    JSON.stringify({
      generated_at: "2026-10-22T00:00:00.000Z",
      data: [
        { id: "cached/model", display_name: "Cached", context_window: 8192, max_tokens: 1024,
          input_price_per_mtoken_usd: 1, output_price_per_mtoken_usd: 2,
          featured: true, coding: true, capabilities: { tools: true, vision: false },
          input_modalities: ["text"] }
      ]
    })
  );

  const previous = process.env.QMG_HOME;
  process.env.QMG_HOME = home;
  try {
    const pi = fakePi();
    extension(pi);
    assert.deepEqual(pi.calls.providers[0].config.models.map((m) => m.id), ["cached/model"]);
  } finally {
    if (previous === undefined) delete process.env.QMG_HOME;
    else process.env.QMG_HOME = previous;
  }
});
