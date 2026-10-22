#!/usr/bin/env node
// Startup and end-to-end timings for QMG Code on this machine.
//
// The number that matters is the DELTA between `qumge` and the bare Pi CLI:
// everything else is Pi's own cost. Wall-clock totals are reported too, but
// comparing them against another agent means comparing Pi against that agent,
// not our launcher.
//
// No network beyond 127.0.0.1: the end-to-end run uses the same stub gateway
// the test suite uses.
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { resolvePiCli } from "../lib/pi-cli.mjs";
import { startStubGateway } from "../test/helpers/stub-gateway.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BIN = path.join(ROOT, "bin", "qumge.mjs");
const EXTENSION = path.join(ROOT, "extension.js");
const KEY = "sk_bench";
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

const RUNS = Number(process.env.BENCH_RUNS || 20);
const WARMUP = 3;

function stats(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  return {
    n: sorted.length,
    min: sorted[0],
    p50: at(0.5),
    p95: at(0.95),
    max: sorted[sorted.length - 1]
  };
}

// Each run is a fresh process, which is what the user pays.
function timeProcess(args, env = process.env) {
  const start = performance.now();
  const result = spawnSync(process.execPath, args, { env, encoding: "utf8" });
  const elapsed = performance.now() - start;
  if (result.status !== 0) {
    throw new Error(`exited ${result.status}: ${(result.stderr || "").trim().slice(0, 300)}`);
  }
  return elapsed;
}

function extensionLoad() {
  const script = `
    import { performance } from "node:perf_hooks";
    const t0 = performance.now();
    const mod = await import(${JSON.stringify(EXTENSION)});
    mod.default({ registerProvider() {}, registerCommand() {} });
    console.log(performance.now() - t0);
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8" });
  if (result.status !== 0) throw new Error((result.stderr || "").trim().slice(0, 300));
  return Number(result.stdout.trim().split("\n").pop());
}

async function timeEndToEnd({ n }) {
  const stub = await startStubGateway();
  const home = mkdtempSync(path.join(tmpdir(), "qumge-bench-"));
  writeFileSync(
    path.join(home, "models.json"),
    JSON.stringify({ generated_at: null, data: [MODEL] })
  );
  writeFileSync(
    path.join(home, "credentials.json"),
    JSON.stringify({ api_key: KEY, api_base: "http://127.0.0.1", email: "bench@example.com", default_model: "test/model" }),
    { mode: 0o600 }
  );

  const env = { ...process.env, QMG_HOME: home, QUMGE_API_BASE: stub.base, QUMGE_MODELS_FILE: path.join(home, "models.json"), QUMGE_API_KEY: KEY };

  const once = (argv) =>
    new Promise((resolve, reject) => {
      const start = performance.now();
      let firstChunkAt = null;
      // stdin closed: Pi waits for EOF on an open pipe in print mode.
      const child = spawn(process.execPath, argv, {
        cwd: home,
        env,
        stdio: ["ignore", "pipe", "pipe"]
      });
      let output = "";
      child.stdout.on("data", (chunk) => {
        if (firstChunkAt === null) firstChunkAt = performance.now() - start;
        output += chunk;
      });
      child.stderr.on("data", (chunk) => (output += chunk));
      child.on("error", reject);
      child.on("exit", (code) => {
        if (code !== 0) return reject(new Error(`exited ${code}: ${output.trim().slice(0, 300)}`));
        resolve({ firstChunk: firstChunkAt, total: performance.now() - start });
      });
    });

  // Same arguments our launcher would hand Pi, minus the launcher: the
  // difference between the two rows is the only cost QMG Code adds.
  const bareArgs = [resolvePiCli(), "-e", ROOT, "-p", "say ok", "--provider", "qumge", "--model", "test/model"];

  const collect = async (argv) => {
    const firsts = [];
    const totals = [];
    for (let i = 0; i < n; i += 1) {
      const { firstChunk, total } = await once(argv);
      firsts.push(firstChunk);
      totals.push(total);
    }
    return { firsts, totals };
  };

  const launched = await collect([BIN, "-p", "say ok", "--provider", "qumge", "--model", "test/model"]);
  const bare = await collect(bareArgs);

  await stub.close();
  return { launched, bare };
}

function table(rows) {
  const head = "| metric | n | min | p50 | p95 | max |\n| --- | ---: | ---: | ---: | ---: | ---: |";
  const body = rows
    .map(({ name, s }) => `| ${name} | ${s.n} | ${s.min.toFixed(0)} | ${s.p50.toFixed(0)} | ${s.p95.toFixed(0)} | ${s.max.toFixed(0)} |`)
    .join("\n");
  return `${head}\n${body}`;
}

async function main() {
  const piCli = resolvePiCli();

  const measure = (fn) => {
    for (let i = 0; i < WARMUP; i += 1) fn();
    const samples = [];
    for (let i = 0; i < RUNS; i += 1) samples.push(fn());
    return stats(samples);
  };

  console.log(`node ${process.version} · ${process.platform}/${process.arch} · ${RUNS} runs after ${WARMUP} warm-up`);
  console.log("");

  const qumgeCli = measure(() => timeProcess([BIN, "--version"]));
  const piBare = measure(() => timeProcess([piCli, "--version"]));
  const ext = measure(() => extensionLoad());

  const e2e = await timeEndToEnd({ n: Math.max(5, Math.floor(RUNS / 2)) });

  console.log(
    table([
      { name: "qumge --version (our process)", s: qumgeCli },
      { name: "pi --version (bare Pi)", s: piBare },
      { name: "extension load + register", s: ext },
      { name: "qumge -p → first output (stub gateway)", s: stats(e2e.launched.firsts) },
      { name: "qumge -p → exit (stub gateway)", s: stats(e2e.launched.totals) },
      { name: "pi -p → first output (same args, no launcher)", s: stats(e2e.bare.firsts) }
    ])
  );
  console.log("");
  const launchedP50 = stats(e2e.launched.firsts).p50;
  const bareP50 = stats(e2e.bare.firsts).p50;
  console.log(`launcher overhead to first output: ${(launchedP50 - bareP50).toFixed(1)} ms (p50)`);
  console.log(`our own process before Pi starts: ${qumgeCli.p50.toFixed(1)} ms (p50)`);
}

await main();
