import { hostname } from "node:os";
import { codingModels } from "./models.mjs";
import { openUrl } from "./open-url.mjs";

const DEFAULT_BASE = "https://qumge.com";
const DEFAULT_TIMEOUT_MS = 660_000; // ten minutes to approve on the website, plus slack

function nonJsonError() {
  return new Error(
    "Qumge returned a non-JSON response — the request was blocked before it reached the API. " +
      "Try again, or report this at https://github.com/Qumge/qumge-code/issues."
  );
}

async function requestJson(fetchImpl, url, options) {
  const response = await fetchImpl(url, options);
  const text = await response.text();
  try {
    return { response, json: JSON.parse(text) };
  } catch {
    throw nonJsonError();
  }
}

// The device flow (RFC 8628) against our own endpoints. Everything impure is
// injected so the tests run in milliseconds: fetchImpl, sleep, out.
export async function login({
  apiBase = DEFAULT_BASE,
  fetchImpl = fetch,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  out = (line) => console.log(line),
  deviceName = `qumge on ${hostname()}`,
  locale,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  openBrowser = openUrl
} = {}) {
  const base = apiBase.replace(/\/$/, "");
  const headers = { "Content-Type": "application/json", Accept: "application/json" };

  const { json: code } = await requestJson(fetchImpl, `${base}/device/code`, {
    method: "POST",
    headers,
    body: JSON.stringify(locale ? { device_name: deviceName, locale } : { device_name: deviceName })
  });

  // Open the page for them; the link is printed either way, because "opened"
  // only means the OS accepted the request, not that a browser appeared.
  if (openBrowser(code.verification_uri_complete)) {
    out("Opening your browser to sign in…");
    out(`If it didn't open, go to: ${code.verification_uri_complete}`);
  } else {
    out(`To sign in, open: ${code.verification_uri_complete}`);
  }
  out(`If asked for a code, enter: ${code.user_code}`);
  out("Waiting for approval…");

  const deadline = Date.now() + timeoutMs;
  let interval = Number(code.interval) > 0 ? Number(code.interval) : 5;
  let apiKey;

  for (;;) {
    if (Date.now() > deadline) throw new Error("Sign-in expired — run qumge login again.");
    await sleep(interval * 1000);

    const { response, json } = await requestJson(fetchImpl, `${base}/device/token`, {
      method: "POST",
      headers,
      body: JSON.stringify({ device_code: code.device_code })
    });

    if (response.ok) {
      apiKey = json.access_token;
      break;
    }

    switch (json.error) {
      case "authorization_pending":
        break;
      case "slow_down":
        interval += 5;
        break;
      case "expired_token":
        throw new Error("This sign-in expired — run qumge login again.");
      case "access_denied":
        throw new Error("Sign-in was denied on the website — run qumge login to try again.");
      default:
        throw new Error(`Sign-in failed (${json.error || `HTTP ${response.status}`}) — run qumge login again.`);
    }
  }

  const auth = { Authorization: `Bearer ${apiKey}` };
  const { json: balance } = await requestJson(fetchImpl, `${base}/v1/balance`, { headers: auth });
  const { json: models } = await requestJson(fetchImpl, `${base}/v1/models?category=coding`, { headers: auth });

  // The gateway's first recommended coding model (featured first, then by
  // intelligence): the default should be one that works well, not the cheapest.
  return {
    api_key: apiKey,
    api_base: base,
    email: balance.email,
    default_model: codingModels(models)[0]?.id || null,
    // Handed back rather than written here: this module does not touch the
    // filesystem, and the caller already owns the credential file.
    catalog: {
      generated_at: new Date().toISOString(),
      data: (models.data || []).filter((entry) => entry.coding === true)
    }
  };
}
