import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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
    // spawn would pass undefined as the string "undefined" — a catalog path that does not exist.
    if (modelsFile === undefined) delete env.QUMGE_MODELS_FILE;
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
    assert.equal(chat.encoding, "gzip", "chat bodies are compressed past the edge firewall");

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

// The edge firewall reads plain request bodies and blocks some ordinary coding
// content. It does not read compressed ones — this is the whole point of gzip.
test("content the edge firewall would block gets through compressed", async () => {
  const stub = await startStubGateway({
    blockWhen: (body, encoding) => encoding !== "gzip" && body.includes("../../etc/passwd")
  });
  const box = sandbox();
  try {
    const args = ["-p", "why does cat ../../etc/passwd fail here?", "--provider", "qumge", "--model", "test/model"];
    const result = await runQmg(args, { base: stub.base, ...box });

    assert.equal(result.code, 0, result.output);
    assert.match(result.stdout, /OK/);
  } finally {
    await stub.close();
  }
});

// If the edge still blocks the chat call, the user gets a sentence they can act
// on — never the HTML page, and never something that reads like a model reply.
test("a 403 HTML page on the chat call becomes an actionable error", async () => {
  const stub = await startStubGateway({
    chat: { status: 403, contentType: "text/html", body: "<html><body>Sorry, you have been blocked</body></html>" }
  });
  const box = sandbox();
  try {
    const result = await runQmg(PRINT_ARGS, { base: stub.base, ...box });

    assert.notEqual(result.code, 0);
    assert.match(result.output, /network edge blocked this request/);
    assert.match(result.output, /\/new/);
    assert.doesNotMatch(result.output, /<html>|you have been blocked/);
  } finally {
    await stub.close();
  }
});

