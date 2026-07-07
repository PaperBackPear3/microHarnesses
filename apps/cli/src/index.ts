#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { extractPositionals, parseGlobalCliArgs, parseSessionsArgs } from "./cli/args.js";
import { chatCommand } from "./cli/commands/chat.js";
import { runHeadlessPrompt } from "./cli/commands/run.js";
import { sessionsCommand } from "./cli/commands/sessions.js";
import { loadCliConfig } from "./config/config.js";
import { buildComposition } from "./runtime/composition.js";
import { CLI_VERSION } from "./version.js";

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
    process.stdout.write(`${CLI_VERSION}\n`);
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
      `micro-harness v${CLI_VERSION}`,
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
      "  --routing-preference <auto|cost|speed|intelligence|balanced>",
      "  --mode <plan|accept-edits|autopilot>",
      "  --session <id>",
      "  --state-dir <path>",
      "  --skills-dir <path>",
      "  --iterations <n|unlimited> (default 320)",
      "  --snapshot-every <n>",
      "  --max-tokens <n>",
      "  --compaction-trigger <0..1>",
      "  --compaction-target <0..1>",
      "  --turn-compaction-target <0..1>",
      "  --non-turn-token-reserve <n>",
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
