import { test } from "node:test";
import assert from "node:assert/strict";
import { codingModels, toProviderModel } from "../lib/models.mjs";

const payload = {
  data: [
    { id: "anthropic/claude-opus-4-6", display_name: "Claude Opus 4.6", context_window: 200000,
      input_price_per_mtoken_usd: 30.0, output_price_per_mtoken_usd: 150.0, max_tokens: 8192,
      featured: false, coding: true, capabilities: { tools: true, vision: true }, input_modalities: ["text", "image"] },
    { id: "deepseek/deepseek-chat", display_name: "DeepSeek Chat", context_window: 128000,
      input_price_per_mtoken_usd: 0.28, output_price_per_mtoken_usd: 1.1, max_tokens: 8192,
      featured: true, coding: true, capabilities: { tools: true, vision: false }, input_modalities: ["text"] }
  ]
};

// 顺序是网关给的（精选在前、再按智能指数）：第一个就是登录后的默认模型。
// 以前这里按价格重排，新用户拿到的是最便宜的而不是推荐的。
test("maps gateway entries to Pi model configs and keeps the gateway's order", () => {
  const models = codingModels(payload);
  assert.deepEqual(models.map((m) => m.id), ["anthropic/claude-opus-4-6", "deepseek/deepseek-chat"]);
  assert.equal(models[1].name, "DeepSeek Chat · in $0.28 / out $1.10 per M", "the picker shows the price");
  assert.deepEqual(models[1].cost, { input: 0.28, output: 1.1, cacheRead: 0, cacheWrite: 0 });
  assert.deepEqual(models[1].input, ["text"]);
  assert.deepEqual(models[0].input, ["text", "image"]);
  assert.equal(models[1].maxTokens, 8192);
  assert.equal(models[1].contextWindow, 128000);
  assert.equal(models[1].reasoning, false);
});

// 生产网关没升级时不会带 coding 字段。那时保留全部 458 个模型会静默发一个
// 并不是「编程目录」的目录上 npm，所以这里要求字段明确为 true。
test("keeps only entries the gateway marked as coding", () => {
  const stale = {
    data: [
      { ...payload.data[0], coding: false },
      { ...payload.data[1], coding: undefined },
      { ...payload.data[1], id: "x/coding", coding: true }
    ]
  };
  assert.deepEqual(codingModels(stale).map((m) => m.id), ["x/coding"]);
});

test("prices below a dollar keep two significant digits instead of rounding to $0.00", () => {
  const [cheap] = codingModels({ data: [{ ...payload.data[1], input_price_per_mtoken_usd: 0.0088, output_price_per_mtoken_usd: 0.236 }] });
  assert.equal(cheap.name, "DeepSeek Chat · in $0.0088 / out $0.24 per M");
});

test("falls back to Pi's defaults for missing context and output limits", () => {
  const model = toProviderModel({ ...payload.data[1], context_window: null, max_tokens: null });
  assert.equal(model.contextWindow, 128000);
  assert.equal(model.maxTokens, 4096);
});
