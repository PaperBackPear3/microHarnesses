import { randomUUID } from "node:crypto";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";
import Spinner from "ink-spinner";
import TextInput from "ink-text-input";
import type { StreamEvent } from "@micro-harnesses/core";
import type { EffortLevel } from "../config/config";
import { availableModelChoices } from "../config/providers";
import type { CliMode } from "../modes/modes";
import { parseSlashCommand, type SlashCommand, type UiScreen } from "../slash/commands";
import { createStatusState, reduceStatus, type StatusState } from "../telemetry/status";
import type { CliComposition } from "../runtime/composition";

interface ChatMessage {
  role: "user" | "assistant" | "system";
  text: string;
}

interface Props {
  composition: CliComposition;
  onExit(): void;
}

export function App({ composition, onExit }: Props): React.ReactElement {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [assistantDraft, setAssistantDraft] = useState("");
  const [thinking, setThinking] = useState("");
  const [input, setInput] = useState("");
  const [running, setRunning] = useState(false);
  const [screen, setScreen] = useState<UiScreen>("chat");
  const [status, setStatus] = useState<StatusState>(createStatusState());
  const [activeSessionId, setActiveSessionId] = useState(composition.rootSessionId);
  const [sessionsView, setSessionsView] = useState<string>("No sessions loaded.");
  const [sessionDetailView, setSessionDetailView] = useState<string>("No session selected.");
  const [contextView, setContextView] = useState<string>("No context metrics yet.");
  const [telemetryView, setTelemetryView] = useState<string>("No telemetry yet.");

  const mode = composition.modeController.getMode();
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

  useInput((raw, key) => {
    if ((key.escape || (key.ctrl && raw === "c")) && running) {
      composition.agent.kill("interrupted by user");
      setRunning(false);
      setMessages((items) => [...items, { role: "system", text: "Run interrupted." }]);
      return;
    }
    if (key.ctrl && raw === "d") {
      onExit();
      return;
    }
    if (key.tab && key.shift) {
      const next = composition.modeController.cycle();
      setMessages((items) => [...items, { role: "system", text: `Mode changed to ${next}.` }]);
      return;
    }
    if (composition.approvalController.getPending()) {
      if (raw.toLowerCase() === "y") {
        composition.approvalController.resolvePending("approve");
      } else if (raw.toLowerCase() === "n") {
        composition.approvalController.resolvePending("reject");
      } else if (raw.toLowerCase() === "a") {
        composition.approvalController.resolvePending("always");
      }
    }
  });

  const submit = useCallback(
    async (value: string) => {
      const trimmed = value.trim();
      if (trimmed.length === 0 || running) {
        setInput("");
        return;
      }

      const slash = parseSlashCommand(trimmed);
      if (slash) {
        await handleSlash(slash);
        setInput("");
        return;
      }

      setMessages((items) => [...items, { role: "user", text: trimmed }]);
      setAssistantDraft("");
      setThinking("");
      setScreen("chat");
      setRunning(true);
      setInput("");

      try {
        const state = await composition.agent.run(trimmed, {
          ...composition.runOptions(),
          sessionId: activeSessionId,
          resume: true,
        });
        if (state.sessionId) {
          setActiveSessionId(state.sessionId);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "unknown run failure";
        setMessages((items) => [...items, { role: "system", text: `Error: ${message}` }]);
      } finally {
        setRunning(false);
      }
    },
    [running, composition, activeSessionId],
  );

  async function handleSlash(command: SlashCommand): Promise<void> {
    if (command.type === "exit") {
      onExit();
      return;
    }
    if (command.type === "clear") {
      setMessages([]);
      setAssistantDraft("");
      setThinking("");
      return;
    }
    if (command.type === "set-mode") {
      composition.modeController.setMode(command.mode);
      setMessages((items) => [...items, { role: "system", text: `Mode set to ${command.mode}.` }]);
      return;
    }
    if (command.type === "set-effort") {
      composition.runtimeState.effort = command.effort;
      composition.modelSelector.setEffort(command.effort);
      setMessages((items) => [...items, { role: "system", text: `Effort set to ${command.effort}.` }]);
      return;
    }
    if (command.type === "set-model") {
      composition.runtimeState.model = command.model;
      setMessages((items) => [...items, { role: "system", text: `Model override set to ${command.model}.` }]);
      return;
    }
    if (command.type === "set-provider") {
      composition.runtimeState.provider = command.provider;
      setMessages((items) => [...items, { role: "system", text: `Provider set to ${command.provider}.` }]);
      return;
    }
    if (command.type === "new-session") {
      const nextId = `s-${randomUUID()}`;
      setActiveSessionId(nextId);
      setMessages((items) => [...items, { role: "system", text: `Started new session ${nextId}.` }]);
      return;
    }
    if (command.type === "switch-session") {
      setActiveSessionId(command.sessionId);
      setMessages((items) => [...items, { role: "system", text: `Switched to session ${command.sessionId}.` }]);
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
    if (event.type === "model.reasoning_delta") {
      setThinking((current) => `${current}${String(event.payload.delta ?? "")}`);
      return;
    }
    if (event.type === "model.output_delta") {
      setAssistantDraft((current) => `${current}${String(event.payload.delta ?? "")}`);
      return;
    }
    if (event.type === "model.output_completed") {
      setAssistantDraft((draft) => {
        if (draft.length > 0) {
          setMessages((items) => [...items, { role: "assistant", text: draft }]);
        }
        return "";
      });
      return;
    }
    if (event.type === "tool.started") {
      const action = String(event.payload.action ?? "unknown_tool");
      setMessages((items) => [...items, { role: "system", text: `tool started: ${action}` }]);
      return;
    }
    if (event.type === "tool.blocked") {
      const action = String(event.payload.action ?? "unknown_tool");
      const reason = String(event.payload.reason ?? "blocked");
      setMessages((items) => [...items, { role: "system", text: `tool blocked: ${action} (${reason})` }]);
      return;
    }
    if (event.type === "run.failed") {
      const reason = String(event.payload.reason ?? "run failed");
      setMessages((items) => [...items, { role: "system", text: reason }]);
    }
  }

  return (
    <Box flexDirection="column">
      <StatusBar
        sessionId={activeSessionId}
        mode={mode}
        effort={composition.runtimeState.effort}
        provider={composition.runtimeState.provider}
        model={composition.runtimeState.model ?? status.model}
        running={running}
        status={status}
      />

      <Box marginTop={1} flexDirection="column">
        {screen === "chat" && (
          <>
            {messages.slice(-12).map((message, index) => (
              <Text key={`${message.role}-${index}`}>
                <Text color={colorForRole(message.role)}>
                  {message.role}
                  {" > "}
                </Text>
                {message.text}
              </Text>
            ))}
            {thinking.length > 0 && (
              <Box flexDirection="column" marginTop={1}>
                <Text color="yellow">Thinking</Text>
                <Text>{thinking.slice(-500)}</Text>
              </Box>
            )}
            {assistantDraft.length > 0 && (
              <Text>
                <Text color="green">assistant&gt; </Text>
                {assistantDraft}
              </Text>
            )}
          </>
        )}

        {screen === "sessions" && (
          <Screen title="Sessions">{sessionsView}</Screen>
        )}
        {screen === "session-details" && (
          <Screen title="Session Details">{sessionDetailView}</Screen>
        )}
        {screen === "context" && <Screen title="Context Window">{contextView}</Screen>}
        {screen === "telemetry" && <Screen title="Telemetry">{telemetryView}</Screen>}
        {screen === "help" && <HelpScreen modelChoices={modelChoices} />}
      </Box>

      {renderApprovalPrompt(composition)}

      <Box marginTop={1}>
        <Text color="cyan">› </Text>
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
  );
}

function StatusBar(props: {
  sessionId: string;
  mode: CliMode;
  effort: EffortLevel;
  provider: string;
  model?: string;
  running: boolean;
  status: StatusState;
}): React.ReactElement {
  const utilization =
    typeof props.status.contextUtilization === "number"
      ? `${Math.round(props.status.contextUtilization * 100)}%`
      : "n/a";
  return (
    <Box>
      <Text>
        session={props.sessionId} | mode={props.mode} | effort={props.effort} | provider=
        {props.provider} | model={props.model ?? "-"} | ctx={utilization} | tokens=
        {props.status.tokensIn}/{props.status.tokensOut} | turns={props.status.turns} | errors=
        {props.status.errors}
        {props.running ? " | RUNNING" : ""}
      </Text>
    </Box>
  );
}

function renderApprovalPrompt(composition: CliComposition): React.ReactElement | null {
  const pending = composition.approvalController.getPending();
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
  return (
    <Screen
      title="Commands"
      children={[
        "/plan | /edits | /autopilot",
        "/mode <plan|accept-edits|autopilot>",
        "/effort <low|medium|high>",
        `/model <id> (choices: ${modelChoices.join(", ") || "provider defaults"})`,
        "/provider <openai|anthropic|ollama>",
        "/new",
        "/sessions",
        "/session <id>",
        "/resume <id>",
        "/context",
        "/telemetry",
        "/chat",
        "/clear",
        "/exit",
      ].join("\n")}
    />
  );
}

function colorForRole(role: ChatMessage["role"]): "cyan" | "green" | "gray" {
  if (role === "user") return "cyan";
  if (role === "assistant") return "green";
  return "gray";
}
