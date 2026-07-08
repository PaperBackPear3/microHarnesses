import {
  type MessageContentPart,
  availableModelChoices,
  withModeExecutionContract,
} from "@micro-harnesses/core";
import { Box, Text, useInput } from "ink";
import Spinner from "ink-spinner";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactElement } from "react";
import type { CliComposition } from "../runtime/composition.js";
import { resolveMainPromptName } from "../runtime/subagentPromptName.js";
import { type UiScreen, parseSlashCommand } from "../slash/commands.js";
import {
  type StagedAttachment,
  formatBytes,
  parseDroppedAttachmentPaths,
  stageAttachment,
} from "./attachments.js";
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
  const [stagedAttachments, setStagedAttachments] = useState<StagedAttachment[]>([]);

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
  const composerBoxRows = 1;
  const footerMarginRows = 1;
  const footerTextRows = 3;
  const controlRows = composerRows + composerBoxRows + footerMarginRows + footerTextRows;
  const contentRows = Math.max(1, viewportHeight - controlRows);

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
      const defaultPersona = next === "plan" ? "planner" : "coder";
      void resolveMainPromptName(defaultPersona, composition.promptsDir)
        .then((promptName) => {
          composition.runtimeState.promptName = promptName;
          chatStore.appendSystemMessage(`Mode changed to ${next}. Persona set to ${promptName}.`);
        })
        .catch((error) => {
          const message =
            error instanceof Error ? error.message : "unknown persona validation error";
          chatStore.appendSystemMessage(
            `Mode changed to ${next}. Persona unchanged (${composition.runtimeState.promptName}). ${message}`,
          );
        });
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

      const droppedFiles = await tryStageDroppedFiles(trimmed);
      if (droppedFiles) {
        setStagedAttachments((current) => [...current, ...droppedFiles]);
        const lines = droppedFiles.map(
          (entry) => `${entry.filename} (${entry.mimeType}, ${formatBytes(entry.sizeBytes)})`,
        );
        chatStore.appendSystemMessage(`Attached from drop:\n${lines.join("\n")}`);
        setInput("");
        return;
      }

      const slash = parseSlashCommand(trimmed);
      if (slash) {
        if (slash.type === "attach-file") {
          try {
            const staged = await stageAttachment(slash.filePath);
            setStagedAttachments((current) => [...current, staged]);
            chatStore.appendSystemMessage(
              `Attached ${staged.filename} (${staged.mimeType}, ${formatBytes(staged.sizeBytes)}).`,
            );
          } catch (error) {
            const message = error instanceof Error ? error.message : "unknown attachment error";
            chatStore.appendSystemMessage(`Attach failed: ${message}`);
          }
          setInput("");
          return;
        }
        if (slash.type === "list-attachments") {
          if (stagedAttachments.length === 0) {
            chatStore.appendSystemMessage("No staged attachments.");
          } else {
            const lines = stagedAttachments.map(
              (entry, index) =>
                `${index + 1}. ${entry.filename} (${entry.mimeType}, ${formatBytes(entry.sizeBytes)})`,
            );
            chatStore.appendSystemMessage(`Staged attachments:\n${lines.join("\n")}`);
          }
          setInput("");
          return;
        }
        if (slash.type === "detach-file") {
          const target = slash.target.trim();
          const byIndex = Number.parseInt(target, 10);
          const index = Number.isInteger(byIndex) ? byIndex - 1 : -1;
          const removed =
            index >= 0 && index < stagedAttachments.length
              ? stagedAttachments[index]
              : stagedAttachments.find((entry) => entry.filename === target);
          if (!removed) {
            chatStore.appendSystemMessage(`No staged attachment found for "${slash.target}".`);
          } else {
            setStagedAttachments((current) => current.filter((entry) => entry !== removed));
            chatStore.appendSystemMessage(`Detached ${removed.filename}.`);
          }
          setInput("");
          return;
        }
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
        const pendingAttachments = stagedAttachments;
        ensureAttachmentSupport(composition.runtimeState.provider, pendingAttachments);
        const inputContent: MessageContentPart[] = [];
        if (effectivePrompt.trim().length > 0) {
          inputContent.push({ type: "text", text: effectivePrompt });
        }
        for (const attachment of pendingAttachments) {
          const saved = await composition.sessionStore.saveInputAsset(
            runSessionId,
            attachment.path,
            {
              mimeType: attachment.mimeType,
            },
          );
          if (attachment.mimeType.startsWith("image/")) {
            inputContent.push({
              type: "image",
              assetId: saved.id,
              mimeType: saved.mimeType,
              detail: "auto",
            });
          } else {
            inputContent.push({
              type: "file",
              assetId: saved.id,
              mimeType: saved.mimeType,
              filename: saved.filename,
            });
          }
        }
        await composition.refreshContextWindowTokens();
        const result = await composition.agent.invoke({
          prompt: effectivePrompt,
          input: { text: effectivePrompt, content: inputContent },
          execution: {
            ...composition.runOptions(),
            sessionId: runSessionId,
            resume: true,
          },
        });
        if (result.sessionId) {
          setActiveSessionId(result.sessionId);
        }
        setStagedAttachments([]);
      } catch (error) {
        const message = error instanceof Error ? error.message : "unknown run failure";
        chatStore.appendSystemMessage(`Error: ${message}`);
      } finally {
        chatStore.setRunning(false);
        chatStore.setActiveRunSession(undefined);
      }
    },
    [
      composition,
      activeSessionId,
      chatStore,
      running,
      switchingSession,
      status,
      onExit,
      stagedAttachments,
    ],
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
      next.runtimeState.promptName = composition.runtimeState.promptName;
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
            columns={Math.max(20, terminalColumns - 10)}
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
        promptName={composition.runtimeState.promptName}
        provider={composition.runtimeState.provider}
        modelLabel={modelLabel}
        routingPreference={composition.runtimeState.routingPreference}
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

function ensureAttachmentSupport(provider: string, stagedAttachments: StagedAttachment[]): void {
  if (stagedAttachments.length === 0) return;
  const fileAttachments = stagedAttachments.filter((entry) => !entry.mimeType.startsWith("image/"));
  if (fileAttachments.length === 0) return;
  if (provider === "anthropic") return;
  throw new Error(
    `Provider "${provider}" does not support non-image file attachments in the current configuration`,
  );
}

async function tryStageDroppedFiles(input: string): Promise<StagedAttachment[] | undefined> {
  const candidates = parseDroppedAttachmentPaths(input);
  if (candidates.length === 0) return undefined;
  const staged: StagedAttachment[] = [];
  for (const candidate of candidates) {
    try {
      staged.push(await stageAttachment(candidate));
    } catch {
      return undefined;
    }
  }
  return staged.length > 0 ? staged : undefined;
}
