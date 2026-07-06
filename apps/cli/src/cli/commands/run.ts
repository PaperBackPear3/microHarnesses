import type { StreamEvent } from "@micro-harnesses/core";
import type { CliComposition } from "../../runtime/composition";
import { withModeExecutionContract } from "../../runtime/autopilotPrompt";

export async function runHeadlessPrompt(
  composition: CliComposition,
  prompt: string,
  sessionId: string,
  json: boolean,
): Promise<void> {
  const unsub = composition.uiStream.subscribe(({ streamEvent }) => {
    printProgress(streamEvent);
  });
  try {
    const effectivePrompt = withModeExecutionContract(prompt, composition.modeController.getMode());
    const state = await composition.agent.run(effectivePrompt, {
      ...composition.runOptions(),
      sessionId,
      resume: true,
    });
    const final = state.turns[state.turns.length - 1]?.assistantMessage ?? "";
    if (json) {
      process.stdout.write(
        `${JSON.stringify(
          {
            sessionId: state.sessionId,
            runId: state.runId,
            turns: state.turns.length,
            finalMessage: final,
          },
          null,
          2,
        )}\n`,
      );
      return;
    }
    process.stdout.write(`${final}\n`);
  } finally {
    unsub();
  }
}

function printProgress(event: StreamEvent): void {
  if (event.type === "model.reasoning_delta") {
    process.stderr.write(String(event.payload.delta ?? ""));
    return;
  }
  if (event.type === "model.output_delta") {
    process.stderr.write(String(event.payload.delta ?? ""));
    return;
  }
  if (event.type === "model.output_completed" || event.type === "model.reasoning_completed") {
    process.stderr.write("\n");
    return;
  }
  if (event.type === "tool.started") {
    process.stderr.write(`[tool] ${String(event.payload.action ?? "unknown")}\n`);
    return;
  }
  if (event.type === "tool.blocked") {
    process.stderr.write(
      `[blocked] ${String(event.payload.action ?? "unknown")}: ${String(event.payload.reason ?? "")}\n`,
    );
    return;
  }
  if (event.type === "limit.reached") {
    process.stderr.write(
      `[limit] ${String(event.payload.action ?? "unknown")} (${String(event.payload.limit ?? "-")})\n`,
    );
    return;
  }
  if (event.type === "context.compression_started") {
    process.stderr.write("[context] compressing...\n");
    return;
  }
  if (event.type === "context.compression_completed") {
    process.stderr.write("[context] compression completed\n");
  }
}
