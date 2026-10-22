import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { apiClient, explainFailure } from "../lib/api.mjs";

async function withServer(handler, fn) {
  const server = createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      const reply = handler(req);
      res.statusCode = reply.status || 200;
      res.setHeader("Content-Type", reply.contentType || "application/json");
      res.end(typeof reply.body === "string" ? reply.body : JSON.stringify(reply.body));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    return await fn(base);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("sends the key and asks for the coding catalog", async () => {
  let seen;
  await withServer(
    (req) => {
      seen = { url: req.url, auth: req.headers.authorization };
      return { body: { data: [{ id: "x/y", coding: true }] } };
    },
    async (base) => {
      const client = apiClient({ apiBase: base, apiKey: "sk_test" });
      const json = await client.models("coding");
      assert.equal(json.data[0].id, "x/y");
      assert.equal(seen.url, "/v1/models?category=coding");
      assert.equal(seen.auth, "Bearer sk_test");
    }
  );
});

test("a 401 becomes the sentence that fixes it", async () => {
  await withServer(
    () => ({ status: 401, body: { error: { message: "Invalid API key" } } }),
    async (base) => {
      const client = apiClient({ apiBase: base, apiKey: "sk_bad" });
      await assert.rejects(client.balance(), /Invalid API key — run qmg login again\./);
    }
  );
});

test("a 402 carries the top-up link", async () => {
  await withServer(
    () => ({
      status: 402,
      body: {
        error: { code: "insufficient_balance", message: "Wallet balance insufficient" },
        topup_url: "https://qumge.com/gateway/wallet?amount=10"
      }
    }),
    async (base) => {
      const client = apiClient({ apiBase: base, apiKey: "sk_broke" });
      await assert.rejects(client.balance(), (error) => {
        assert.match(error.message, /insufficient/i);
        assert.match(error.message, /https:\/\/qumge\.com\/gateway\/wallet\?amount=10/);
        return true;
      });
    }
  );
});

test("an HTML edge response says it never reached the API", async () => {
  await withServer(
    () => ({ status: 403, contentType: "text/html", body: "<html>nope</html>" }),
    async (base) => {
      const client = apiClient({ apiBase: base, apiKey: "sk_test" });
      await assert.rejects(client.models("coding"), /non-JSON response/);
    }
  );
});

// The launcher runs this only after the agent exited non-zero, so the happy
// path never pays for it.
test("a healthy account after a failed run says to read the error above", async () => {
  await withServer(
    () => ({ body: { email: "a@b.c" } }),
    async (base) => {
      assert.match(await explainFailure({ apiBase: base, apiKey: "sk_test" }), /exited with an error/);
    }
  );
});

test("explains a bad key after the failure", async () => {
  await withServer(
    () => ({ status: 401, body: { error: { message: "Invalid API key" } } }),
    async (base) => {
      assert.match(await explainFailure({ apiBase: base, apiKey: "sk_bad" }), /run qmg login again/);
    }
  );
});

test("explains an empty wallet with the top-up link", async () => {
  await withServer(
    () => ({
      status: 402,
      body: { error: { message: "Insufficient balance" }, topup_url: "https://qumge.test/wallet" }
    }),
    async (base) => {
      assert.match(await explainFailure({ apiBase: base, apiKey: "sk_broke" }), /https:\/\/qumge\.test\/wallet/);
    }
  );
});

test("explains an edge block after the failure", async () => {
  await withServer(
    () => ({ status: 403, contentType: "text/html", body: "<html>nope</html>" }),
    async (base) => {
      assert.match(await explainFailure({ apiBase: base, apiKey: "sk_test" }), /non-JSON response/);
    }
  );
});

test("explains an unreachable gateway instead of a bare fetch error", async () => {
  const message = await explainFailure({ apiBase: "http://127.0.0.1:1", apiKey: "sk_test" });
  assert.match(message, /Could not reach Qumge/);
});
