import { randomUUID } from "node:crypto";
import type { CliComposition } from "../runtime/composition.js";
import type { SlashCommand, UiScreen } from "../slash/commands.js";
import type { StatusState } from "../telemetry/status.js";
import type { ChatStore } from "./store/chatStore.js";

interface Args {
  command: SlashCommand;
  composition: CliComposition;
  chatStore: ChatStore;
  activeSessionId: string;
  status: StatusState;
  setScreen(screen: UiScreen): void;
  setScreenContent(content: string): void;
  setChatScrollOffset(offset: number): void;
  switchToSession(sessionId: string, notice: string): Promise<void>;
  onExit(): void;
}

export async function handleSlashCommand(args: Args): Promise<void> {
  const {
    command,
    composition,
    chatStore,
    activeSessionId,
    status,
    setScreen,
    setScreenContent,
    setChatScrollOffset,
    switchToSession,
    onExit,
  } = args;

  if (command.type === "exit") {
    onExit();
    return;
  }
  if (command.type === "clear") {
    chatStore.clearChatEntries();
    return;
  }
  if (command.type === "set-mode") {
    composition.modeController.setMode(command.mode);
    chatStore.appendSystemMessage(`Mode set to ${command.mode}.`);
    return;
  }
  if (command.type === "set-effort") {
    composition.runtimeState.effort = command.effort;
    composition.modelSelector.setEffort(command.effort);
    const synced = await composition.refreshContextWindowTokens();
    chatStore.appendSystemMessage(
      `Effort set to ${command.effort}. ${describeContextSync(synced)}`,
    );
    return;
  }
  if (command.type === "set-model") {
    composition.runtimeState.model = command.model;
    const synced = await composition.refreshContextWindowTokens();
    chatStore.appendSystemMessage(
      `Model override set to ${command.model}. ${describeContextSync(synced)}`,
    );
    return;
  }
  if (command.type === "set-provider") {
    composition.runtimeState.provider = command.provider;
    const synced = await composition.refreshContextWindowTokens();
    chatStore.appendSystemMessage(
      `Provider set to ${command.provider}. ${describeContextSync(synced)}`,
    );
    return;
  }
  if (command.type === "wait-subagents") {
    const pending = composition.subagents.list().filter((entry) => entry.status === "running");
    if (pending.length === 0) {
      chatStore.appendSystemMessage("No running subagents.");
      return;
    }
    chatStore.appendSystemMessage(`Waiting for ${pending.length} subagent(s) to finish...`);
    const result = await composition.subagents.wait({ mode: "all" });
    for (const completed of result.completed) {
      const name = completed.promptName ?? "subagent";
      if (completed.status === "failed") {
        chatStore.appendSystemMessage(
          `${name} failed (${completed.sessionId ?? completed.id}): ${completed.error ?? "unknown error"}`,
        );
      } else {
        chatStore.appendSystemMessage(
          `${name} completed (${completed.sessionId ?? completed.id}): ${completed.summary ?? ""}`.trim(),
        );
      }
    }
    chatStore.appendSystemMessage(
      result.running.length === 0
        ? "All running subagents completed."
        : `${result.running.length} subagent(s) still running.`,
    );
    return;
  }
  if (command.type === "compact") {
    if (chatStore.getSnapshot().running) {
      chatStore.appendSystemMessage("Cannot compact while a run is in progress.");
      return;
    }
    try {
      chatStore.setRunning(true);
      const result = await composition.agent.compactSession(activeSessionId);
      if (!result.compressed) {
        chatStore.appendSystemMessage("No turns available to compact in this session.");
        return;
      }
      chatStore.appendSystemMessage(
        `Context compacted (${result.deltaTurns} turns, mode=${result.forced ? "forced" : "overflow"}, totalTurns=${result.totalTurns}).`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown compact failure";
      chatStore.appendSystemMessage(`Compact failed: ${message}`);
    } finally {
      chatStore.setRunning(false);
    }
    return;
  }
  if (command.type === "new-session") {
    const nextId = `s-${randomUUID()}`;
    await switchToSession(nextId, `Started new session ${nextId}.`);
    return;
  }
  if (command.type === "switch-session") {
    await switchToSession(command.sessionId, `Switched to session ${command.sessionId}.`);
    return;
  }
  if (command.type === "show-sessions") {
    const sessions = await composition.sessionService.listSummaries();
    const lines = sessions.map(
      (item) =>
        `${item.manifest.sessionId} | updated=${item.manifest.updatedAt} | turns=${item.telemetry.turns} | tokens=${item.telemetry.inputTokens + item.telemetry.outputTokens} | errors=${item.telemetry.errors}`,
    );
    setScreenContent(lines.length > 0 ? lines.join("\n") : "No sessions found.");
    setScreen("sessions");
    return;
  }
  if (command.type === "show-session-details") {
    try {
      const details = await composition.sessionService.getDetails(command.sessionId);
      setScreenContent(
        [
          `sessionId: ${details.manifest.sessionId}`,
          `goal: ${details.manifest.goal || "-"}`,
          `updatedAt: ${details.manifest.updatedAt}`,
          `latestRunId: ${details.manifest.latestRunId ?? "-"}`,
          `tokens in/out: ${details.telemetry.inputTokens}/${details.telemetry.outputTokens}`,
          `turns: ${details.telemetry.turns}`,
          `errors: ${details.telemetry.errors}`,
        ].join("\n"),
      );
    } catch {
      setScreenContent(`Session ${command.sessionId} not found.`);
    }
    setScreen("session-details");
    return;
  }
  if (command.type === "show-context") {
    setScreenContent(
      [
        `used: ${status.contextUsedTokens ?? 0}`,
        `max: ${status.contextMaxTokens ?? 0}`,
        `utilization: ${typeof status.contextUtilization === "number" ? `${Math.round(status.contextUtilization * 100)}%` : "n/a"}`,
        `estimator: ${status.contextEstimator ?? "n/a"}`,
      ].join("\n"),
    );
    setScreen("context");
    return;
  }
  if (command.type === "show-telemetry") {
    setScreenContent(
      [
        `model: ${status.model ?? "-"}`,
        `tokens in/out: ${status.tokensIn}/${status.tokensOut}`,
        `turns: ${status.turns}`,
        `errors: ${status.errors}`,
        `limit hits: ${status.limitHits}`,
        `compressing: ${status.compressing ? "yes" : "no"}`,
      ].join("\n"),
    );
    setScreen("telemetry");
    return;
  }
  if (command.type === "show-help") {
    setScreen("help");
    return;
  }
  if (command.type === "show-chat") {
    setScreen("chat");
    setChatScrollOffset(0);
  }
}

function describeContextSync(synced: {
  tokens: number;
  source: "default" | "ollama-api" | "ollama-fallback";
  estimator: string;
}): string {
  return `Context window set to ${synced.tokens} tokens (${synced.source}, estimator=${synced.estimator}).${
    synced.source === "ollama-fallback"
      ? " Using conservative Ollama fallback until detection succeeds."
      : ""
  }`;
}
