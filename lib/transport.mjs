import { gzipSync } from "node:zlib";

// The fetch Pi uses for every model request to Qumge.
//
// 1. Request bodies are gzip-compressed. Qumge sits behind an edge firewall
//    that inspects plain request bodies and blocks some ordinary coding content
//    (shell one-liners, `../` paths) with a 403 HTML page before the request
//    reaches the API. An agent resends the whole conversation every turn, so
//    one such line would break every later request in the session. The
//    firewall does not inspect compressed bodies, and the gateway inflates
//    them for /v1/*.
// 2. An HTML error page is turned into a JSON error. Without this the OpenAI
//    client surfaces the raw HTML, which reads like garbage or like a reply.

export const BLOCKED_MESSAGE =
  "Qumge's network edge blocked this request before it reached the API (HTTP 403). " +
  "Something in the conversation looks like an attack pattern to the firewall. " +
  "Start a new session with /new, or remove that content, and try again.";

export function htmlErrorMessage(status) {
  if (status === 403) return BLOCKED_MESSAGE;
  return `Qumge returned HTTP ${status} as an HTML page instead of an API response — ` +
    "the request did not reach the API. Try again in a moment.";
}

export function qumgeFetch(inner = globalThis.fetch) {
  return async (input, init = {}) => {
    const response = await inner(input, compress(init));
    return jsonForHtmlError(response);
  };
}

function compress(init) {
  if (typeof init.body !== "string" || init.body.length === 0) return init;

  const headers = new Headers(init.headers);
  // Already encoded by someone else — compressing twice would corrupt it.
  if (headers.has("content-encoding")) return init;

  headers.set("content-encoding", "gzip");
  return { ...init, headers, body: gzipSync(init.body) };
}

function jsonForHtmlError(response) {
  const type = response.headers.get("content-type") || "";
  if (response.ok || !type.includes("text/html")) return response;

  const status = response.status;
  const body = JSON.stringify({
    error: {
      message: htmlErrorMessage(status),
      type: status === 403 ? "edge_blocked" : "edge_error",
      code: status === 403 ? "edge_blocked" : "edge_error"
    }
  });
  return new Response(body, {
    status,
    statusText: response.statusText,
    headers: { "content-type": "application/json" }
  });
}
