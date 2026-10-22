// Gateway entries -> Pi provider model configs. Pure: the mapping rules are
// what break when the gateway changes its shape, and they break silently
// (wrong price, wrong context window), so they are pinned by tests.
const DEFAULT_CONTEXT_WINDOW = 128000;
const DEFAULT_MAX_TOKENS = 4096;

export function toProviderModel(entry) {
  const vision = Boolean(entry.capabilities?.vision);
  return {
    id: entry.id,
    name: entry.display_name || entry.id,
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
export function codingModels(payload) {
  const entries = (payload?.data || []).filter((entry) => entry.coding === true);

  entries.sort((a, b) => {
    if (Boolean(a.featured) !== Boolean(b.featured)) return a.featured ? -1 : 1;
    const priceA = a.input_price_per_mtoken_usd ?? Infinity;
    const priceB = b.input_price_per_mtoken_usd ?? Infinity;
    if (priceA !== priceB) return priceA - priceB;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  return entries.map(toProviderModel);
}
