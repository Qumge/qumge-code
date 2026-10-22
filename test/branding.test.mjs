import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { brandTitles, headerLines, installBranding } from "../lib/branding.mjs";

const plain = { fg: (_color, text) => text };
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

test("the header names QMG Code and its version, and credits Pi", () => {
  const lines = headerLines(plain);
  assert.match(lines[0], new RegExp(`^QMG Code v${pkg.version.replaceAll(".", "\\.")}`));
  assert.match(lines[0], /built on Pi \d+\.\d+\.\d+/);
  assert.match(lines.join("\n"), /\/model/);
  assert.doesNotMatch(lines.join("\n"), /Ask it how to use or extend Pi/);
});

function fakePi() {
  const handlers = {};
  return { handlers, on: (event, handler) => ((handlers[event] ||= []).push(handler)) };
}

test("replaces Pi's header and sets the terminal title in the TUI", async () => {
  const pi = fakePi();
  installBranding(pi);
  const calls = {};
  await pi.handlers.session_start[0]({}, {
    mode: "tui",
    ui: { setHeader: (factory) => (calls.header = factory), setTitle: (title) => (calls.title = title) }
  });
  assert.equal(calls.title, "QMG Code");
  const component = calls.header(null, plain);
  assert.match(component.render(80)[0], /^QMG Code v/);
});

test("leaves print and RPC modes alone", async () => {
  const pi = fakePi();
  installBranding(pi);
  let touched = false;
  for (const mode of ["print", "rpc", "json"]) {
    await pi.handlers.session_start[0]({}, { mode, ui: { setHeader: () => (touched = true), setTitle: () => (touched = true) } });
  }
  assert.equal(touched, false);
});

test("Pi's own title updates say QMG Code; other titles pass through", () => {
  const seen = [];
  const terminal = { setTitle(title) { seen.push(title); } };
  brandTitles(terminal);
  brandTitles(terminal); // idempotent: a second session must not wrap twice
  terminal.setTitle("π - my-repo");
  terminal.setTitle("π - refactor - my-repo");
  terminal.setTitle("π");
  terminal.setTitle("π-shaped title from an extension");
  assert.deepEqual(seen, ["QMG Code - my-repo", "QMG Code - refactor - my-repo", "QMG Code", "π-shaped title from an extension"]);
});

test("a terminal without setTitle is left alone", () => {
  assert.doesNotThrow(() => brandTitles(undefined));
  assert.doesNotThrow(() => brandTitles({}));
});
