import { test } from "node:test";
import assert from "node:assert/strict";
import { formatBalance, formatModels } from "../lib/format.mjs";

const balance = {
  email: "a@b.c",
  balance_micro_usd: 8000000,
  balance: 8.0,
  withdrawable_micro_usd: 6000000,
  withdrawable: 6.0,
  buckets: { topup_micro_usd: 2000000, income_micro_usd: 6000000 },
  monthly_income_micro_usd: 4500000,
  monthly_income: 4.5,
  currency: "USD"
};

test("renders balance, withdrawable, earnings and the account", () => {
  assert.deepEqual(formatBalance(balance), [
    "Balance $8.00 (top-up $2.00 + earnings $6.00)",
    "Withdrawable $6.00",
    "Earnings this month $4.50",
    "a@b.c"
  ]);
});

test("renders an empty wallet as $0.00", () => {
  const empty = {
    ...balance,
    balance_micro_usd: 0,
    balance: 0,
    withdrawable_micro_usd: 0,
    withdrawable: 0,
    buckets: { topup_micro_usd: 0, income_micro_usd: 0 },
    monthly_income_micro_usd: 0,
    monthly_income: 0
  };
  const lines = formatBalance(empty);
  assert.equal(lines[0], "Balance $0.00 (top-up $0.00 + earnings $0.00)");
  assert.ok(!lines.join("\n").includes("NaN"));
  assert.ok(!lines.join("\n").includes("$-.--"));
});

const models = [
  { id: "deepseek/deepseek-chat", display_name: "DeepSeek Chat", featured: true, context_window: 128000,
    input_price_per_mtoken_usd: 0.28, output_price_per_mtoken_usd: 1.1,
    capabilities: { tools: true, vision: false } },
  { id: "x/no-price", display_name: "No Price", featured: false, context_window: null,
    capabilities: { tools: false, vision: false } }
];

test("shows the featured marker, prices, context and capabilities", () => {
  const lines = formatModels(models);
  assert.equal(
    lines[0],
    "★ DeepSeek Chat (deepseek/deepseek-chat) — in $0.28 / out $1.10 per M — 128k ctx — tools"
  );
});

test("renders missing prices as a dash, never NaN", () => {
  const lines = formatModels(models);
  assert.match(lines[1], /in — \/ out — per M/);
  assert.ok(!lines.join("\n").includes("NaN"));
  assert.ok(!lines[1].startsWith("★"));
});
