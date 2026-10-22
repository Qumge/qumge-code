#!/usr/bin/env node
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { planInvocation } from "../lib/args.mjs";
import { clearCredentials, loadCredentials } from "../lib/credentials.mjs";
import { resolvePiCli } from "../lib/pi-cli.mjs";

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(path.join(pkgRoot, "package.json"), "utf8"));

const USAGE = `QMG Code ${pkg.version}

Usage:
  qmg                 start the coding agent
  qmg login           sign in with your Qumge account
  qmg logout          forget the saved account
  qmg balance         show your credit balance
  qmg models          list the models you can use

Everything else is passed to the agent, e.g.:
  qmg -p "fix the failing test"
  qmg --model deepseek/deepseek-chat
`;

const argv = process.argv.slice(2);
const command = argv[0];

switch (command) {
  case "--version":
  case "-v":
    console.log(pkg.version);
    process.exit(0);
    break;

  case "help":
  case "--help":
  case "-h":
    process.stdout.write(USAGE);
    process.exit(0);
    break;

  case "logout":
    clearCredentials();
    console.log("Signed out.");
    process.exit(0);
    break;
}

const creds = loadCredentials();
if (!creds) {
  console.error("Run qmg login first.");
  process.exit(1);
}

const { args, env } = planInvocation(argv, { creds, pkgRoot });

let cli;
try {
  cli = process.env.QMG_PI_CLI || resolvePiCli();
} catch (error) {
  console.error(`QMG Code is not installed correctly: ${error.message}`);
  console.error("Reinstall with: npm i -g qumge-code");
  process.exit(1);
}

const child = spawn(process.execPath, [cli, ...args], { stdio: "inherit", env });

child.on("error", (error) => {
  console.error(`Could not start the agent: ${error.message}`);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