function sseChunk(delta, finish = null) {
  return `data: ${JSON.stringify({ id: "c", object: "chat.completion.chunk", created: 0, model: "test/model",
    choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
}

// The model asks for `rm -rf victim`, then says done once it sees the result.
function deleteThenAnswer() {
  const toolCall = sseChunk({ role: "assistant", tool_calls: [{ index: 0, id: "call_1", type: "function",
    function: { name: "bash", arguments: JSON.stringify({ command: "rm -rf victim" }) } }] }) +
    sseChunk({}, "tool_calls") + "data: [DONE]\n\n";
  const answer = sseChunk({ role: "assistant", content: "done" }) + sseChunk({}, "stop") + "data: [DONE]\n\n";
  return [{ stream: true, body: toolCall }, { stream: true, body: answer }];
}

function toolResultText(stub) {
  const second = stub.requests.filter((r) => r.path.startsWith("/v1/chat/completions"))[1];
  const tool = second?.body?.messages?.find((m) => m.role === "tool");
  return typeof tool?.content === "string" ? tool.content : JSON.stringify(tool?.content);
}

// Real Pi, real bash tool: the guard has to be wired to the event Pi actually fires.
test("a destructive command is blocked when there is no terminal to ask in", async () => {
  const stub = await startStubGateway({ chat: deleteThenAnswer() });
  const box = sandbox();
  mkdirSync(path.join(box.home, "victim"));
  try {
    const result = await runQmg(PRINT_ARGS, { base: stub.base, ...box });

    assert.equal(result.code, 0, result.output);
    assert.ok(existsSync(path.join(box.home, "victim")), "the directory must survive");
    assert.match(toolResultText(stub), /--yolo/, "the model is told why, and how to allow it");
  } finally {
    await stub.close();
  }
});

test("--yolo lets the same command run", async () => {
  const stub = await startStubGateway({ chat: deleteThenAnswer() });
  const box = sandbox();
  mkdirSync(path.join(box.home, "victim"));
  try {
    const result = await runQmg([...PRINT_ARGS, "--yolo"], { base: stub.base, ...box });

    assert.equal(result.code, 0, result.output);
    assert.equal(existsSync(path.join(box.home, "victim")), false);
  } finally {
    await stub.close();
  }
});

// Interactive path through a real UI channel: Pi's RPC mode turns ctx.ui.select
// into a JSON request on stdout and waits for the answer on stdin — the same
// call the terminal dialog makes.
function runRpc({ base, home, modelsFile }, answer) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, QMG_HOME: home, QUMGE_API_BASE: base, QUMGE_MODELS_FILE: modelsFile, QUMGE_API_KEY: KEY };
    const child = spawn(process.execPath, [BIN, "--mode", "rpc", "--no-session", "--provider", "qumge", "--model", "test/model"],
      { cwd: home, env, stdio: ["pipe", "pipe", "pipe"] });
    const asked = [];
    let buffer = "";
    const timer = setTimeout(() => { child.kill(); reject(new Error(`rpc run timed out; asked=${JSON.stringify(asked)}`)); }, 20000);
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      let newline;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        let message;
        try { message = JSON.parse(line); } catch { continue; }
        if (message.type === "extension_ui_request" && message.method === "select") {
          asked.push({ title: message.title, options: message.options });
          child.stdin.write(JSON.stringify({ type: "extension_ui_response", id: message.id, value: answer }) + "\n");
        }
        if (message.type === "agent_end") {
          clearTimeout(timer);
          child.kill();
          resolve({ asked });
        }
      }
    });
    child.stdin.write(JSON.stringify({ id: "p1", type: "prompt", message: "clean up" }) + "\n");
  });
}

test("interactive: the user is asked, and Deny keeps the files", async () => {
  const stub = await startStubGateway({ chat: deleteThenAnswer() });
  const box = sandbox();
  mkdirSync(path.join(box.home, "victim"));
  try {
    const { asked } = await runRpc({ base: stub.base, ...box }, "Deny");
    assert.equal(asked.length, 1);
    assert.match(asked[0].title, /rm -rf victim/);
    assert.deepEqual(asked[0].options, ["Allow once", "Allow for this session", "Deny"]);
    assert.ok(existsSync(path.join(box.home, "victim")));
    assert.match(toolResultText(stub), /declined/);
  } finally {
    await stub.close();
  }
});

test("interactive: Allow once runs the command", async () => {
  const stub = await startStubGateway({ chat: deleteThenAnswer() });
  const box = sandbox();
  mkdirSync(path.join(box.home, "victim"));
  try {
    const { asked } = await runRpc({ base: stub.base, ...box }, "Allow once");
    assert.equal(asked.length, 1);
    assert.equal(existsSync(path.join(box.home, "victim")), false);
  } finally {
    await stub.close();
  }
});

// 目录每天在后台刷新一次：这次运行照常用手上的目录、不等网络；脱离的子进程把新目录写回
// ~/.qmg/models.json，下次启动才用上。这里不设 QUMGE_MODELS_FILE，走真实的缓存路径。
test("a stale catalog is refreshed in the background without delaying the run", async () => {
  const stub = await startStubGateway({
    models: [{ ...MODEL, id: "fresh/model" }]
  });
  const box = sandbox();
  const cached = path.join(box.home, "models.json");
  writeFileSync(cached, JSON.stringify({ generated_at: "2026-01-01T00:00:00.000Z", data: [MODEL] }));
  try {
    const result = await runQmg(PRINT_ARGS, { base: stub.base, home: box.home, modelsFile: undefined });
    assert.equal(result.code, 0, result.output);
    assert.match(result.stdout, /OK/, "this run used the catalog it had");

    let refreshed = null;
    for (let i = 0; i < 50 && !refreshed; i++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      const saved = JSON.parse(readFileSync(cached, "utf8"));
      if (saved.data.some((m) => m.id === "fresh/model")) refreshed = saved;
    }
    assert.ok(refreshed, "the background worker wrote the fresh catalog");
    assert.ok(Date.parse(refreshed.generated_at) > Date.parse("2026-01-01"), "and stamped it");
    assert.ok(stub.requests.some((r) => r.path === "/v1/models?category=coding" && r.authorization === `Bearer ${KEY}`));
  } finally {
    await stub.close();
  }
});

