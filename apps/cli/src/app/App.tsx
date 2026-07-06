import { randomUUID } from "node:crypto";
import type { StreamEvent } from "@micro-harnesses/core";
import { Box, Text, useInput } from "ink";
import Spinner from "ink-spinner";
import TextInput from "ink-text-input";
// biome-ignore lint/style/useImportType: classic JSX runtime requires React as a value import.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EffortLevel } from "../config/config";
import { availableModelChoices } from "../config/providers";
import type { CliMode } from "../modes/modes";
import type { ApprovalView } from "../runtime/approvalHandler";
import type { CliComposition } from "../runtime/composition";
import { type SlashCommand, type UiScreen, parseSlashCommand } from "../slash/commands";
import { type StatusState, createStatusState, reduceStatus } from "../telemetry/status";
import { withModeExecutionContract } from "../runtime/autopilotPrompt";
import {
  type ChatEntry,
  appendAssistantDelta,
  appendStepSystemMessage,
  appendSystemEntry,
  appendThinkingDelta,
  asNumber,
  formatIteration,
  startUserTurn,
  toggleLatestThinkingCollapse as toggleLatestThinkingCollapseInTranscript,
} from "./transcript";
import {
  compactShortcutHintLine,
  contextBadgeStyle,
  helpCommandLines,
  helpShortcutLines,
  modePromptStyle,
  modelBadgeLabel,
} from "./uiMeta";

interface Props {
  composition: CliComposition;
  buildForSession(sessionId: string): Promise<CliComposition>;
  onExit(): void;
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
  const [activeSessionId, setActiveSessionId] = useState(composition.rootSessionId);
  const [sessionsView, setSessionsView] = useState<string>("No sessions loaded.");
  const [sessionDetailView, setSessionDetailView] = useState<string>("No session selected.");
  const [contextView, setContextView] = useState<string>("No context metrics yet.");
  const [telemetryView, setTelemetryView] = useState<string>("No telemetry yet.");
  const [pendingApproval, setPendingApproval] = useState<ApprovalView | undefined>(undefined);

  // Refs avoid stale-closure bugs in the long-lived stream subscription and
  // guard against overlapping runs triggered by rapid input.
  const activeTurnIdRef = useRef<string | undefined>(undefined);
  const activeRunSessionRef = useRef<string | undefined>(undefined);
  const runningRef = useRef(false);

  const mode = composition.modeController.getMode();
  const modeStyle = modePromptStyle(mode);
  const contextStyle = contextBadgeStyle(status);
  const modelLabel = modelBadgeLabel(composition.runtimeState.model ?? status.model);
  const shortcutHint = compactShortcutHintLine();
  const modelChoices = useMemo(
    () => availableModelChoices(composition.runtimeState.provider),
    [composition.runtimeState.provider],
  );

  useEffect(() => {
    return composition.uiStream.subscribe(({ streamEvent }) => {
      applyStreamEvent(streamEvent);
      setStatus((current) => reduceStatus(current, streamEvent));
    });
  }, [composition.uiStream]);

  useEffect(() => {
    return composition.approvalController.subscribe((pending) => {
      setPendingApproval(pending);
    });
  }, [composition.approvalController]);

  useInput((raw, key) => {
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
      toggleLatestThinkingCollapse();
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

    setComposition(next);
    setActiveSessionId(next.rootSessionId);
    setChatEntries([{ id: randomUUID(), type: "system", text: notice }]);
    activeTurnIdRef.current = undefined;
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
      appendSystemMessage(`Effort set to ${command.effort}.`);
      return;
    }
    if (command.type === "set-model") {
      composition.runtimeState.model = command.model;
      appendSystemMessage(`Model override set to ${command.model}.`);
      return;
    }
    if (command.type === "set-provider") {
      composition.runtimeState.provider = command.provider;
      appendSystemMessage(`Provider set to ${command.provider}.`);
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
    }
  }

