import { randomUUID } from "node:crypto";
import type { ModelRoute } from "@micro-harnesses/core";
import type { CliComposition } from "../runtime/composition.js";
import { resolveMainPromptName } from "../runtime/subagentPromptName.js";
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
    const defaultPersona = command.mode === "plan" ? "planner" : "coder";
    try {
      composition.runtimeState.promptName = await resolveMainPromptName(
        defaultPersona,
        composition.promptsDir,
      );
      chatStore.appendSystemMessage(
        `Mode set to ${command.mode}. Persona set to ${composition.runtimeState.promptName}.`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown persona validation error";
      chatStore.appendSystemMessage(
        `Mode set to ${command.mode}. Persona unchanged (${composition.runtimeState.promptName}). ${message}`,
      );
    }
    return;
  }
  if (command.type === "show-persona") {
    chatStore.appendSystemMessage(`Current persona: ${composition.runtimeState.promptName}.`);
    return;
  }
  if (command.type === "set-persona") {
    try {
      composition.runtimeState.promptName = await resolveMainPromptName(
        command.promptName,
        composition.promptsDir,
      );
      chatStore.appendSystemMessage(`Persona set to ${composition.runtimeState.promptName}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown persona validation error";
      chatStore.appendSystemMessage(message);
    }
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
  if (command.type === "list-models") {
    const activeProvider = composition.runtimeState.provider;
    const activeModel = composition.runtimeState.model;
    const allRoutes = composition.listModelRoutes();
    if (allRoutes.length === 0) {
      chatStore.appendSystemMessage("No known models for any configured provider.");
      return;
    }
    const byProvider = new Map<string, ModelRoute[]>();
    for (const route of allRoutes) {
      const list = byProvider.get(route.providerId) ?? [];
      list.push(route);
      byProvider.set(route.providerId, list);
    }
    const sections = [...byProvider.entries()].map(([providerId, routes]) => {
      const header = providerId === activeProvider ? `${providerId} (active provider)` : providerId;
      const lines = routes.map((route) =>
        describeModelRoute(route, providerId === activeProvider ? activeModel : undefined),
      );
      return [`${header}:`, ...lines].join("\n");
    });
    const preferenceLine = composition.runtimeState.routingPreference
      ? `Routing preference: ${composition.runtimeState.routingPreference} (router may pick across any provider above)`
      : "Routing preference: off (using effort-based profile selection for the active provider)";
    chatStore.appendSystemMessage(
      ["Models across all configured providers:", ...sections, preferenceLine].join("\n\n"),
    );
    return;
  }
  if (command.type === "set-model") {
    if (command.model === undefined) {
      composition.runtimeState.model = undefined;
      const synced = await composition.refreshContextWindowTokens();
      chatStore.appendSystemMessage(
        `Cleared model override; using automatic profile selection. ${describeContextSync(synced)}`,
      );
      return;
    }
    const provider = composition.runtimeState.provider;
    const routes = composition.listModelRoutes();
    const resolved = resolveModelSelection(routes, provider, command.model);
    if (!resolved) {
      const known = routes
        .filter((route) => route.providerId === provider)
        .map((route) => route.model);
      chatStore.appendSystemMessage(
        `Model "${command.model}" is not available for provider ${provider}.${
          known.length > 0 ? ` Known models: ${known.join(", ")}.` : ""
        } Use /model with no arguments to list available models.`,
      );
      return;
    }
    if (resolved.providerId !== provider) {
      composition.runtimeState.provider = resolved.providerId;
    }
    composition.runtimeState.model = resolved.model;
    const synced = await composition.refreshContextWindowTokens();
    chatStore.appendSystemMessage(
      `Model override set to ${resolved.model}. ${describeContextSync(synced)}`,
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
  if (command.type === "set-routing-preference") {
    composition.runtimeState.routingPreference = command.preference;
    chatStore.appendSystemMessage(
      command.preference
        ? `Routing preference set to ${command.preference}. The router will pick a route per iteration; explicit /model overrides still win.`
        : "Routing preference cleared; using effort-based profile selection.",
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
      const name = completed.name ?? completed.promptName ?? "subagent";
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

/**
 * Resolves a `/model` argument against the cached route catalog. Accepts a
 * bare model name for the active provider, or a `provider/model` qualified
 * id to switch providers. Falls back to a unique cross-provider model-name
 * match when unqualified and not found under the active provider.
 */
function resolveModelSelection(
  routes: ModelRoute[],
  currentProvider: string,
  input: string,
): { providerId: string; model: string } | undefined {
  const slash = input.indexOf("/");
  if (slash > 0) {
    const providerId = input.slice(0, slash);
    const model = input.slice(slash + 1);
    const match = routes.find((route) => route.providerId === providerId && route.model === model);
    return match ? { providerId: match.providerId, model: match.model } : undefined;
  }
  const sameProvider = routes.find(
    (route) => route.providerId === currentProvider && route.model === input,
  );
  if (sameProvider) return { providerId: sameProvider.providerId, model: sameProvider.model };
  const crossProvider = routes.filter((route) => route.model === input);
  if (crossProvider.length === 1) {
    return { providerId: crossProvider[0].providerId, model: crossProvider[0].model };
  }
  return undefined;
}

function describeModelRoute(route: ModelRoute, activeModel: string | undefined): string {
  const marker = route.model === activeModel ? "* " : "  ";
  const meta = route.metadata;
  const details: string[] = [];
  if (
    meta?.inputCostPerMillionTokens !== undefined ||
    meta?.outputCostPerMillionTokens !== undefined
  ) {
    const input = meta.inputCostPerMillionTokens?.toFixed(2) ?? "?";
    const output = meta.outputCostPerMillionTokens?.toFixed(2) ?? "?";
    details.push(`$${input}/$${output} per 1M tok`);
  } else if (meta?.cost !== undefined) {
    details.push(`cost=${meta.cost}`);
  }
  if (meta?.contextWindowTokens !== undefined) {
    details.push(`ctx=${formatContextWindow(meta.contextWindowTokens)}`);
  }
  if (meta?.speed !== undefined) details.push(`speed=${meta.speed}`);
  if (meta?.intelligence !== undefined) details.push(`intelligence=${meta.intelligence}`);
  if (meta?.tags && meta.tags.length > 0) details.push(`tags=${meta.tags.join(",")}`);
  const availability = route.available === false ? " (unavailable)" : "";
  const suffix = details.length > 0 ? ` [${details.join(", ")}]` : "";
  return `${marker}${route.providerId}/${route.model}${availability}${suffix}`;
}

function formatContextWindow(tokens: number): string {
  if (tokens >= 1_000_000)
    return `${(tokens / 1_000_000).toFixed(tokens % 1_000_000 === 0 ? 0 : 1)}M`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}k`;
  return `${tokens}`;
}
