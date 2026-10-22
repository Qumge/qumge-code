import { test } from "node:test";
import assert from "node:assert/strict";
import { openUrl } from "../lib/open-url.mjs";

const URL_OK = "https://qumge.com/en/device?user_code=ABCD-1234";

function recorder() {
  const calls = [];
  const spawnImpl = (cmd, args, options) => {
    calls.push({ cmd, args, options });
    return { on() {}, unref() {} };
  };
  return { calls, spawnImpl };
}

test("uses the platform's opener with the URL as a separate argument", () => {
  for (const [platform, env, cmd] of [
    ["darwin", {}, "open"],
    ["win32", {}, "rundll32"],
    ["linux", { DISPLAY: ":0" }, "xdg-open"],
    ["linux", { WSL_DISTRO_NAME: "Ubuntu" }, "rundll32.exe"]
  ]) {
    const { calls, spawnImpl } = recorder();
    assert.equal(openUrl(URL_OK, { platform, env, isTTY: true, spawnImpl }), true, platform);
    assert.equal(calls[0].cmd, cmd);
    assert.equal(calls[0].args.at(-1), URL_OK, "no shell, no string building");
    assert.equal(calls[0].options.detached, true);
  }
});

test("does not try where there is no browser to open", () => {
  for (const [label, options] of [
    ["ssh", { platform: "darwin", env: { SSH_CONNECTION: "1 2 3 4" }, isTTY: true }],
    ["headless linux", { platform: "linux", env: {}, isTTY: true }],
    ["not a terminal (CI, pipes)", { platform: "darwin", env: {}, isTTY: false }],
    ["opted out", { platform: "darwin", env: { QMG_NO_BROWSER: "1" }, isTTY: true }]
  ]) {
    const { calls, spawnImpl } = recorder();
    assert.equal(openUrl(URL_OK, { ...options, spawnImpl }), false, label);
    assert.equal(calls.length, 0, label);
  }
});

// The URL comes from the server: only web addresses ever reach the OS opener.
test("refuses anything that is not an http(s) URL", () => {
  for (const url of ["file:///etc/passwd", "javascript:alert(1)", "/Applications/Calculator.app", "not a url"]) {
    const { calls, spawnImpl } = recorder();
    assert.equal(openUrl(url, { platform: "darwin", env: {}, isTTY: true, spawnImpl }), false, url);
    assert.equal(calls.length, 0, url);
  }
});

test("a failing spawn is swallowed — the printed link is the fallback", () => {
  const spawnImpl = () => { throw new Error("ENOENT"); };
  assert.equal(openUrl(URL_OK, { platform: "darwin", env: {}, isTTY: true, spawnImpl }), false);
});
