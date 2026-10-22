#!/usr/bin/env node
// Publishing gate: the catalog is bundled with the package, so an empty one
// would reach every user as an empty model picker.
import { readFileSync } from "node:fs";

const file = new URL("../models.json", import.meta.url);
const catalog = JSON.parse(readFileSync(file, "utf8"));
const coding = (catalog.data || []).filter((entry) => entry.coding === true);

if (coding.length < 3) {
  console.error(
    `models.json has ${coding.length} coding models — run \`npm run models\` against a deployed gateway before publishing.`
  );
  process.exit(1);
}

console.log(`models.json: ${coding.length} coding models (generated ${catalog.generated_at || "never"})`);
