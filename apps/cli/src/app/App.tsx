import { randomUUID } from "node:crypto";
import type { StreamEvent } from "@micro-harnesses/core";
import type { EffortLevel, HarnessMode } from "@micro-harnesses/core";
import { availableModelChoices, withModeExecutionContract } from "@micro-harnesses/core";
import { Box, Text, useInput } from "ink";
import Spinner from "ink-spinner";
import TextInput from "ink-text-input";
// biome-ignore lint/style/useImportType: classic JSX runtime requires React as a value import.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ApprovalView } from "../runtime/approvalHandler";
import type { CliComposition } from "../runtime/composition";
import { type SlashCommand, type UiScreen, parseSlashCommand } from "../slash/commands";
import { type StatusState, createStatusState, reduceStatus } from "../telemetry/status";
import {
  type ChatEntry,
  appendAssistantDelta,
  appendStepSystemMessage,
  appendSystemEntry,
  appendThinkingDelta,
  asNumber,
  formatIteration,
  startUserTurn,
  toggleAllThinkingCollapse as toggleAllThinkingCollapseInTranscript,
} from "./transcript";
import {
  compactShortcutHintLine,
  contextBadgeStyle,
  helpCommandLines,
  helpShortcutLines,
  modePromptStyle,
  modelBadgeLabel,
} from "./uiMeta";
import { sliceFromBottom } from "./viewport";

interface Props {
  composition: CliComposition;
  buildForSession(sessionId: string): Promise<CliComposition>;
  onExit(): void;
}

interface SubagentStatus {
  sessionId: string;
  promptName: string;
  goal?: string;
  model?: string;
  status: "running" | "completed" | "failed";
  activity?: string;
  summary?: string;
}

