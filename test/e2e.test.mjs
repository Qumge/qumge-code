import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startStubGateway } from "./helpers/stub-gateway.mjs";

const BIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../bin/qumge.mjs");
const KEY = "sk_e2e";

const MODEL = {
  id: "test/model",
  display_name: "Test",
  context_window: 8192,
  max_tokens: 1024,
  featured: true,
  coding: true,
  input_price_per_mtoken_usd: 1,
  output_price_per_mtoken_usd: 2,
  capabilities: { tools: true, vision: false },
  input_modalities: ["text"]
};

function sandbox({ withCredentials = true } = {}) {
  const home = mkdtempSync(path.join(tmpdir(), "qmg-e2e-"));
  const modelsFile = path.join(home, "models.json");
  writeFileSync(modelsFile, JSON.stringify({ generated_at: null, data: [MODEL] }));
  if (withCredentials) {
    writeFileSync(
      path.join(home, "credentials.json"),
      JSON.stringify({ api_key: KEY, api_base: "http://127.0.0.1", email: "stub@example.com", default_model: "test/model" }),
      { mode: 0o600 }
    );
  }
  return { home, modelsFile };
}

function runQmg(args, { base, home, modelsFile, apiKey = KEY }) {
  return new Promise((resolve) => {
    const env = { ...process.env, QMG_HOME: home, QUMGE_API_BASE: base, QUMGE_MODELS_FILE: modelsFile };
    delete env.QUMGE_API_KEY;
    if (apiKey) env.QUMGE_API_KEY = apiKey;

    // stdin must not be an open pipe: Pi waits for EOF on it in print mode and
    // the test would hang instead of failing.
    const child = spawn(process.execPath, [BIN, ...args], { cwd: home, env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("exit", (code) => resolve({ code, stdout, stderr, output: `${stdout}\n${stderr}` }));
  });
}

const PRINT_ARGS = ["-p", "say ok", "--provider", "qumge", "--model", "test/model"];

test("a print-mode run reaches the stub and prints the answer", async () => {
  const stub = await startStubGateway();
  const box = sandbox();
  try {
    const result = await runQmg(PRINT_ARGS, { base: stub.base, ...box });

    assert.equal(result.code, 0, result.output);
    assert.match(result.stdout, /OK/);

    const chat = stub.requests.find((r) => r.path.startsWith("/v1/chat/completions"));
    assert.ok(chat, "the model was called");
    assert.equal(chat.authorization, `Bearer ${KEY}`);
    assert.equal(chat.body.model, "test/model");

    // Speed guard: the success path makes no extra round trips.
    assert.equal(stub.requests.filter((r) => r.path.startsWith("/v1/balance")).length, 0);
  } finally {
    await stub.close();
  }
});

test("without credentials nothing is sent anywhere", async () => {
  const stub = await startStubGateway();
  const box = sandbox({ withCredentials: false });
  try {
    const result = await runQmg(PRINT_ARGS, { base: stub.base, ...box, apiKey: null });

    assert.equal(result.code, 1);
    assert.match(result.stderr, /Run qumge login first\./);
    assert.equal(stub.requests.length, 0);
  } finally {
    await stub.close();
  }
});

test("a 401 is explained and the balance check comes after the failed call", async () => {
  const stub = await startStubGateway({
    chat: { status: 401, body: { error: { message: "Invalid API key", type: "invalid_request_error" } } },
    balance: { status: 401, body: { error: { message: "Invalid API key" } } }
  });
  const box = sandbox();
  try {
    const result = await runQmg(PRINT_ARGS, { base: stub.base, ...box });

    assert.notEqual(result.code, 0);
    assert.match(result.output, /Invalid API key — run qumge login again\./);

    const chatAt = stub.requests.findIndex((r) => r.path.startsWith("/v1/chat/completions"));
    const balanceAt = stub.requests.findIndex((r) => r.path.startsWith("/v1/balance"));
    assert.ok(chatAt >= 0, "the agent tried the call first");
    assert.ok(balanceAt > chatAt, "diagnosis happens after the failure, not before start");
  } finally {
    await stub.close();
  }
});

test("an edge HTML block is reported as not reaching the API", async () => {
  const stub = await startStubGateway({
    chat: { status: 403, contentType: "text/html", body: "<html><body>blocked</body></html>" },
    balance: { status: 403, contentType: "text/html", body: "<html><body>blocked</body></html>" }
  });
  const box = sandbox();
  try {
    const result = await runQmg(PRINT_ARGS, { base: stub.base, ...box });

    assert.notEqual(result.code, 0);
    assert.match(result.output, /non-JSON response/);
    assert.match(result.output, /blocked before it reached the API/);
  } finally {
    await stub.close();
  }
});

test("a 402 points at the top-up URL", async () => {
  const body = {
    error: { code: "insufficient_balance", message: "Wallet balance insufficient" },
    topup_url: "https://qumge.test/gateway/wallet?amount=10"
  };
  // What the gateway really answers: the chat call is the 402; /v1/balance is
  // 200 with an empty wallet and the top-up URL.
  const stub = await startStubGateway({
    chat: { status: 402, body },
    balance: { status: 200, body: { balance_micro_usd: 0, topup_url: body.topup_url } }
  });
  const box = sandbox();
  try {
    const result = await runQmg(PRINT_ARGS, { base: stub.base, ...box });

    assert.notEqual(result.code, 0);
    assert.match(result.output, /https:\/\/qumge\.test\/gateway\/wallet\?amount=10/);
  } finally {
    await stub.close();
  }
});