  function applyStreamEvent(event: StreamEvent): void {
    // Only render the top-level run's model/tool activity. Subagent runs share
    // the same stream but carry a different sessionId; their output must not be
    // spliced into the main assistant transcript.
    const topLevelSession = activeRunSessionRef.current;
    if (topLevelSession && event.sessionId && event.sessionId !== topLevelSession) {
      return;
    }

    if (event.type === "model.reasoning_delta") {
      appendTurnThinking(String(event.payload.delta ?? ""), asNumber(event.payload.iteration));
      return;
    }
    if (event.type === "model.output_delta") {
      appendTurnAssistant(String(event.payload.delta ?? ""), asNumber(event.payload.iteration));
      return;
    }
    if (event.type === "tool.started") {
      const action = String(event.payload.action ?? "unknown_tool");
      appendTurnSystemMessage(`tool started: ${action}`, asNumber(event.payload.iteration));
      return;
    }
    if (event.type === "tool.blocked") {
      const action = String(event.payload.action ?? "unknown_tool");
      const reason = String(event.payload.reason ?? "blocked");
      appendTurnSystemMessage(
        `tool blocked: ${action} (${reason})`,
        asNumber(event.payload.iteration),
      );
      return;
    }
    if (event.type === "limit.reached") {
      const action = String(event.payload.action ?? "unknown");
      const limit = Number(event.payload.limit ?? 0);
      appendTurnSystemMessage(
        `limit reached: ${action} (${limit})`,
        asNumber(event.payload.iteration),
      );
      return;
    }
    if (event.type === "run.failed") {
      const reason = String(event.payload.reason ?? "run failed");
      appendSystemMessage(reason);
    }
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

  function toggleLatestThinkingCollapse(): void {
    setChatEntries((items) => toggleLatestThinkingCollapseInTranscript(items));
  }

  const viewportHeight = Math.max((process.stdout.rows ?? 24) - 1, 16);

  return (
    <Box flexDirection="column" height={viewportHeight}>
      <Box flexDirection="column" flexGrow={1}>
        {screen === "chat" && (
          <>
            {chatEntries.slice(-12).map((entry) =>
              entry.type === "system" ? (
                <Text key={entry.id}>
                  <Text color="gray">system &gt; </Text>
                  {entry.text}
                </Text>
              ) : (
                <Box key={entry.id} flexDirection="column">
                  {entry.turn?.userText ? (
                    <Text>
                      <Text color="cyan">user &gt; </Text>
                      {entry.turn.userText}
                    </Text>
                  ) : null}
                  {entry.turn?.steps.map((step) => (
                    <Box key={step.id} flexDirection="column">
                      {step.thinkingText.length > 0 ? (
                        <Box flexDirection="column">
                          <Text color="yellow">
                            Thinking{formatIteration(step.iteration)} [
                            {step.thinkingCollapsed ? "collapsed" : "expanded"}]
                          </Text>
                          {!step.thinkingCollapsed && <Text>{step.thinkingText}</Text>}
                        </Box>
                      ) : null}
                      {step.assistantText ? (
                        <Text>
                          <Text color="green">
                            assistant{formatIteration(step.iteration)} &gt;{" "}
                          </Text>
                          {step.assistantText}
                        </Text>
                      ) : null}
                      {step.systemMessages.map((message) => (
                        <Text key={message.id}>
                          <Text color="gray">system{formatIteration(step.iteration)} &gt; </Text>
                          {message.text}
                        </Text>
                      ))}
                    </Box>
                  ))}
                </Box>
              ),
            )}
          </>
        )}

        {screen === "sessions" && <Screen title="Sessions">{sessionsView}</Screen>}
        {screen === "session-details" && (
          <Screen title="Session Details">{sessionDetailView}</Screen>
        )}
        {screen === "context" && <Screen title="Context Window">{contextView}</Screen>}
        {screen === "telemetry" && <Screen title="Telemetry">{telemetryView}</Screen>}
        {screen === "help" && <HelpScreen modelChoices={modelChoices} />}
        {status.compressing ? <Text color="yellow">Compressing context...</Text> : null}
        {renderApprovalPrompt(pendingApproval)}
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Box>
          <Text color={modeStyle.color}>[{modeStyle.label}] </Text>
          <Text color={modeStyle.color}>› </Text>
          <TextInput value={input} onChange={setInput} onSubmit={submit} />
          {running && (
            <Box marginLeft={1}>
              <Text color="yellow">
                <Spinner type="dots" /> running
              </Text>
            </Box>
          )}
        </Box>
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
        shortcutHint={shortcutHint}
      />
    </Box>
  );
}

function FooterStatusBar(props: {
  sessionId: string;
  mode: CliMode;
  effort: EffortLevel;
  provider: string;
  modelLabel: string;
  contextStyle: { label: string; color: string };
  running: boolean;
  status: StatusState;
  shortcutHint: string;
}): React.ReactElement {
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text>
        session={props.sessionId} | mode={props.mode} | effort={props.effort} | provider=
        {props.provider} | <Text color="blue">{props.modelLabel}</Text> |{" "}
        <Text color={props.contextStyle.color}>{props.contextStyle.label}</Text> | tokens=
        {props.status.tokensIn}/{props.status.tokensOut} | turns={props.status.turns} | errors=
        {props.status.errors} | limits={props.status.limitHits}
        {props.status.compressing ? " | COMPRESSING" : ""}
        {props.running ? " | RUNNING" : ""}
      </Text>
      <Text color="gray">{props.shortcutHint}</Text>
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
