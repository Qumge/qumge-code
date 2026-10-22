import { readFileSync } from "node:fs";
import { apiClient } from "./lib/api.mjs";
import { formatBalance, formatModels } from "./lib/format.mjs";
import { codingModels } from "./lib/models.mjs";

const DEFAULT_BASE = "https://qumge.com";

// Bundled on purpose: a fetch here would put a catalog download in front of
// the first token. Regenerated at release by `npm run models`.
function bundledCatalog() {
  const file = process.env.QUMGE_MODELS_FILE || new URL("./models.json", import.meta.url);
  return JSON.parse(readFileSync(file, "utf8"));
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
  const base = (process.env.QUMGE_API_BASE || DEFAULT_BASE).replace(/\/$/, "");

  pi.registerProvider("qumge", {
    name: "Qumge",
    baseUrl: `${base}/v1`,
    apiKey: "$QUMGE_API_KEY",
    api: "openai-completions",
    models: codingModels(bundledCatalog())
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
