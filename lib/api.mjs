const NON_JSON =
  "Qumge returned a non-JSON response — the request was blocked before it reached the API. Try again.";

function errorForStatus(status, json) {
  if (status === 401) return new Error("Invalid API key — run qmg login again.");
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
