// Detached worker started by maybeRefreshInBackground. It has no terminal and no
// one waiting for it, so it reports nothing: success shows up as a fresher
// ~/.qmg/models.json, failure as the old one.
import { loadCredentials } from "./credentials.mjs";
import { refreshCatalog } from "./catalog-refresh.mjs";

const creds = loadCredentials();
if (creds) {
  await refreshCatalog({
    apiBase: process.env.QUMGE_API_BASE || creds.api_base,
    apiKey: process.env.QUMGE_API_KEY || creds.api_key
  });
}
