import { readFileSync } from "node:fs";
import { apiClient } from "./lib/api.mjs";
import { formatBalance, formatModels } from "./lib/format.mjs";
import { codingModels } from "./lib/models.mjs";
import { loadCatalog } from "./lib/credentials.mjs";

const DEFAULT_BASE = "https://qumge.com";

// No fetch here — a catalog download in front of the first token would be paid
// on every start. qmg login writes the live catalog next to the credentials;
// the bundled copy is the fallback for a key that was never logged in.
function catalog() {
  if (process.env.QUMGE_MODELS_FILE) {
    return JSON.parse(readFileSync(process.env.QUMGE_MODELS_FILE, "utf8"));
  }
  return loadCatalog() || JSON.parse(readFileSync(new URL("./models.json", import.meta.url), "utf8"));
}

// Pi installs a no-op UI in print mode, so notify would vanish there.
function say(ctx, text) {
  if (ctx?.hasUI) ctx.ui.notify(text, "info");
  else console.log(text);
}

function sessionClient(base) {
  const apiKey = process.env.QUMGE_API_KEY;
  if (!apiKey) return null;
  return apiClient({ apiBase: base, apiKey });
}

export default function (pi) {
  // spawn stringifies an undefined env value, so a saved credential without an
  // api_base reaches us as the literal string "undefined" — a truthy base URL
  // that would send every request to undefined/v1.
  const rawBase = process.env.QUMGE_API_BASE;
  const base = (rawBase && rawBase !== "undefined" ? rawBase : DEFAULT_BASE).replace(/\/$/, "");

  pi.registerProvider("qumge", {
    name: "Qumge",
    baseUrl: `${base}/v1`,
    apiKey: "$QUMGE_API_KEY",
    api: "openai-completions",
    models: codingModels(catalog())
  });

  pi.registerCommand("models", {
    description: "Qumge coding models and prices",
    handler: async (_args, ctx) => {
      const client = sessionClient(base);
      if (!client) return say(ctx, "No Qumge key in this session — run qmg login.");
      try {
        say(ctx, formatModels((await client.models("coding")).data).join("\n"));
      } catch (error) {
        say(ctx, error.message);
      }
    }
  });

  pi.registerCommand("balance", {
    description: "Qumge wallet balance",
    handler: async (_args, ctx) => {
      const client = sessionClient(base);
      if (!client) return say(ctx, "No Qumge key in this session — run qmg login.");
      try {
        say(ctx, formatBalance(await client.balance()).join("\n"));
      } catch (error) {
        say(ctx, error.message);
      }
    }
  });
}
