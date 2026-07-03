#!/usr/bin/env node

import path from "node:path";
import { runCommand } from "./commands/run";
import { sessionsCommand } from "./commands/sessions";

const DEFAULT_PROMPTS_DIR = path.resolve(__dirname, "../prompts");

async function main(): Promise<void> {
  const [commandArg, ...rest] = process.argv.slice(2);
  const command = commandArg ?? "run";

  if (command === "run") {
    await runCommand(rest, DEFAULT_PROMPTS_DIR);
    return;
  }

  if (command === "sessions") {
    await sessionsCommand(rest, DEFAULT_PROMPTS_DIR);
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "unknown fatal error";
  process.stderr.write(`Error: ${message}\n`);
  process.exit(1);
});
