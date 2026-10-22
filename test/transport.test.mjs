import { test } from "node:test";
import assert from "node:assert/strict";
import { gunzipSync } from "node:zlib";
import { BLOCKED_MESSAGE, qumgeFetch } from "../lib/transport.mjs";

function recorder(response = new Response("{}", { headers: { "content-type": "application/json" } })) {
  const calls = [];
  const fetchImpl = async (input, init) => {
    calls.push({ input, init });
    return response;
  };
  return { calls, fetchImpl };
}

test("compresses a JSON body and marks it gzip", async () => {
  const { calls, fetchImpl } = recorder();
  const body = JSON.stringify({ model: "m", messages: [{ role: "user", content: "../../etc/passwd" }] });

  await qumgeFetch(fetchImpl)("https://qumge.test/v1/chat/completions", {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer k" }, body
  });

  const { init } = calls[0];
  assert.equal(init.headers.get("content-encoding"), "gzip");
  assert.equal(init.headers.get("authorization"), "Bearer k", "other headers survive");
  assert.equal(gunzipSync(init.body).toString("utf8"), body);
});

test("leaves bodiless and already-encoded requests alone", async () => {
  const { calls, fetchImpl } = recorder();
  const wrapped = qumgeFetch(fetchImpl);

  const get = { method: "GET", headers: { Accept: "application/json" } };
  await wrapped("https://qumge.test/v1/models", get);
  assert.equal(calls[0].init, get);

  const encoded = { method: "POST", headers: { "Content-Encoding": "br" }, body: "x" };
  await wrapped("https://qumge.test/v1/chat/completions", encoded);
  assert.equal(calls[1].init, encoded);
});

test("turns the edge's 403 HTML page into a JSON error with a next step", async () => {
  const html = new Response("<html>blocked</html>", { status: 403, headers: { "content-type": "text/html; charset=utf-8" } });
  const response = await qumgeFetch(recorder(html).fetchImpl)("https://qumge.test/v1/chat/completions", { body: "{}" });

  assert.equal(response.status, 403);
  assert.match(response.headers.get("content-type"), /application\/json/);
  const json = await response.json();
  assert.equal(json.error.message, BLOCKED_MESSAGE);
  assert.equal(json.error.code, "edge_blocked");
});

test("other HTML error pages say the request did not reach the API", async () => {
  const html = new Response("<html>bad gateway</html>", { status: 502, headers: { "content-type": "text/html" } });
  const json = await (await qumgeFetch(recorder(html).fetchImpl)("https://qumge.test/v1/x", {})).json();
  assert.match(json.error.message, /HTTP 502 .*did not reach the API/);
});

test("passes JSON errors and successful streams through untouched", async () => {
  const jsonError = new Response('{"error":{"message":"Invalid API key"}}', { status: 401, headers: { "content-type": "application/json" } });
  assert.equal(await qumgeFetch(recorder(jsonError).fetchImpl)("u", {}), jsonError);

  const stream = new Response("data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
  assert.equal(await qumgeFetch(recorder(stream).fetchImpl)("u", {}), stream);
});
