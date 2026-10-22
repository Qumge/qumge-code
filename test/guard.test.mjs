import { test } from "node:test";
import assert from "node:assert/strict";
import { ALLOW_ONCE, ALLOW_SESSION, DENY, classify, installGuard } from "../lib/guard.mjs";

const bash = (command) => classify("bash", { command });

test("asks before the irreversible commands", () => {
  for (const command of [
    "rm -rf build", "rm -fr /tmp/x", "rm -r src", "rm --recursive dist",
    "git reset --hard HEAD~1", "git push --force origin main", "git push -f", "git push --force-with-lease",
    "git clean -fdx", "git branch -D feature",
    "sudo npm i -g x", "cd /tmp && sudo rm x",
    "cat .env", "cp ~/.ssh/id_rsa /tmp", "cat ~/.aws/credentials", "cat ~/.qmg/credentials.json",
    "cp .env.example .env", "Remove-Item -Path dist -Recurse -Force", "rmdir /s /q build"
  ]) {
    assert.ok(bash(command), `should ask: ${command}`);
  }
});

// The point of the minimal version: a normal session never sees a prompt.
test("lets ordinary work run without asking", () => {
  for (const command of [
    "ls -la", "npm test", "npm install", "bin/rails test", "git status", "git diff", "git add -A",
    "git commit -m 'fix'", "git push origin main", "git push -u origin feature", "git reset HEAD file.rb",
    "rm file.txt", "rm -f tmp.log", "cat README.md", "grep -rn environment src", "cp .env.example .env.sample",
    "echo $HOME/.environment", "git checkout -b new", "git clean -n", "pseudo-sudo --help"
  ]) {
    assert.equal(bash(command), null, `should not ask: ${command}`);
  }
});

test("file tools ask only for secrets files", () => {
  assert.ok(classify("read", { path: ".env" }));
  assert.ok(classify("edit", { path: "config/.env.production" }));
  assert.ok(classify("write", { path: "/Users/me/.ssh/config" }));
  assert.equal(classify("read", { path: ".env.example" }), null);
  assert.equal(classify("read", { path: "src/environment.ts" }), null);
  assert.equal(classify("write", { path: "app/models/user.rb" }), null);
  assert.equal(classify("grep", { pattern: ".env" }), null);
});

function harness({ flags = {}, env = {} } = {}) {
  const handlers = {};
  const pi = {
    registerFlag: () => {},
    getFlag: (name) => flags[name],
    on: (event, handler) => (handlers[event] ||= []).push(handler)
  };
  installGuard(pi, { env });
  const call = (toolName, input, ctx) => handlers.tool_call[0]({ toolName, input }, ctx);
  const newSession = () => handlers.session_start[0]();
  return { call, newSession };
}

function ui(answers) {
  const asked = [];
  return {
    asked,
    ctx: { hasUI: true, ui: { select: async (title, options) => { asked.push({ title, options }); return answers.shift(); } } }
  };
}

test("an ordinary call never reaches the prompt", async () => {
  const { call } = harness();
  const { asked, ctx } = ui([]);
  assert.equal(await call("bash", { command: "npm test" }, ctx), undefined);
  assert.equal(asked.length, 0);
});

test("deny blocks the call and tells the model not to retry", async () => {
  const { call } = harness();
  const { asked, ctx } = ui([DENY]);
  const result = await call("bash", { command: "rm -rf build" }, ctx);
  assert.equal(result.block, true);
  assert.match(result.reason, /declined/);
  assert.match(result.reason, /Do not retry/);
  assert.match(asked[0].title, /rm -rf build/);
  assert.deepEqual(asked[0].options, [ALLOW_ONCE, ALLOW_SESSION, DENY]);
});

test("dismissing the prompt counts as deny", async () => {
  const { call } = harness();
  const { ctx } = ui([undefined]);
  assert.equal((await call("bash", { command: "sudo ls" }, ctx)).block, true);
});

test("allow once asks again next time", async () => {
  const { call } = harness();
  const { asked, ctx } = ui([ALLOW_ONCE, ALLOW_ONCE]);
  assert.equal(await call("bash", { command: "rm -rf a" }, ctx), undefined);
  assert.equal(await call("bash", { command: "rm -rf b" }, ctx), undefined);
  assert.equal(asked.length, 2);
});

test("allow for this session stops asking for that kind — only that kind, only this session", async () => {
  const { call, newSession } = harness();
  const { asked, ctx } = ui([ALLOW_SESSION, DENY, DENY]);
  await call("bash", { command: "rm -rf a" }, ctx);
  assert.equal(await call("bash", { command: "rm -rf b" }, ctx), undefined);
  assert.equal(asked.length, 1, "same category is not asked again");

  assert.equal((await call("bash", { command: "git reset --hard" }, ctx)).block, true, "other categories still ask");

  newSession();
  assert.equal((await call("bash", { command: "rm -rf c" }, ctx)).block, true, "a new session starts fresh");
  assert.equal(asked.length, 3);
});

// Print mode (-p, CI) has no terminal to ask in. Fail closed, and say how to opt out.
test("without a UI the call is blocked and the way out is named", async () => {
  const { call } = harness();
  const result = await call("bash", { command: "git push --force" }, { hasUI: false });
  assert.equal(result.block, true);
  assert.match(result.reason, /--yolo/);
});

test("--yolo and QUMGE_YOLO=1 turn the guard off", async () => {
  assert.equal(await harness({ flags: { yolo: true } }).call("bash", { command: "rm -rf /" }, { hasUI: false }), undefined);
  assert.equal(await harness({ env: { QUMGE_YOLO: "1" } }).call("bash", { command: "rm -rf /" }, { hasUI: false }), undefined);
});
