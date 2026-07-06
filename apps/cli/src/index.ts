#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { extractPositionals, parseGlobalCliArgs, parseSessionsArgs } from "./cli/args";
import { chatCommand } from "./cli/commands/chat";
import { runHeadlessPrompt } from "./cli/commands/run";
import { sessionsCommand } from "./cli/commands/sessions";
import { loadCliConfig } from "./config/config";
import { buildComposition } from "./runtime/composition";

async function main(): Promise<void> {
  const rawArgv = process.argv.slice(2);
  const command = rawArgv[0];

  if (command === "sessions") {
    await sessionsCommand(parseSessionsArgs(rawArgv.slice(1)));
    return;
  }
  if (command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return;
  }
  if (command === "version" || command === "--version" || command === "-v") {
    process.stdout.write("1.0.6\n");
    return;
  }

  const argv = command === "run" || command === "chat" ? rawArgv.slice(1) : rawArgv;
  const runtimeArgs = parseGlobalCliArgs(argv);
  const config = await loadCliConfig(runtimeArgs);
  const composition = await buildComposition(config);
  const positionalPrompt = extractPositionals(argv).join(" ").trim();
  const prompt = runtimeArgs.prompt ?? positionalPrompt;
  const sessionId = runtimeArgs.sessionId ?? composition.rootSessionId ?? `s-${randomUUID()}`;

  if (prompt.length > 0) {
    await runHeadlessPrompt(composition, prompt, sessionId, runtimeArgs.json);
    return;
  }
  await chatCommand(composition, config);
}

function printHelp(): void {
  process.stdout.write(
    [
      "micro-harness v2",
      "",
      "Usage:",
      '  mh -p "prompt" [--json]',
      "  mh sessions list",
      "  mh sessions show <session-id>",
      "  mh",
      "",
      "Flags:",
      "  --provider <id>",
      "  --model <id>",
      "  --effort <low|medium|high>",
      "  --mode <plan|accept-edits|autopilot>",
      "  --session <id>",
      "  --state-dir <path>",
      "  --iterations <n>",
      "  --snapshot-every <n>",
      "  --max-tokens <n>",
      "  --no-safety",
    ].join("\n"),
  );
  process.stdout.write("\n");
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : "unknown fatal error";
  process.stderr.write(`Error: ${message}\n`);
  process.exit(1);
});
