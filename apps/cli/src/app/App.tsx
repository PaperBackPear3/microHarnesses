import { availableModelChoices, withModeExecutionContract } from "@micro-harnesses/core";
import { Box, Text, useInput } from "ink";
import Spinner from "ink-spinner";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactElement } from "react";
import type { CliComposition } from "../runtime/composition.js";
import { type UiScreen, parseSlashCommand } from "../slash/commands.js";
import { buildChatLines } from "./chatLines.js";
import { Composer, estimateComposerRows } from "./components/Composer.js";
import { FooterStatusBar } from "./components/FooterStatusBar.js";
import { HelpScreen, Screen } from "./components/Screens.js";
import { handleSlashCommand } from "./slashController.js";
import { ChatStore } from "./store/chatStore.js";
import { useChatStore } from "./store/useChatStore.js";
import {
  compactShortcutHintLine,
  contextBadgeStyle,
  modePromptStyle,
  modelBadgeLabel,
} from "./uiMeta.js";
import { sliceFromBottom } from "./viewport.js";

interface Props {
  composition: CliComposition;
  buildForSession(sessionId: string): Promise<CliComposition>;
  onExit(): void;
}

export function App({
  composition: initialComposition,
  buildForSession,
  onExit,
}: Props): ReactElement {
  const [composition, setComposition] = useState<CliComposition>(initialComposition);
  const [chatStore, setChatStore] = useState<ChatStore>(
    () =>
      new ChatStore(
        initialComposition.uiStream,
        initialComposition.approvalController,
        initialComposition.cliVersion,
      ),
  );
  const chatSnapshot = useChatStore(chatStore);
  const { entries: chatEntries, status, pendingApproval, subagents, running } = chatSnapshot;

  const [input, setInput] = useState("");
  const [screen, setScreen] = useState<UiScreen>("chat");
  const [screenContent, setScreenContent] = useState<string>("No content available.");
  const [chatScrollOffset, setChatScrollOffset] = useState(0);
  const [diagnosticsExpanded, setDiagnosticsExpanded] = useState(true);
  const [thinkingExpanded, setThinkingExpanded] = useState(true);
  const [switchingSession, setSwitchingSession] = useState(false);
  const [activeSessionId, setActiveSessionId] = useState(composition.rootSessionId);

  useEffect(() => () => chatStore.dispose(), [chatStore]);

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
  const composerRows = estimateComposerRows(input, Math.max(20, terminalColumns - 10));
  const footerRows = 3;
  const contentRows = Math.max(1, viewportHeight - composerRows - footerRows);

  const chatLines = useMemo(
    () =>
      buildChatLines(chatEntries, subagents, status.compressing, pendingApproval, terminalColumns, {
        diagnosticsExpanded,
        thinkingExpanded,
      }),
    [
      chatEntries,
      subagents,
      status.compressing,
      pendingApproval,
      terminalColumns,
      diagnosticsExpanded,
      thinkingExpanded,
    ],
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
      chatStore.setRunning(false);
      chatStore.appendSystemMessage("Run interrupted.");
      return;
    }
    if (key.ctrl && raw === "d") {
      onExit();
      return;
    }
    if (key.tab && key.shift) {
      const next = composition.modeController.cycle();
      chatStore.appendSystemMessage(`Mode changed to ${next}.`);
      return;
    }
    if (key.ctrl && raw.toLowerCase() === "t") {
      setThinkingExpanded((current) => !current);
      return;
    }
    if (key.ctrl && raw.toLowerCase() === "y") {
      setDiagnosticsExpanded((current) => !current);
      return;
    }
  });

  const submit = useCallback(
    async (value: string) => {
      const trimmed = value.trim();
      if (trimmed.length === 0 || running || switchingSession) {
        setInput("");
        return;
      }

      const slash = parseSlashCommand(trimmed);
      if (slash) {
        await handleSlashCommand({
          command: slash,
          composition,
          chatStore,
          activeSessionId,
          status,
          setScreen,
          setScreenContent,
          setChatScrollOffset,
          switchToSession,
          onExit,
        });
        setInput("");
        return;
      }

      chatStore.startTurn(trimmed);
      setScreen("chat");
      setChatScrollOffset(0);
      chatStore.setRunning(true);
      setInput("");

      const runSessionId = activeSessionId;
      chatStore.setActiveRunSession(runSessionId);
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
        chatStore.appendSystemMessage(`Error: ${message}`);
      } finally {
        chatStore.setRunning(false);
        chatStore.setActiveRunSession(undefined);
      }
    },
    [composition, activeSessionId, chatStore, running, switchingSession, status, onExit],
  );

  async function switchToSession(sessionId: string, notice: string): Promise<void> {
    if (running || switchingSession) {
      chatStore.appendSystemMessage("Cannot switch sessions while a run is in progress.");
      return;
    }
    setSwitchingSession(true);
    // Rebuild the runtime so context + telemetry are rooted at the new session,
    // preserving the user's current provider/model/effort/mode selections.
    try {
      const next = await buildForSession(sessionId);
      next.approvalController.setInteractive(true);
      next.runtimeState.provider = composition.runtimeState.provider;
      next.runtimeState.model = composition.runtimeState.model;
      next.runtimeState.effort = composition.runtimeState.effort;
      next.modelSelector.setEffort(composition.runtimeState.effort);
      next.modeController.setMode(composition.modeController.getMode());
      await next.refreshContextWindowTokens();

      const nextStore = new ChatStore(next.uiStream, next.approvalController, next.cliVersion);
      nextStore.appendSystemMessage(notice);
      setChatStore(() => nextStore);
      setComposition(next);
      setActiveSessionId(next.rootSessionId);
      setChatScrollOffset(0);
      setScreen("chat");
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown session switch failure";
      chatStore.appendSystemMessage(`Session switch failed: ${message}`);
    } finally {
      setSwitchingSession(false);
    }
  }

  return (
    <Box flexDirection="column" height={viewportHeight}>
      <Box flexDirection="column" height={contentRows}>
        {screen === "chat" ? (
          <>
            {transcriptViewport.visible.map((line) => (
              <Text key={line.id}>
                <Text color={line.indicatorColor}>{line.indicator}</Text>
                <Text color={line.textColor}>{line.text}</Text>
              </Text>
            ))}
            {transcriptViewport.offset > 0 ? (
              <Text color="gray">
                ↑ scrolled {transcriptViewport.offset} lines ({transcriptViewport.maxOffset} max)
              </Text>
            ) : null}
          </>
        ) : null}

        {screen === "sessions" && <Screen title="Sessions">{screenContent}</Screen>}
        {screen === "session-details" && <Screen title="Session Details">{screenContent}</Screen>}
        {screen === "context" && <Screen title="Context Window">{screenContent}</Screen>}
        {screen === "telemetry" && <Screen title="Telemetry">{screenContent}</Screen>}
        {screen === "help" && (
          <HelpScreen modelChoices={modelChoices} cliVersion={composition.cliVersion} />
        )}
      </Box>

      <Box>
        <Text color={modeStyle.color}>[{modeStyle.label}] </Text>
        <Text color={modeStyle.color}>› </Text>
        {pendingApproval ? (
          <Text color="yellow">awaiting approval (y/n/a)</Text>
        ) : (
          <Composer
            value={input}
            onChange={setInput}
            onSubmit={submit}
            disabled={switchingSession}
          />
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
        cliVersion={composition.cliVersion}
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
