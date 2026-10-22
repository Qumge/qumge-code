#!/usr/bin/env node
// Regenerates models.json from the live coding catalog. Run at release time,
// not at launch: the package ships the result so startup does no network.
import { writeFileSync } from "node:fs";
import { codingModels } from "../lib/models.mjs";

const base = (process.env.QUMGE_API_BASE || "https://qumge.com").replace(/\/$/, "");
const apiKey = process.env.QUMGE_API_KEY;

if (!apiKey) {
  console.error("Set QUMGE_API_KEY to generate the catalog.");
  process.exit(1);
}

const response = await fetch(`${base}/v1/models?category=coding`, {
  headers: { Authorization: `Bearer ${apiKey}` }
});

if (!response.ok) {
  console.error(`GET ${base}/v1/models failed: HTTP ${response.status}`);
  process.exit(1);
}

const payload = await response.json();
const entries = payload?.data || [];

// A deployed gateway that predates the coding filter returns the full catalog
// with the field absent. Publishing that would make every user's picker 458
// entries wide, so refuse rather than guess.
if (entries.length > 0 && entries.every((entry) => typeof entry.coding !== "boolean")) {
  console.error("The gateway returned no `coding` field — deploy the gateway with the coding filter first.");
  process.exit(1);
}

const models = codingModels(payload);
if (models.length < 3) {
  console.error(`Only ${models.length} coding models — refusing to write an empty catalog.`);
  process.exit(1);
}

const out = new URL("../models.json", import.meta.url);
writeFileSync(out, `${JSON.stringify({ generated_at: new Date().toISOString(), data: entries.filter((e) => e.coding === true) }, null, 2)}\n`);
console.log(`${models.length} coding models written to models.json`);
