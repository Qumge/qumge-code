import { createServer } from "node:http";
import { gunzipSync } from "node:zlib";

// Minimal OpenAI-compatible gateway for the end-to-end test. It records every
// request so tests can assert what the launcher actually asked for — order and
// absence matter as much as success (no balance call on the happy path).
export async function startStubGateway({
  chat,
  balance,
  // Simulates the edge firewall: return true to answer with its 403 HTML page.
  blockWhen,
  models = [{ id: "test/model", coding: true, featured: true, context_window: 8192, max_tokens: 1024,
    input_price_per_mtoken_usd: 1, output_price_per_mtoken_usd: 2,
    capabilities: { tools: true, vision: false }, input_modalities: ["text"] }]
} = {}) {
  const requests = [];

  const chatReply =
    chat ||
    {
      stream: true,
      body:
        `data: ${JSON.stringify({ id: "c1", object: "chat.completion.chunk", created: 0, model: "test/model", choices: [{ index: 0, delta: { role: "assistant", content: "OK" }, finish_reason: null }] })}\n\n` +
        `data: ${JSON.stringify({ id: "c1", object: "chat.completion.chunk", created: 0, model: "test/model", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n` +
        `data: [DONE]\n\n`
    };

  const balanceReply = balance || {
    status: 200,
    body: { email: "stub@example.com", balance_micro_usd: 10_000_000, withdrawable_micro_usd: 0,
      buckets: { topup_micro_usd: 10_000_000, income_micro_usd: 0 }, monthly_income_micro_usd: 0 }
  };

  const server = createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      // Inflate like the real gateway does for /v1/* (app/middleware/gzip_request_body.rb).
      const encoding = req.headers["content-encoding"] || null;
      const raw = Buffer.concat(chunks);
      const body = (encoding === "gzip" ? gunzipSync(raw) : raw).toString("utf8");
      requests.push({
        method: req.method,
        path: req.url,
        authorization: req.headers.authorization,
        encoding,
        body: body ? safeJson(body) : null
      });
      if (blockWhen && blockWhen(body, encoding)) {
        return send(res, { status: 403, contentType: "text/html", body: "<html><body>Sorry, you have been blocked</body></html>" });
      }

      if (req.method === "GET" && req.url.startsWith("/v1/models")) {
        return send(res, { status: 200, body: { data: models } });
      }
      if (req.method === "GET" && req.url.startsWith("/v1/balance")) {
        return send(res, balanceReply);
      }
      if (req.method === "POST" && req.url.startsWith("/v1/chat/completions")) {
        return send(res, chatReply);
      }
      send(res, { status: 404, body: { error: { message: "not found" } } });
    });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  return {
    base,
    requests,
    // Pi keeps its HTTP connection alive, so close() alone would wait forever
    // and hang the test run.
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections?.();
        server.close(resolve);
      })
  };
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function send(res, reply) {
  res.statusCode = reply.status || 200;
  if (reply.stream) {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.end(reply.body);
    return;
  }
  res.setHeader("Content-Type", reply.contentType || "application/json");
  res.end(typeof reply.body === "string" ? reply.body : JSON.stringify(reply.body));
}
