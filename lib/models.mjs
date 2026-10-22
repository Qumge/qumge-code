// Gateway entries -> Pi provider model configs. Pure: the mapping rules are
// what break when the gateway changes its shape, and they break silently
// (wrong price, wrong context window), so they are pinned by tests.
const DEFAULT_CONTEXT_WINDOW = 128000;
const DEFAULT_MAX_TOKENS = 4096;

function usdPerMillion(value) {
  if (value === null || value === undefined) return "—";
  const n = Number(value);
  // Cheap models are priced in fractions of a cent; two decimals would show $0.00.
  return `$${n >= 1 ? n.toFixed(2) : Number(n.toPrecision(2))}`;
}

// What the /model picker shows as "Model Name": the price rides along, so the
// choice can be made without a second command. It is the price cached at login;
// /prices fetches the live one.
export function pickerName(entry) {
  const name = entry.display_name || entry.id;
  return `${name} · in ${usdPerMillion(entry.input_price_per_mtoken_usd)} / out ${usdPerMillion(entry.output_price_per_mtoken_usd)} per M`;
}

export function toProviderModel(entry) {
  const vision = Boolean(entry.capabilities?.vision);
  return {
    id: entry.id,
    name: pickerName(entry),
    input: ["text", ...(vision ? ["image"] : [])],
    // USD per MILLION tokens, same unit as /v1/models.
    cost: {
      input: entry.input_price_per_mtoken_usd,
      output: entry.output_price_per_mtoken_usd,
      cacheRead: 0,
      cacheWrite: 0
    },
    reasoning: false, // the gateway does not expose it yet
    contextWindow: entry.context_window || DEFAULT_CONTEXT_WINDOW,
    maxTokens: entry.max_tokens || DEFAULT_MAX_TOKENS
  };
}

// `coding === true`, not `coding !== false`: a gateway that predates the
// coding filter omits the field entirely, and keeping those entries would
// publish all 458 models as "the coding catalog".
//
// The order is the gateway's: featured first, then by Artificial Analysis
// intelligence (see Model#coding_recommended? in qumg). The first entry is the
// default model at login, so re-sorting here (it used to sort by price) would
// hand new users the cheapest model instead of the recommended one.
export function codingModels(payload) {
  const entries = (payload?.data || []).filter((entry) => entry.coding === true);
  return entries.map(toProviderModel);
}
