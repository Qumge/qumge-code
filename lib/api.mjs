const NON_JSON =
  "Qumge returned a non-JSON response — the request was blocked before it reached the API. Try again.";

function errorForStatus(status, json) {
  if (status === 401) return new Error("Invalid API key — run qumge login again.");
  if (status === 402) {
    const message = json.error?.message || "Insufficient balance";
    const topupUrl = json.topup_url || "https://qumge.com/gateway/wallet";
    return new Error(`${message} — top up at ${topupUrl}`);
  }
  return new Error(json.error?.message || `Qumge returned HTTP ${status}.`);
}

export function apiClient({ apiBase = "https://qumge.com", apiKey, fetchImpl = fetch }) {
  const base = apiBase.replace(/\/$/, "");
  const headers = { Authorization: `Bearer ${apiKey}`, Accept: "application/json" };

  async function get(path) {
    const response = await fetchImpl(`${base}${path}`, { headers });
    const text = await response.text();

    let json;
    try {
      json = JSON.parse(text);
    } catch {
      // The edge serves HTML for blocked requests; a JSON parse error here
      // would read as our bug rather than "the request never reached us".
      throw new Error(NON_JSON);
    }

    if (response.ok) return json;
    throw errorForStatus(response.status, json);
  }

  return {
    balance: () => get("/v1/balance"),
    models: (category) => get(`/v1/models${category ? `?category=${encodeURIComponent(category)}` : ""}`)
  };
}

// Called only after the agent exited non-zero: one request buys a sentence the
// user can act on. Never on the success path — a probe measured 0.6-0.9 s,
// more than Pi's entire startup.
export async function explainFailure({ apiBase, apiKey, fetchImpl = fetch, timeoutMs = 3000 }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const client = apiClient({
      apiBase,
      apiKey,
      fetchImpl: (url, options) => fetchImpl(url, { ...options, signal: controller.signal })
    });
    const balance = await client.balance();
    // The real /v1/balance answers 200 even when the wallet is empty; the 402
    // that ends a run comes from the chat call. So the actionable case is a
    // zero balance here, and the top-up URL rides in this body.
    if (Number(balance.balance_micro_usd) <= 0) {
      return `Your Qumge balance is empty — top up at ${balance.topup_url || "https://qumge.com/gateway/wallet"}`;
    }
    return "The agent exited with an error — see the message above.";
  } catch (error) {
    if (error.name === "AbortError") {
      return "Could not reach Qumge (timed out). Check your connection and try again.";
    }
    if (error instanceof TypeError) {
      return "Could not reach Qumge (network error). Check your connection and try again.";
    }
    return error.message;
  } finally {
    clearTimeout(timer);
  }
}
