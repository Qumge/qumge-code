import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const { saveCredentials, loadCredentials, clearCredentials, saveCatalog, loadCatalog } = await import("../lib/credentials.mjs");

function freshHome() {
  process.env.QMG_HOME = mkdtempSync(path.join(tmpdir(), "qmg-test-"));
  return process.env.QMG_HOME;
}

const creds = {
  api_key: "sk_qumge_test",
  api_base: "https://qumge.com",
  email: "a@b.c",
  default_model: "deepseek/deepseek-chat"
};

test("saves credentials readable only by the owner", () => {
  const home = freshHome();
  saveCredentials(creds);

  assert.deepEqual(loadCredentials(), creds);
  assert.equal(statSync(path.join(home, "credentials.json")).mode & 0o777, 0o600);
  assert.equal(statSync(home).mode & 0o777, 0o700);
});

test("returns null when nobody has logged in", () => {
  freshHome();
  assert.equal(loadCredentials(), null);
});

// 一个坏文件不能变成一次崩溃：它只说明「这次登录不算数」，下一步永远是 qmg login。
test("returns null for a corrupt file instead of throwing", () => {
  const home = freshHome();
  writeFileSync(path.join(home, "credentials.json"), "{ not json");
  assert.equal(loadCredentials(), null);
});

test("clear removes the file and tolerates a missing one", () => {
  const home = freshHome();
  saveCredentials(creds);
  clearCredentials();
  assert.equal(loadCredentials(), null);
  assert.throws(() => readFileSync(path.join(home, "credentials.json")));
  clearCredentials();
});

test("honours a QMG_HOME that already exists with wider permissions", () => {
  const home = mkdtempSync(path.join(tmpdir(), "qmg-test-"));
  mkdirSync(home, { recursive: true, mode: 0o755 });
  process.env.QMG_HOME = home;
  saveCredentials(creds);
  assert.equal(statSync(path.join(home, "credentials.json")).mode & 0o777, 0o600);
});

// 模型目录在登录时落盘：价格的唯一来源是网关，随包发出去的那份到下个版本就会旧。
test("caches the coding catalog next to the credentials", () => {
  const home = freshHome();
  const catalog = { generated_at: "2026-10-22T00:00:00.000Z", data: [{ id: "a/b", coding: true }] };

  saveCatalog(catalog);

  assert.deepEqual(loadCatalog(), catalog);
  assert.equal(statSync(path.join(home, "models.json")).mode & 0o777, 0o600);
});

test("a missing or corrupt cached catalog is null, never a crash", () => {
  const home = freshHome();
  assert.equal(loadCatalog(), null);

  writeFileSync(path.join(home, "models.json"), "{ not json");
  assert.equal(loadCatalog(), null);

  writeFileSync(path.join(home, "models.json"), JSON.stringify({ data: "nope" }));
  assert.equal(loadCatalog(), null);
});
