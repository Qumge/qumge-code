import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { login } from "../lib/login.mjs";

// A real HTTP server on 127.0.0.1: the device flow is a conversation about
// status codes and polling, and a fetch stub would let the code be wrong about
// bodies, headers, or method and still pass.
async function withServer(routes, fn) {
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const url = new URL(req.url, "http://127.0.0.1");
    const handler = routes[`${req.method} ${url.pathname}`];
    if (!handler) {
      res.statusCode = 404;
      res.setHeader("Content-Type", "application/json");
      return res.end("{}");
    }
    const reply = await handler({ req, body, url });
    res.statusCode = reply.status || 200;
    res.setHeader("Content-Type", reply.contentType || "application/json");
    res.end(typeof reply.body === "string" ? reply.body : JSON.stringify(reply.body));
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    return await fn(base);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const DEVICE_CODE = {
  device_code: "dc-1",
  user_code: "ABCD-1234",
  verification_uri: "https://qumge.test/en/device",
  verification_uri_complete: "https://qumge.test/en/device?user_code=ABCD-1234",
  expires_in: 600,
  interval: 1
};

const MODELS = {
  data: [
    { id: "slow/expensive", featured: true, coding: true, input_price_per_mtoken_usd: 10 },
    { id: "fast/cheap", featured: true, coding: true, input_price_per_mtoken_usd: 0.2 },
    { id: "plain/model", featured: false, coding: true, input_price_per_mtoken_usd: 99 }
  ]
};

const BALANCE = { email: "a@b.c", balance_micro_usd: 0 };

function deviceRoutes(tokens, extra = {}) {
  const queue = [...tokens];
  return {
    "POST /device/code": () => ({ body: DEVICE_CODE }),
    "POST /device/token": () => {
      const next = queue.shift();
      return next;
    },
    "GET /v1/balance": ({ req }) => {
      assert.equal(req.headers.authorization, "Bearer sk_new");
      return { body: BALANCE };
    },
    "GET /v1/models": ({ url }) => {
      assert.equal(url.searchParams.get("category"), "coding");
      return { body: MODELS };
    },
    ...extra
  };
}

function pending() {
  return { status: 400, body: { error: "authorization_pending" } };
}

test("prints the sign-in URL and code, polls, and returns the new key", async () => {
  await withServer(
    deviceRoutes([pending(), pending(), { body: { access_token: "sk_new", token_type: "bearer" } }]),
    async (base) => {
      const out = [];
      const sleeps = [];
      const creds = await login({
        apiBase: base,
        out: (line) => out.push(line),
        sleep: async (ms) => sleeps.push(ms)
      });

      assert.equal(creds.api_key, "sk_new");
      assert.equal(creds.api_base, base);
      assert.equal(creds.email, "a@b.c");

      const printed = out.join("\n");
      assert.match(printed, /ABCD-1234/);
      assert.match(printed, /https:\/\/qumge\.test\/en\/device\?user_code=ABCD-1234/);
      assert.equal(sleeps.length, 3, "one wait per poll");
      assert.equal(sleeps[0], 1000, "the server's interval, in seconds -> ms");
    }
  );
});

test("slow_down adds five seconds to every later wait", async () => {
  await withServer(
    deviceRoutes([
      { status: 400, body: { error: "slow_down" } },
      pending(),
      { body: { access_token: "sk_new", token_type: "bearer" } }
    ]),
    async (base) => {
      const sleeps = [];
      await login({ apiBase: base, out: () => {}, sleep: async (ms) => sleeps.push(ms) });
      assert.deepEqual(sleeps, [1000, 6000, 6000]);
    }
  );
});

test("an expired request tells the user to run qmg login again", async () => {
  await withServer(
    deviceRoutes([{ status: 400, body: { error: "expired_token" } }]),
    async (base) => {
      await assert.rejects(
        login({ apiBase: base, out: () => {}, sleep: async () => {} }),
        (error) => /expired/i.test(error.message) && /qmg login/.test(error.message)
      );
    }
  );
});

test("a denied request says it was denied on the website", async () => {
  await withServer(
    deviceRoutes([{ status: 400, body: { error: "access_denied" } }]),
    async (base) => {
      await assert.rejects(
        login({ apiBase: base, out: () => {}, sleep: async () => {} }),
        /denied/i
      );
    }
  );
});

test("picks the cheapest featured coding model as the default", async () => {
  await withServer(
    deviceRoutes([{ body: { access_token: "sk_new", token_type: "bearer" } }]),
    async (base) => {
      const creds = await login({ apiBase: base, out: () => {}, sleep: async () => {} });
      assert.equal(creds.default_model, "fast/cheap");
      assert.deepEqual(Object.keys(creds).sort(), ["api_base", "api_key", "catalog", "default_model", "email"]);
    }
  );
});

test("an HTML body from the edge fails as a non-JSON response", async () => {
  await withServer(
    {
      "POST /device/code": () => ({ contentType: "text/html", body: "<html>blocked</html>", status: 403 })
    },
    async (base) => {
      await assert.rejects(
        login({ apiBase: base, out: () => {}, sleep: async () => {} }),
        /non-JSON response/
      );
    }
  );
});

// 目录随登录一起带回来，由调用方落盘：登录本来就要打这两个接口，
// 编辑时的启动路径因此仍然一次网络都不发。
test("returns the coding catalog it fetched during sign-in", async () => {
  await withServer(
    deviceRoutes([{ body: { access_token: "sk_new", token_type: "bearer" } }]),
    async (base) => {
      const creds = await login({ apiBase: base, out: () => {}, sleep: async () => {} });
      assert.deepEqual(creds.catalog.data.map((m) => m.id), ["slow/expensive", "fast/cheap", "plain/model"]);
      assert.ok(creds.catalog.generated_at, "the cache is stamped so a stale file is obvious");
    }
  );
});
