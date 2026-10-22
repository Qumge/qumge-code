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

// 启动时一次 fetch 就等于把目录下载摆在第一个 token 前面。
test("does no network while loading", () => {
  const original = globalThis.fetch;
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
