import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { MAX_AGE_MS, RETRY_AFTER_MS, maybeRefreshInBackground, refreshCatalog } from "../lib/catalog-refresh.mjs";

function home(catalog) {
  const dir = mkdtempSync(path.join(tmpdir(), "qmg-refresh-"));
  if (catalog) writeFileSync(path.join(dir, "models.json"), JSON.stringify(catalog));
  process.env.QMG_HOME = dir;
  return dir;
}

function spawnRecorder() {
  const calls = [];
  return { calls, spawnImpl: (cmd, args, options) => { calls.push({ cmd, args, options }); return { on() {}, unref() {} }; } };
}

const NOW = Date.parse("2026-10-22T12:00:00Z");
const ago = (ms) => new Date(NOW - ms).toISOString();

test("a catalog younger than a day is left alone — no process at all", () => {
  home({ generated_at: ago(MAX_AGE_MS - 60_000), data: [] });
  const { calls, spawnImpl } = spawnRecorder();
  assert.equal(maybeRefreshInBackground({ env: {}, now: NOW, spawnImpl }), false);
  assert.equal(calls.length, 0);
});

test("an older catalog starts one detached worker and does not wait for it", () => {
  home({ generated_at: ago(MAX_AGE_MS + 60_000), data: [] });
  const { calls, spawnImpl } = spawnRecorder();
  assert.equal(maybeRefreshInBackground({ env: {}, now: NOW, spawnImpl }), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].cmd, process.execPath);
  assert.match(calls[0].args[0], /catalog-refresh-worker\.mjs$/);
  assert.equal(calls[0].options.detached, true);
  assert.equal(calls[0].options.stdio, "ignore");
});

test("a missing or unstamped catalog counts as stale", () => {
  for (const catalog of [null, { data: [] }, { generated_at: "not a date", data: [] }]) {
    home(catalog);
    const { calls, spawnImpl } = spawnRecorder();
    maybeRefreshInBackground({ env: {}, now: NOW, spawnImpl });
    assert.equal(calls.length, 1, JSON.stringify(catalog));
  }
});

// 网络坏的时候不能每次启动都起一个进程：失败后一小时内不再试。
test("after an attempt it waits an hour before trying again", () => {
  const dir = home({ generated_at: ago(2 * MAX_AGE_MS), data: [] });
  const first = spawnRecorder();
  maybeRefreshInBackground({ env: {}, now: NOW, spawnImpl: first.spawnImpl });
  const marker = path.join(dir, "models.refresh-attempt");
  assert.ok(existsSync(marker));

  const soon = spawnRecorder();
  utimesSync(marker, new Date(NOW - 60_000), new Date(NOW - 60_000));
  assert.equal(maybeRefreshInBackground({ env: {}, now: NOW, spawnImpl: soon.spawnImpl }), false);

  const later = spawnRecorder();
  const old = new Date(NOW - RETRY_AFTER_MS - 60_000);
  utimesSync(marker, old, old);
  assert.equal(maybeRefreshInBackground({ env: {}, now: NOW, spawnImpl: later.spawnImpl }), true);
});

test("an explicit catalog file or the opt-out skips refreshing", () => {
  home(null);
  for (const env of [{ QUMGE_MODELS_FILE: "/x/models.json" }, { QMG_NO_CATALOG_REFRESH: "1" }]) {
    const { calls, spawnImpl } = spawnRecorder();
    assert.equal(maybeRefreshInBackground({ env, now: NOW, spawnImpl }), false);
    assert.equal(calls.length, 0);
  }
});

function fakeFetch(status, body) {
  const seen = [];
  return {
    seen,
    fetchImpl: async (url, options) => {
      seen.push({ url, options });
      return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    }
  };
}

test("the worker writes the fresh coding catalog with a timestamp", async () => {
  const dir = home({ generated_at: ago(2 * MAX_AGE_MS), data: [{ id: "old/model", coding: true }] });
  const { seen, fetchImpl } = fakeFetch(200, { data: [{ id: "new/model", coding: true }, { id: "tts/x", coding: false }] });

  assert.equal(await refreshCatalog({ apiBase: "https://qumge.test/", apiKey: "sk_x", fetchImpl, now: () => new Date(NOW) }), true);
  assert.equal(seen[0].url, "https://qumge.test/v1/models?category=coding");
  assert.equal(seen[0].options.headers.Authorization, "Bearer sk_x");
  const saved = JSON.parse(readFileSync(path.join(dir, "models.json"), "utf8"));
  assert.deepEqual(saved.data.map((m) => m.id), ["new/model"]);
  assert.equal(saved.generated_at, new Date(NOW).toISOString());
});

// 刷新失败、或网关回了一个空列表时，旧目录必须留着 —— 否则 /model 会变成空的。
test("a failed or empty answer keeps the catalog that works", async () => {
  for (const [status, body] of [[401, { error: { message: "Invalid API key" } }], [200, { data: [] }], [200, { nope: 1 }]]) {
    const dir = home({ generated_at: ago(2 * MAX_AGE_MS), data: [{ id: "old/model", coding: true }] });
    const { fetchImpl } = fakeFetch(status, body);
    assert.equal(await refreshCatalog({ apiBase: "https://qumge.test", apiKey: "sk_x", fetchImpl }), false);
    const saved = JSON.parse(readFileSync(path.join(dir, "models.json"), "utf8"));
    assert.deepEqual(saved.data.map((m) => m.id), ["old/model"], `${status} ${JSON.stringify(body)}`);
  }
});

test("a network error is swallowed", async () => {
  home(null);
  const fetchImpl = async () => { throw new TypeError("fetch failed"); };
  assert.equal(await refreshCatalog({ apiBase: "https://qumge.test", apiKey: "sk_x", fetchImpl }), false);
});
