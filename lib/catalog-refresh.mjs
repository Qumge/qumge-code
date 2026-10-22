import { spawn } from "node:child_process";
import { readFileSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { catalogPath, credentialsDir, saveCatalog } from "./credentials.mjs";

// Keeps the cached coding catalog (~/.qmg/models.json) fresh without putting a
// network request in front of the first token.
//
// At start the launcher only reads two timestamps. If the catalog is older than a
// day it spawns a detached worker and moves on; this session uses the catalog it
// already has, the next one gets the fresh copy. A failing refresh is retried at
// most once an hour, so a bad network does not cost every start a process.

export const MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const RETRY_AFTER_MS = 60 * 60 * 1000;
const WORKER = fileURLToPath(new URL("./catalog-refresh-worker.mjs", import.meta.url));

function attemptPath() {
  return path.join(credentialsDir(), "models.refresh-attempt");
}

export function catalogAge(now = Date.now()) {
  try {
    const catalog = JSON.parse(readFileSync(catalogPath(), "utf8"));
    const at = Date.parse(catalog?.generated_at);
    return Number.isFinite(at) ? now - at : Infinity;
  } catch {
    return Infinity;
  }
}

function lastAttemptAge(now) {
  try {
    return now - statSync(attemptPath()).mtimeMs;
  } catch {
    return Infinity;
  }
}

// Decides, and starts the worker. Never throws and never waits: it runs on the
// path to the first token.
export function maybeRefreshInBackground({ env = process.env, now = Date.now(), spawnImpl = spawn } = {}) {
  // An explicit catalog file (tests, local runs) is the caller's to manage.
  if (env.QUMGE_MODELS_FILE || env.QMG_NO_CATALOG_REFRESH === "1") return false;
  if (catalogAge(now) < MAX_AGE_MS) return false;
  if (lastAttemptAge(now) < RETRY_AFTER_MS) return false;

  try {
    mkdirSync(credentialsDir(), { recursive: true, mode: 0o700 });
    writeFileSync(attemptPath(), `${new Date(now).toISOString()}\n`, { mode: 0o600 });
    const child = spawnImpl(process.execPath, [WORKER], { detached: true, stdio: "ignore", env });
    child.on?.("error", () => {});
    child.unref?.();
    return true;
  } catch {
    return false;
  }
}

// The worker's job, kept here so it is testable without a process.
export async function refreshCatalog({ apiBase, apiKey, fetchImpl = fetch, timeoutMs = 15_000, now = () => new Date() }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const base = String(apiBase || "https://qumge.com").replace(/\/$/, "");
    const response = await fetchImpl(`${base}/v1/models?category=coding`, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
      signal: controller.signal
    });
    if (!response.ok) return false;
    const payload = await response.json();
    const data = Array.isArray(payload?.data) ? payload.data.filter((entry) => entry.coding === true) : [];
    // An empty or malformed answer must not replace a catalog that works: the
    // picker would come up empty until the next successful refresh.
    if (data.length === 0) return false;
    saveCatalog({ generated_at: now().toISOString(), data });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
