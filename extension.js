import { readFileSync } from "node:fs";
import { codingModels } from "./lib/models.mjs";

const DEFAULT_BASE = "https://qumge.com";

// Bundled on purpose: a fetch here would put a catalog download in front of
// the first token. Regenerated at release by `npm run models`.
function bundledCatalog() {
  const file = process.env.QUMGE_MODELS_FILE || new URL("./models.json", import.meta.url);
  return JSON.parse(readFileSync(file, "utf8"));
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
}
