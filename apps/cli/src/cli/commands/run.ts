import type { StreamEvent } from "@micro-harnesses/core";
import { modeExecutionContract } from "@micro-harnesses/core";
import type { CliComposition } from "../../runtime/composition.js";
import { savePlanArtifactIfNeeded } from "../../session/planArtifact.js";

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
    const modeContract = modeExecutionContract(composition.modeController.getMode());
    await composition.refreshContextWindowTokens();
    const state = await composition.agent.run(prompt, {
      ...composition.runOptions(),
      sessionId,
      resume: true,
      runtimeInstructions: modeContract ? [modeContract] : undefined,
    });
    const final = state.turns[state.turns.length - 1]?.assistantMessage ?? "";
    const planArtifact = await savePlanArtifactIfNeeded({
      mode: composition.modeController.getMode(),
      sessionStore: composition.sessionStore,
      sessionId: state.sessionId ?? sessionId,
      assistantMessage: final,
    });
    if (json) {
      process.stdout.write(
        `${JSON.stringify(
          {
            sessionId: state.sessionId,
            runId: state.runId,
            turns: state.turns.length,
            finalMessage: final,
            ...(planArtifact
              ? {
                  planArtifact: {
                    path: planArtifact.path,
                    updatedAt: planArtifact.updatedAt,
                    sizeBytes: planArtifact.sizeBytes,
                  },
                }
              : {}),
          },
          null,
          2,
        )}\n`,
      );
      return;
    }
    process.stdout.write(`${final}\n`);
    if (planArtifact) {
      process.stdout.write(
        `\nCreated plan.md at ${planArtifact.path}. Planning complete — refine/change the plan in your next prompt, or rerun in /autopilot mode to implement.\n`,
      );
    }
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
  if (event.type === "tool.completed") {
    if (event.payload.outputTruncated === true) {
      const action = String(event.payload.action ?? "unknown");
      const artifacts = Number(event.payload.outputArtifactCount ?? 0);
      process.stderr.write(
        `[tool] ${action}: output truncated${artifacts > 0 ? ` (${artifacts} artifact${artifacts === 1 ? "" : "s"})` : ""}\n`,
      );
    }
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
