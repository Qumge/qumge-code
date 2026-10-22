import { readFileSync } from "node:fs";
import { streamSimple as openAICompletions } from "@earendil-works/pi-ai/api/openai-completions";
import { apiClient } from "./lib/api.mjs";
import { formatBalance, formatModels } from "./lib/format.mjs";
import { codingModels } from "./lib/models.mjs";
import { loadCatalog } from "./lib/credentials.mjs";
import { qumgeFetch } from "./lib/transport.mjs";
import { installGuard } from "./lib/guard.mjs";
import { installBranding } from "./lib/branding.mjs";

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
  // Pi runs every tool call without asking; we ask before the irreversible few.
  installGuard(pi);
  // The startup header and terminal title say QMG Code (lib/branding.mjs).
  installBranding(pi);

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
    models: codingModels(catalog()),
    // Pi's own OpenAI Chat Completions implementation, unchanged, with our
    // fetch underneath: gzip request bodies past the edge firewall and turn
    // its HTML block page into an error (see lib/transport.mjs). Scoped to this
    // provider; other providers keep Pi's default transport.
    streamSimple: (model, context, options) =>
      openAICompletions(model, context, { ...options, fetch: qumgeFetch(options?.fetch) })
  });

  pi.registerCommand("models", {
    description: "Qumge coding models and prices",
    handler: async (_args, ctx) => {
      const client = sessionClient(base);
      if (!client) return say(ctx, "No Qumge key in this session — run qumge login.");
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
      if (!client) return say(ctx, "No Qumge key in this session — run qumge login.");
      try {
        say(ctx, formatBalance(await client.balance()).join("\n"));
      } catch (error) {
        say(ctx, error.message);
      }
    }
  });
}
