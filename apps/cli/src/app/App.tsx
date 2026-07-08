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
import { copyToClipboard } from "./clipboard.js";
import { Composer, estimateComposerRows } from "./components/Composer.js";
import { FooterStatusBar } from "./components/FooterStatusBar.js";
import { HelpScreen, Screen } from "./components/Screens.js";
import { disableKeyboardEnhancements, enableKeyboardEnhancements } from "./keyboardEnhancements.js";
import { containsTerminalMouseSequence, parseMouseWheelDelta } from "./mouseSequences.js";
import { handleSlashCommand } from "./slashController.js";
import { ChatStore } from "./store/chatStore.js";
import { useChatStore } from "./store/useChatStore.js";
import type { ChatEntry } from "./transcript.js";
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

export interface LayoutRowBudget {
  viewportHeight: number;
  contentRows: number;
  transcriptRows: number;
  footerRows: number;
  controlRows: number;
}

const COMPOSER_BOX_ROWS = 2;
const COMPOSER_MARGIN_ROWS = 1;
const FOOTER_EXPANDED_ROWS = 6;
const FOOTER_COMPACT_ROWS = 2;

export function computeLayoutRowBudget(
  viewportRows: number,
  composerRows: number,
): LayoutRowBudget {
  const viewportHeight = Math.max(1, Math.floor(viewportRows));
  const requestedComposerRows = Math.max(1, composerRows);
  const minControlRows = COMPOSER_BOX_ROWS + COMPOSER_MARGIN_ROWS + FOOTER_COMPACT_ROWS;
  const availableComposerRows = Math.max(1, viewportHeight - minControlRows - 1);
  const boundedComposerRows = Math.min(requestedComposerRows, availableComposerRows);

  const expandedControlRows =
    boundedComposerRows + COMPOSER_BOX_ROWS + COMPOSER_MARGIN_ROWS + FOOTER_EXPANDED_ROWS;
  const footerRows =
    expandedControlRows < viewportHeight ? FOOTER_EXPANDED_ROWS : FOOTER_COMPACT_ROWS;
  const controlRows = boundedComposerRows + COMPOSER_BOX_ROWS + COMPOSER_MARGIN_ROWS + footerRows;
  const contentRows = Math.max(1, viewportHeight - controlRows);
  const transcriptRows = Math.max(1, contentRows - 2);

  return { viewportHeight, contentRows, transcriptRows, footerRows, controlRows };
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

  useEffect(() => {
    enableKeyboardEnhancements();
    return () => {
      disableKeyboardEnhancements();
    };
  }, []);

  const mode = composition.modeController.getMode();
  const modeStyle = modePromptStyle(mode);
  const contextStyle = contextBadgeStyle(status);
  const modelLabel = modelBadgeLabel(composition.runtimeState.model ?? status.model);
  const shortcutHint = compactShortcutHintLine();
  const terminalColumns = Math.max(process.stdout.columns ?? 120, 40);
  const transcriptWidth = Math.max(28, terminalColumns - 10);
  const composerColumns = Math.max(20, terminalColumns - (running ? 28 : 18));
  const modelChoices = useMemo(
    () => availableModelChoices(composition.runtimeState.provider),
    [composition.runtimeState.provider],
  );

  const viewportHeight = process.stdout.rows ?? 24;
  const composerRows = estimateComposerRows(input, composerColumns);
  const { contentRows, transcriptRows, footerRows } = computeLayoutRowBudget(
    viewportHeight,
    composerRows,
  );

  const chatLines = useMemo(
    () =>
      buildChatLines(chatEntries, subagents, status.compressing, pendingApproval, transcriptWidth, {
        diagnosticsExpanded,
        thinkingExpanded,
      }),
    [
      chatEntries,
      subagents,
      status.compressing,
      pendingApproval,
      transcriptWidth,
      diagnosticsExpanded,
      thinkingExpanded,
    ],
  );
  const transcriptViewport = useMemo(
    () => sliceFromBottom(chatLines, transcriptRows, chatScrollOffset),
    [chatLines, transcriptRows, chatScrollOffset],
  );

  useEffect(() => {
    if (chatScrollOffset > transcriptViewport.maxOffset) {
      setChatScrollOffset(transcriptViewport.maxOffset);
    }
  }, [chatScrollOffset, transcriptViewport.maxOffset]);

  useInput((raw, key) => {
    if (containsTerminalMouseSequence(raw)) {
      const wheel = parseMouseWheelDelta(raw);
      if (wheel !== 0 && screen === "chat" && !pendingApproval) {
        setChatScrollOffset((offset) => Math.max(0, offset + wheel));
      }
      return;
    }

    const canScrollTranscript = screen === "chat" && input.length === 0 && !pendingApproval;
    if (canScrollTranscript) {
      const pageStep = Math.max(1, Math.floor(transcriptRows * 0.8));
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
        if (slash.type === "invalid-copy-scope") {
          chatStore.appendSystemMessage(
            `Unknown copy scope "${slash.value}". Use /copy [last|visible|all].`,
          );
          setInput("");
          return;
        }
        if (slash.type === "copy-transcript") {
          const payload = buildCopyPayload(
            slash.scope,
            chatEntries,
            subagents,
            chatLines,
            transcriptViewport.visible,
          );
          if (!payload) {
            chatStore.appendSystemMessage("Nothing available to copy.");
          } else {
            copyToClipboard(payload);
            chatStore.appendSystemMessage(
              `Copied ${slash.scope === "last" ? "last response" : `${slash.scope} transcript`} to clipboard.`,
            );
          }
          setInput("");
          return;
        }
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
      chatEntries,
      subagents,
      chatLines,
      transcriptViewport.visible,
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
      <Box
        flexDirection="column"
        height={contentRows}
        borderStyle="round"
        borderColor="gray"
        backgroundColor="black"
        paddingX={1}
      >
        {screen === "chat" ? (
          <Box flexDirection="row" height={transcriptRows}>
            <Box flexDirection="column" flexGrow={1}>
              {transcriptViewport.visible.map((line) => (
                <Text key={line.id}>
                  <Text color={line.indicatorColor}>{line.indicator}</Text>
                  <Text color={line.textColor ?? "whiteBright"}>{line.text}</Text>
                </Text>
              ))}
            </Box>
            <Box flexDirection="column" width={1} marginLeft={1}>
              {buildScrollbarRail(
                Math.max(1, transcriptViewport.visible.length),
                transcriptViewport.offset,
                transcriptViewport.maxOffset,
              ).map((entry) => (
                <Text key={entry.id} color={entry.color}>
                  {entry.char}
                </Text>
              ))}
            </Box>
          </Box>
        ) : null}

        {screen === "sessions" && <Screen title="Sessions">{screenContent}</Screen>}
        {screen === "session-details" && <Screen title="Session Details">{screenContent}</Screen>}
        {screen === "context" && <Screen title="Context Window">{screenContent}</Screen>}
        {screen === "telemetry" && <Screen title="Telemetry">{screenContent}</Screen>}
        {screen === "help" && (
          <HelpScreen modelChoices={modelChoices} cliVersion={composition.cliVersion} />
        )}
      </Box>

      <Box flexDirection="column" marginTop={1}>
        {stagedAttachments.length > 0 ? (
          <Box flexWrap="wrap" marginBottom={1}>
            {stagedAttachments.map((file, index) => (
              <Text key={`attach-chip-${file.path}`} color="black" backgroundColor="cyan">
                {" "}
                {index + 1}:{file.filename}{" "}
              </Text>
            ))}
          </Box>
        ) : null}
        <Box borderStyle="round" borderColor={modeStyle.color} backgroundColor="black" paddingX={1}>
          <Text color={modeStyle.color}>▍</Text>
          <Box marginLeft={1} flexGrow={1}>
            {pendingApproval ? (
              <Text color="yellow">awaiting approval (y/n/a)</Text>
            ) : (
              <Composer
                value={input}
                onChange={setInput}
                onSubmit={submit}
                disabled={switchingSession}
                columns={composerColumns}
              />
            )}
          </Box>
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
        compact={footerRows === FOOTER_COMPACT_ROWS}
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

export function buildScrollbarRail(
  rows: number,
  offset: number,
  maxOffset: number,
): Array<{
  id: string;
  char: string;
  color: "gray" | "cyan";
}> {
  const safeRows = Math.max(1, rows);
  if (maxOffset <= 0) {
    return Array.from({ length: safeRows }, (_, index) => ({
      id: `scrollbar-${index}`,
      char: "│",
      color: "gray" as const,
    }));
  }
  const thumbSize = Math.max(1, Math.floor((safeRows * safeRows) / (safeRows + maxOffset)));
  const travel = Math.max(0, safeRows - thumbSize);
  const ratio = maxOffset > 0 ? (maxOffset - offset) / maxOffset : 0;
  const start = Math.max(0, Math.min(travel, Math.round(travel * ratio)));
  return Array.from({ length: safeRows }, (_, index) => {
    const active = index >= start && index < start + thumbSize;
    return {
      id: `scrollbar-${index}`,
      char: active ? "█" : "│",
      color: active ? ("cyan" as const) : ("gray" as const),
    };
  });
}

export function buildCopyPayload(
  scope: "last" | "visible" | "all",
  entries: ChatEntry[],
  subagents: Array<{ outputText?: string }>,
  allLines: Array<{ indicator: string; text: string }>,
  visibleLines: Array<{ indicator: string; text: string }>,
): string | undefined {
  if (scope === "visible") {
    const text = visibleLines
      .map((line) => `${line.indicator}${line.text}`)
      .join("\n")
      .trim();
    return text.length > 0 ? text : undefined;
  }
  if (scope === "all") {
    const text = allLines
      .map((line) => `${line.indicator}${line.text}`)
      .join("\n")
      .trim();
    return text.length > 0 ? text : undefined;
  }
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i];
    if (!entry || !entry.turn) continue;
    for (let j = entry.turn.steps.length - 1; j >= 0; j -= 1) {
      const step = entry.turn.steps[j];
      if (step?.assistantText?.trim()) return step.assistantText.trim();
    }
  }
  for (let i = subagents.length - 1; i >= 0; i -= 1) {
    const outputText = subagents[i]?.outputText?.trim();
    if (outputText) return outputText;
  }
  for (let i = allLines.length - 1; i >= 0; i -= 1) {
    const line = allLines[i];
    const text = line?.text?.trim();
    if (!text) continue;
    if (line.indicator === "∙ " || line.indicator === "❯ " || line.indicator === "◌ ") continue;
    if (
      text.startsWith("persona=") ||
      text.startsWith("tools:") ||
      text.startsWith("thinking [") ||
      text === "output:" ||
      text.startsWith("summary:") ||
      text.startsWith("error:")
    ) {
      continue;
    }
    return text;
  }
  return undefined;
}