export function App({
  composition: initialComposition,
  buildForSession,
  onExit,
}: Props): React.ReactElement {
  const [composition, setComposition] = useState<CliComposition>(initialComposition);
  const [chatEntries, setChatEntries] = useState<ChatEntry[]>([]);
  const [input, setInput] = useState("");
  const [running, setRunning] = useState(false);
  const [screen, setScreen] = useState<UiScreen>("chat");
  const [status, setStatus] = useState<StatusState>(createStatusState());
  const [chatScrollOffset, setChatScrollOffset] = useState(0);
  const [activeSessionId, setActiveSessionId] = useState(composition.rootSessionId);
  const [sessionsView, setSessionsView] = useState<string>("No sessions loaded.");
  const [sessionDetailView, setSessionDetailView] = useState<string>("No session selected.");
  const [contextView, setContextView] = useState<string>("No context metrics yet.");
  const [telemetryView, setTelemetryView] = useState<string>("No telemetry yet.");
  const [pendingApproval, setPendingApproval] = useState<ApprovalView | undefined>(undefined);
  const [subagents, setSubagents] = useState<SubagentStatus[]>([]);

  // Refs avoid stale-closure bugs in the long-lived stream subscription and
  // guard against overlapping runs triggered by rapid input.
  const activeTurnIdRef = useRef<string | undefined>(undefined);
  const activeRunSessionRef = useRef<string | undefined>(undefined);
  const runningRef = useRef(false);
  const subagentsRef = useRef<SubagentStatus[]>([]);

  const mode = composition.modeController.getMode();
  const modeStyle = modePromptStyle(mode);
  const contextStyle = contextBadgeStyle(status);
  const modelLabel = modelBadgeLabel(composition.runtimeState.model ?? status.model);
  const shortcutHint = compactShortcutHintLine();
  const terminalColumns = Math.max(process.stdout.columns ?? 120, 40);
  const modelChoices = useMemo(
    () => availableModelChoices(composition.runtimeState.provider),
    [composition.runtimeState.provider],
  );

  const viewportHeight = Math.max((process.stdout.rows ?? 24) - 1, 16);
  const composerRows = 1;
  const footerRows = 3;
  const contentRows = Math.max(1, viewportHeight - composerRows - footerRows);

  const chatLines = useMemo(
    () =>
      buildChatLines(chatEntries, subagents, status.compressing, pendingApproval, terminalColumns),
    [chatEntries, subagents, status.compressing, pendingApproval, terminalColumns],
  );
  const transcriptViewport = useMemo(
    () => sliceFromBottom(chatLines, contentRows, chatScrollOffset),
    [chatLines, contentRows, chatScrollOffset],
  );

  useEffect(() => {
    if (chatScrollOffset > transcriptViewport.maxOffset) {
      setChatScrollOffset(transcriptViewport.maxOffset);
    }
  }, [chatScrollOffset, transcriptViewport.maxOffset]);

  useEffect(() => {
    subagentsRef.current = subagents;
  }, [subagents]);

  useEffect(() => {
    return composition.uiStream.subscribe(({ streamEvent }) => {
      const includeInMainStatus = applyStreamEvent(streamEvent);
      if (!includeInMainStatus) return;
      setStatus((current) => reduceStatus(current, streamEvent));
    });
  }, [composition.uiStream]);

  useEffect(() => {
    return composition.approvalController.subscribe((pending) => {
      setPendingApproval(pending);
    });
  }, [composition.approvalController]);

  useInput((raw, key) => {
    const canScrollTranscript = screen === "chat" && input.length === 0 && !pendingApproval;
    if (canScrollTranscript) {
      const pageStep = Math.max(1, Math.floor(contentRows * 0.8));
      if (key.upArrow) {
        setChatScrollOffset((offset) => offset + 1);
        return;
      }
      if (key.downArrow) {
        setChatScrollOffset((offset) => Math.max(0, offset - 1));
        return;
      }
      if (key.pageUp) {
        setChatScrollOffset((offset) => offset + pageStep);
        return;
      }
      if (key.pageDown) {
        setChatScrollOffset((offset) => Math.max(0, offset - pageStep));
        return;
      }
    }

    if (pendingApproval) {
      const answer = raw.toLowerCase();
      if (answer === "y") {
        composition.approvalController.resolvePending("approve");
      } else if (answer === "n") {
        composition.approvalController.resolvePending("reject");
      } else if (answer === "a") {
        composition.approvalController.resolvePending("always");
      }
      return;
    }
    if ((key.escape || (key.ctrl && raw === "c")) && running) {
      composition.approvalController.cancelPending();
      composition.agent.kill("interrupted by user");
      setRunning(false);
      runningRef.current = false;
      appendSystemMessage("Run interrupted.");
      return;
    }
    if (key.ctrl && raw === "d") {
      onExit();
      return;
    }
    if (key.tab && key.shift) {
      const next = composition.modeController.cycle();
      appendSystemMessage(`Mode changed to ${next}.`);
      return;
    }
    if (key.ctrl && raw.toLowerCase() === "t") {
      toggleAllThinkingCollapse();
      return;
    }
  });

  const submit = useCallback(
    async (value: string) => {
      const trimmed = value.trim();
      if (trimmed.length === 0 || runningRef.current) {
        setInput("");
        return;
      }

      const slash = parseSlashCommand(trimmed);
      if (slash) {
        await handleSlash(slash);
        setInput("");
        return;
      }

      startTurn(trimmed);
      setScreen("chat");
      setChatScrollOffset(0);
      runningRef.current = true;
      setRunning(true);
      setInput("");

      const runSessionId = activeSessionId;
      activeRunSessionRef.current = runSessionId;
      try {
        const effectivePrompt = withModeExecutionContract(
          trimmed,
          composition.modeController.getMode(),
        );
        await composition.refreshContextWindowTokens();
        const state = await composition.agent.run(effectivePrompt, {
          ...composition.runOptions(),
          sessionId: runSessionId,
          resume: true,
        });
        if (state.sessionId) {
          setActiveSessionId(state.sessionId);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "unknown run failure";
        appendSystemMessage(`Error: ${message}`);
      } finally {
        runningRef.current = false;
        setRunning(false);
        activeRunSessionRef.current = undefined;
        activeTurnIdRef.current = undefined;
      }
    },
    [composition, activeSessionId],
  );

  async function switchToSession(sessionId: string, notice: string): Promise<void> {
    if (runningRef.current) {
      appendSystemMessage("Cannot switch sessions while a run is in progress.");
      return;
    }
    // Rebuild the runtime so context + telemetry are rooted at the new session,
    // preserving the user's current provider/model/effort/mode selections.
    const next = await buildForSession(sessionId);
    next.approvalController.setInteractive(true);
    next.runtimeState.provider = composition.runtimeState.provider;
    next.runtimeState.model = composition.runtimeState.model;
    next.runtimeState.effort = composition.runtimeState.effort;
    next.modelSelector.setEffort(composition.runtimeState.effort);
    next.modeController.setMode(composition.modeController.getMode());
    await next.refreshContextWindowTokens();

    setComposition(next);
    setActiveSessionId(next.rootSessionId);
    setChatEntries([{ id: randomUUID(), type: "system", text: notice }]);
    setChatScrollOffset(0);
    activeTurnIdRef.current = undefined;
    setSubagents([]);
    setStatus(createStatusState());
    setScreen("chat");
  }

  async function handleSlash(command: SlashCommand): Promise<void> {
    if (command.type === "exit") {
      onExit();
      return;
    }
    if (command.type === "clear") {
      setChatEntries([]);
      activeTurnIdRef.current = undefined;
      return;
    }
    if (command.type === "set-mode") {
      composition.modeController.setMode(command.mode);
      appendSystemMessage(`Mode set to ${command.mode}.`);
      return;
    }
    if (command.type === "set-effort") {
      composition.runtimeState.effort = command.effort;
      composition.modelSelector.setEffort(command.effort);
      const synced = await composition.refreshContextWindowTokens();
      appendSystemMessage(
        `Effort set to ${command.effort}. Context window set to ${synced.tokens} tokens (${synced.source}).`,
      );
      return;
    }
    if (command.type === "set-model") {
      composition.runtimeState.model = command.model;
      const synced = await composition.refreshContextWindowTokens();
      appendSystemMessage(
        `Model override set to ${command.model}. Context window set to ${synced.tokens} tokens (${synced.source}).`,
      );
      return;
    }
    if (command.type === "set-provider") {
      composition.runtimeState.provider = command.provider;
      const synced = await composition.refreshContextWindowTokens();
      appendSystemMessage(
        `Provider set to ${command.provider}. Context window set to ${synced.tokens} tokens (${synced.source}).`,
      );
      return;
    }
    if (command.type === "wait-subagents") {
      const pending = composition.subagents.list().filter((entry) => entry.status === "running");
      if (pending.length === 0) {
        appendSystemMessage("No running subagents.");
        return;
      }
      appendSystemMessage(`Waiting for ${pending.length} subagent(s) to finish...`);
      const result = await composition.subagents.wait({ mode: "all" });
      for (const completed of result.completed) {
        const name = completed.promptName ?? "subagent";
        if (completed.status === "failed") {
          appendSystemMessage(
            `${name} failed (${completed.sessionId ?? completed.id}): ${completed.error ?? "unknown error"}`,
          );
        } else {
          appendSystemMessage(
            `${name} completed (${completed.sessionId ?? completed.id}): ${completed.summary ?? ""}`.trim(),
          );
        }
      }
      appendSystemMessage(
        result.running.length === 0
          ? "All running subagents completed."
          : `${result.running.length} subagent(s) still running.`,
      );
      return;
    }
    if (command.type === "compact") {
      if (runningRef.current) {
        appendSystemMessage("Cannot compact while a run is in progress.");
        return;
      }
      try {
        runningRef.current = true;
        setRunning(true);
        const result = await composition.agent.compactSession(activeSessionId);
        if (!result.compressed) {
          appendSystemMessage("No turns available to compact in this session.");
          return;
        }
        appendSystemMessage(
          `Context compacted (${result.deltaTurns} turns, mode=${result.forced ? "forced" : "overflow"}, totalTurns=${result.totalTurns}).`,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : "unknown compact failure";
        appendSystemMessage(`Compact failed: ${message}`);
      } finally {
        runningRef.current = false;
        setRunning(false);
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
      setSessionsView(lines.length > 0 ? lines.join("\n") : "No sessions found.");
      setScreen("sessions");
      return;
    }
    if (command.type === "show-session-details") {
      try {
        const details = await composition.sessionService.getDetails(command.sessionId);
        setSessionDetailView(
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
        setSessionDetailView(`Session ${command.sessionId} not found.`);
      }
      setScreen("session-details");
      return;
    }
    if (command.type === "show-context") {
      setContextView(
        [
          `used: ${status.contextUsedTokens ?? 0}`,
          `max: ${status.contextMaxTokens ?? 0}`,
          `utilization: ${typeof status.contextUtilization === "number" ? `${Math.round(status.contextUtilization * 100)}%` : "n/a"}`,
        ].join("\n"),
      );
      setScreen("context");
      return;
    }
    if (command.type === "show-telemetry") {
      setTelemetryView(
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

  function applyStreamEvent(event: StreamEvent): boolean {
    const eventSessionId = typeof event.sessionId === "string" ? event.sessionId : undefined;
    const payloadKind = typeof event.payload.kind === "string" ? event.payload.kind : undefined;
    const isSubagentStart =
      event.type === "run.started" && payloadKind === "subagent" && Boolean(eventSessionId);
    if (isSubagentStart && eventSessionId) {
      upsertSubagent(eventSessionId, {
        sessionId: eventSessionId,
        promptName: String(event.payload.promptName ?? "subagent"),
        goal: asString(event.payload.goal),
        status: "running",
        activity: "starting",
      });
      return false;
    }

    if (
      eventSessionId &&
      subagentsRef.current.some((entry) => entry.sessionId === eventSessionId)
    ) {
      if (event.type === "model.selected") {
        upsertSubagent(eventSessionId, {
          sessionId: eventSessionId,
          promptName: "subagent",
          status: "running",
          model: asString(event.payload.model),
          activity: "model selected",
        });
      } else if (event.type === "model.reasoning_delta") {
        upsertSubagent(eventSessionId, {
          sessionId: eventSessionId,
          promptName: "subagent",
          status: "running",
          activity: "reasoning",
        });
      } else if (event.type === "model.output_delta") {
        upsertSubagent(eventSessionId, {
          sessionId: eventSessionId,
          promptName: "subagent",
          status: "running",
          activity: "responding",
        });
      } else if (event.type === "tool.started") {
        const action = asString(event.payload.action) ?? "tool";
        upsertSubagent(eventSessionId, {
          sessionId: eventSessionId,
          promptName: "subagent",
          status: "running",
          activity: `tool: ${action}`,
        });
      } else if (event.type === "run.completed") {
        const summary = asString(event.payload.summary);
        upsertSubagent(eventSessionId, {
          sessionId: eventSessionId,
          promptName: asString(event.payload.promptName) ?? "subagent",
          status: "completed",
          activity: "completed",
          summary,
        });
        if (summary && summary.length > 0) {
          appendSystemMessage(`subagent completed (${eventSessionId}): ${summary}`);
        } else {
          appendSystemMessage(`subagent completed (${eventSessionId}).`);
        }
      } else if (event.type === "run.failed") {
        upsertSubagent(eventSessionId, {
          sessionId: eventSessionId,
          promptName: asString(event.payload.promptName) ?? "subagent",
          status: "failed",
          activity: asString(event.payload.reason) ?? "failed",
        });
      }
      return false;
    }

    // Only render the top-level run's model/tool activity in the main
    // transcript. Any unknown foreign session events are ignored.
    const topLevelSession = activeRunSessionRef.current;
    if (topLevelSession && eventSessionId && eventSessionId !== topLevelSession) {
      return false;
    }

    if (event.type === "model.reasoning_delta") {
      appendTurnThinking(String(event.payload.delta ?? ""), asNumber(event.payload.iteration));
      return true;
    }
    if (event.type === "model.output_delta") {
      appendTurnAssistant(String(event.payload.delta ?? ""), asNumber(event.payload.iteration));
      return true;
    }
    if (event.type === "tool.started") {
      const action = String(event.payload.action ?? "unknown_tool");
      if (action === "wait_subagents") {
        appendTurnSystemMessage(
          "waiting for subagent result...",
          asNumber(event.payload.iteration),
        );
        return true;
      }
      appendTurnSystemMessage(`tool started: ${action}`, asNumber(event.payload.iteration));
      return true;
    }
    if (event.type === "tool.blocked") {
      const action = String(event.payload.action ?? "unknown_tool");
      const reason = String(event.payload.reason ?? "blocked");
      appendTurnSystemMessage(
        `tool blocked: ${action} (${reason})`,
        asNumber(event.payload.iteration),
      );
      return true;
    }
    if (event.type === "limit.reached") {
      const action = String(event.payload.action ?? "unknown");
      const limit = Number(event.payload.limit ?? 0);
      appendTurnSystemMessage(
        `limit reached: ${action} (${limit})`,
        asNumber(event.payload.iteration),
      );
      return true;
    }
    if (event.type === "run.failed") {
      const reason = String(event.payload.reason ?? "run failed");
      appendSystemMessage(reason);
      return true;
    }
    return true;
  }

  function upsertSubagent(sessionId: string, next: SubagentStatus): void {
    setSubagents((items) => {
      const existing = items.find((entry) => entry.sessionId === sessionId);
      const merged: SubagentStatus = existing
        ? {
            ...existing,
            ...next,
            promptName: next.promptName === "subagent" ? existing.promptName : next.promptName,
          }
        : next;
      const without = items.filter((entry) => entry.sessionId !== sessionId);
      const updated = [merged, ...without];
      return updated.slice(0, 24);
    });
  }

  function appendSystemMessage(text: string): void {
    setChatEntries((items) => appendSystemEntry(items, randomUUID(), text));
  }

  function startTurn(userText: string): void {
    const turnId = randomUUID();
    activeTurnIdRef.current = turnId;
    setChatEntries((items) => startUserTurn(items, turnId, userText));
  }

  function appendTurnThinking(delta: string, iteration: number | undefined): void {
    setChatEntries((items) => {
      const next = appendThinkingDelta(
        items,
        activeTurnIdRef.current,
        iteration,
        randomUUID,
        delta,
      );
      activeTurnIdRef.current = next.activeTurnId;
      return next.entries;
    });
  }

  function appendTurnAssistant(delta: string, iteration: number | undefined): void {
    setChatEntries((items) => {
      const next = appendAssistantDelta(
        items,
        activeTurnIdRef.current,
        iteration,
        randomUUID,
        delta,
      );
      activeTurnIdRef.current = next.activeTurnId;
      return next.entries;
    });
  }

  function appendTurnSystemMessage(text: string, iteration: number | undefined): void {
    setChatEntries((items) =>
      appendStepSystemMessage(items, activeTurnIdRef.current, iteration, randomUUID, text),
    );
  }

  function toggleAllThinkingCollapse(): void {
    setChatEntries((items) => toggleAllThinkingCollapseInTranscript(items));
  }

  return (
    <Box flexDirection="column" height={viewportHeight}>
      <Box flexDirection="column" height={contentRows}>
        {screen === "chat" ? (
          <>
            {transcriptViewport.visible.map((line) => (
              <Text key={line.id} color={line.color}>
                {line.text}
              </Text>
            ))}
            {transcriptViewport.offset > 0 ? (
              <Text color="gray">
                ↑ scrolled {transcriptViewport.offset} lines ({transcriptViewport.maxOffset} max)
              </Text>
            ) : null}
          </>
        ) : null}

        {screen === "sessions" && <Screen title="Sessions">{sessionsView}</Screen>}
        {screen === "session-details" && (
          <Screen title="Session Details">{sessionDetailView}</Screen>
        )}
        {screen === "context" && <Screen title="Context Window">{contextView}</Screen>}
        {screen === "telemetry" && <Screen title="Telemetry">{telemetryView}</Screen>}
        {screen === "help" && <HelpScreen modelChoices={modelChoices} />}
      </Box>

      <Box>
        <Text color={modeStyle.color}>[{modeStyle.label}] </Text>
        <Text color={modeStyle.color}>› </Text>
        {pendingApproval ? (
          <Text color="yellow">awaiting approval (y/n/a)</Text>
        ) : (
          <TextInput value={input} onChange={setInput} onSubmit={submit} />
        )}
        {running && (
          <Box marginLeft={1}>
            <Text color="yellow">
              <Spinner type="dots" /> running
            </Text>
          </Box>
        )}
      </Box>

      <FooterStatusBar
        sessionId={activeSessionId}
        mode={mode}
        effort={composition.runtimeState.effort}
        provider={composition.runtimeState.provider}
        modelLabel={modelLabel}
        contextStyle={contextStyle}
        running={running}
        status={status}
        subagents={subagents}
        shortcutHint={shortcutHint}
        columns={terminalColumns}
      />
    </Box>
  );
}

function FooterStatusBar(props: {
  sessionId: string;
  mode: HarnessMode;
  effort: EffortLevel;
  provider: string;
  modelLabel: string;
  contextStyle: { label: string; color: string };
  running: boolean;
  status: StatusState;
  subagents: SubagentStatus[];
  shortcutHint: string;
  columns: number;
}): React.ReactElement {
  const runningSubagents = props.subagents.filter((entry) => entry.status === "running").length;
  const finishedSubagents = props.subagents.filter((entry) => entry.status !== "running").length;
  const line1 = trimToColumns(
    [
      `session=${props.sessionId}`,
      `mode=${props.mode}`,
      `effort=${props.effort}`,
      `provider=${props.provider}`,
      props.modelLabel,
      props.contextStyle.label,
    ].join(" | "),
    props.columns,
  );
  const line2 = trimToColumns(
    [
      `tokens=${props.status.tokensIn}/${props.status.tokensOut}`,
      `turns=${props.status.turns}`,
      `errors=${props.status.errors}`,
      `limits=${props.status.limitHits}`,
      `subagents=${runningSubagents} running/${finishedSubagents} done`,
      props.status.compressing ? "COMPRESSING" : "",
      props.running ? "RUNNING" : "",
    ]
      .filter(Boolean)
      .join(" | "),
    props.columns,
  );
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text>{line1}</Text>
      <Text>{line2}</Text>
      <Text color="gray">{trimToColumns(props.shortcutHint, props.columns)}</Text>
    </Box>
  );
}

function renderApprovalPrompt(pending: ApprovalView | undefined): React.ReactElement | null {
  if (!pending) return null;
  return (
    <Box marginTop={1} flexDirection="column" borderStyle="round" borderColor="yellow">
      <Text color="yellow">
        Approval required: {pending.request.tool.name} (press y=approve, n=reject, a=always)
      </Text>
      <Text>{pending.preview.slice(0, 2000)}</Text>
    </Box>
  );
}

function Screen({ title, children }: { title: string; children: string }): React.ReactElement {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan">
      <Text color="cyan">{title}</Text>
      <Text>{children}</Text>
    </Box>
  );
}

function HelpScreen({ modelChoices }: { modelChoices: string[] }): React.ReactElement {
  const commandLines = helpCommandLines(modelChoices);
  const shortcutLines = helpShortcutLines();
  const lines = [
    "Slash commands:",
    ...commandLines.map((line) => `  ${line}`),
    "",
    "Keyboard shortcuts:",
    ...shortcutLines.map((line) => `  ${line}`),
  ].join("\n");
  return <Screen title="Commands & Shortcuts">{lines}</Screen>;
}

function trimToColumns(text: string, columns: number): string {
  if (text.length <= columns) return text;
  if (columns <= 1) return "…";
  return `${text.slice(0, Math.max(0, columns - 1))}…`;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

interface ChatRenderLine {
  id: string;
  text: string;
  color?: "gray" | "cyan" | "yellow" | "green";
}

function buildChatLines(
  entries: ChatEntry[],
  subagents: SubagentStatus[],
  compressing: boolean,
  pendingApproval: ApprovalView | undefined,
  columns: number,
): ChatRenderLine[] {
  const lines: ChatRenderLine[] = [];
  for (const entry of entries) {
    if (entry.type === "system") {
      pushWrapped(lines, entry.id, "gray", `system > ${entry.text ?? ""}`, columns);
      continue;
    }
    if (!entry.turn) continue;
    if (entry.turn.userText) {
      pushWrapped(lines, `${entry.id}-user`, "cyan", `user > ${entry.turn.userText}`, columns);
    }
    for (const step of entry.turn.steps) {
      if (step.thinkingText.length > 0) {
        pushWrapped(
          lines,
          `${step.id}-think-header`,
          "yellow",
          `Thinking${formatIteration(step.iteration)} [${step.thinkingCollapsed ? "collapsed" : "expanded"}]`,
          columns,
        );
        if (!step.thinkingCollapsed) {
          pushMultiline(lines, `${step.id}-think`, undefined, step.thinkingText, columns);
        }
      }
      if (step.assistantText.length > 0) {
        pushMultiline(
          lines,
          `${step.id}-assistant`,
          "green",
          `assistant${formatIteration(step.iteration)} > ${step.assistantText}`,
          columns,
        );
      }
      for (const message of step.systemMessages) {
        pushWrapped(
          lines,
          `${step.id}-sys-${message.id}`,
          "gray",
          `system${formatIteration(step.iteration)} > ${message.text}`,
          columns,
        );
      }
    }
  }
  if (compressing) {
    pushWrapped(lines, "compressing", "yellow", "Compressing context...", columns);
  }
  const runningSubagents = subagents.filter((entry) => entry.status === "running");
  if (runningSubagents.length > 0) {
    pushWrapped(
      lines,
      "subagents-header",
      "yellow",
      `subagents > running ${runningSubagents.length}`,
      columns,
    );
    for (const subagent of runningSubagents) {
      const activity = subagent.activity ? ` | ${subagent.activity}` : "";
      const model = subagent.model ? ` | model=${subagent.model}` : "";
      pushWrapped(
        lines,
        `subagent-${subagent.sessionId}`,
        "yellow",
        `subagent > [running] ${subagent.promptName} (${subagent.sessionId})${activity}${model}`,
        columns,
      );
    }
  }
  const finishedSubagents = subagents.filter((entry) => entry.status !== "running").slice(0, 5);
  if (finishedSubagents.length > 0) {
    pushWrapped(
      lines,
      "subagents-finished-header",
      "gray",
      `subagents > recent finished ${finishedSubagents.length}`,
      columns,
    );
    for (const subagent of finishedSubagents) {
      const summary = subagent.summary ? ` | ${subagent.summary}` : "";
      pushWrapped(
        lines,
        `subagent-finished-${subagent.sessionId}`,
        subagent.status === "completed" ? "green" : "yellow",
        `subagent > [${subagent.status}] ${subagent.promptName} (${subagent.sessionId})${summary}`,
        columns,
      );
    }
  }
  if (pendingApproval) {
    pushWrapped(
      lines,
      "approval-title",
      "yellow",
      `Approval required: ${pendingApproval.request.tool.name} (y=approve, n=reject, a=always)`,
      columns,
    );
    pushMultiline(
      lines,
      "approval-preview",
      undefined,
      pendingApproval.preview.slice(0, 600),
      columns,
    );
  }
  return lines;
}

function pushMultiline(
  lines: ChatRenderLine[],
  idPrefix: string,
  color: ChatRenderLine["color"],
  text: string,
  columns: number,
): void {
  const segments = text.split(/\r?\n/);
  segments.forEach((segment, index) => {
    pushWrapped(lines, `${idPrefix}-${index}`, color, segment, columns);
  });
}

function pushWrapped(
  lines: ChatRenderLine[],
  idPrefix: string,
  color: ChatRenderLine["color"],
  text: string,
  columns: number,
): void {
  const safeWidth = Math.max(10, columns);
  if (text.length === 0) {
    lines.push({ id: `${idPrefix}-0`, text: "", color });
    return;
  }
  for (let start = 0, index = 0; start < text.length; start += safeWidth, index += 1) {
    lines.push({
      id: `${idPrefix}-${index}`,
      text: text.slice(start, start + safeWidth),
      color,
    });
  }
}
