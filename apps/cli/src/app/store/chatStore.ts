import { randomUUID } from "node:crypto";
import type { StreamEvent } from "@micro-harnesses/core";
import type { ApprovalView } from "../../runtime/approvalHandler.js";
import type { ApprovalController } from "../../runtime/approvalHandler.js";
import { asString } from "../../shared/values.js";
import type { UiStream } from "../../streaming/uiStream.js";
import { type StatusState, createStatusState, reduceStatus } from "../../telemetry/status.js";
import type { SubagentStatus } from "../chatLines.js";
import {
  type ChatEntry,
  appendAssistantDelta,
  appendStepSystemMessage,
  appendSystemEntry,
  appendThinkingDelta,
  asNumber,
  startUserTurn,
} from "../transcript.js";

export interface ChatStateSnapshot {
  entries: ChatEntry[];
  status: StatusState;
  pendingApproval?: ApprovalView;
  subagents: SubagentStatus[];
  running: boolean;
}

export class ChatStore {
  private state: ChatStateSnapshot;
  private readonly listeners = new Set<() => void>();
  private readonly unsubscribeStream: () => void;
  private readonly unsubscribeApproval: () => void;
  private activeTurnId: string | undefined;
  private activeRunSessionId: string | undefined;
  private readonly pendingSubagentAnchors: Array<{
    turnId: string;
    iteration?: number;
    createdAt: number;
  }> = [];

  constructor(uiStream: UiStream, approvalController: ApprovalController, cliVersion: string) {
    this.state = {
      entries: appendSystemEntry([], randomUUID(), `micro-harness CLI v${cliVersion}`),
      status: createStatusState(),
      pendingApproval: approvalController.getPending(),
      subagents: [],
      running: false,
    };
    this.unsubscribeStream = uiStream.subscribe(({ streamEvent }) => {
      const includeInMainStatus = this.handleStreamEvent(streamEvent);
      if (!includeInMainStatus) return;
      this.setState({
        ...this.state,
        status: reduceStatus(this.state.status, streamEvent),
      });
    });
    this.unsubscribeApproval = approvalController.subscribe((pending) => {
      this.setState({
        ...this.state,
        pendingApproval: pending,
      });
    });
  }

  dispose(): void {
    this.unsubscribeStream();
    this.unsubscribeApproval();
    this.listeners.clear();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getSnapshot(): ChatStateSnapshot {
    return this.state;
  }

  setRunning(running: boolean): void {
    this.setState({ ...this.state, running });
  }

  setActiveRunSession(sessionId: string | undefined): void {
    this.activeRunSessionId = sessionId;
  }

  startTurn(userText: string): void {
    const turnId = randomUUID();
    this.activeTurnId = turnId;
    this.setState({
      ...this.state,
      entries: startUserTurn(this.state.entries, turnId, userText),
    });
  }

  appendSystemMessage(text: string): void {
    this.setState({
      ...this.state,
      entries: appendSystemEntry(this.state.entries, randomUUID(), text),
    });
  }

  clearChatEntries(): void {
    this.activeTurnId = undefined;
    this.setState({ ...this.state, entries: [] });
  }

  private setState(next: ChatStateSnapshot): void {
    this.state = next;
    for (const listener of this.listeners) {
      listener();
    }
  }

  private handleStreamEvent(event: StreamEvent): boolean {
    const eventSessionId = typeof event.sessionId === "string" ? event.sessionId : undefined;
    const payloadKind = typeof event.payload.kind === "string" ? event.payload.kind : undefined;
    const isSubagentStart =
      event.type === "run.started" && payloadKind === "subagent" && Boolean(eventSessionId);
    if (isSubagentStart && eventSessionId) {
      const anchor = this.pendingSubagentAnchors.shift();
      this.upsertSubagent(eventSessionId, {
        sessionId: eventSessionId,
        startedAt: anchor?.createdAt ?? Date.now(),
        name: asString(event.payload.displayName),
        promptName: asString(event.payload.promptName) ?? "subagent",
        goal: asString(event.payload.goal),
        anchorTurnId: anchor?.turnId,
        anchorIteration: anchor?.iteration,
        status: "running",
        activity: "starting",
        thinkingText: "",
        outputText: "",
        recentTools: [],
      });
      return false;
    }

    if (
      eventSessionId &&
      this.state.subagents.some((entry) => entry.sessionId === eventSessionId)
    ) {
      if (event.type === "model.selected") {
        this.upsertSubagent(eventSessionId, {
          sessionId: eventSessionId,
          status: "running",
          model: asString(event.payload.model),
          activity: "model selected",
        });
      } else if (event.type === "model.reasoning_delta") {
        const delta = asString(event.payload.delta) ?? "";
        const existing = this.getSubagent(eventSessionId);
        this.upsertSubagent(eventSessionId, {
          sessionId: eventSessionId,
          status: "running",
          activity: "reasoning",
          thinkingText: appendTrimmed(existing?.thinkingText ?? "", delta, 1200),
        });
      } else if (event.type === "model.output_delta") {
        const delta = asString(event.payload.delta) ?? "";
        const existing = this.getSubagent(eventSessionId);
        this.upsertSubagent(eventSessionId, {
          sessionId: eventSessionId,
          status: "running",
          activity: "responding",
          outputText: appendTrimmed(existing?.outputText ?? "", delta, 1200),
        });
      } else if (event.type === "tool.started") {
        const action = asString(event.payload.action) ?? "tool";
        const inputSummary = asString(event.payload.inputSummary);
        const existing = this.getSubagent(eventSessionId);
        this.upsertSubagent(eventSessionId, {
          sessionId: eventSessionId,
          status: "running",
          activity: `tool: ${action}`,
          recentTools: pushToolLog(
            existing?.recentTools ?? [],
            inputSummary ? `${action} started ${inputSummary}` : `${action} started`,
          ),
        });
      } else if (event.type === "tool.completed") {
        const action = asString(event.payload.action) ?? "tool";
        const ok = event.payload.ok === true;
        const outputTruncated = event.payload.outputTruncated === true;
        const outputArtifactCount = asNumber(event.payload.outputArtifactCount) ?? 0;
        const existing = this.getSubagent(eventSessionId);
        this.upsertSubagent(eventSessionId, {
          sessionId: eventSessionId,
          status: "running",
          activity: `tool: ${action}`,
          recentTools: pushToolLog(
            existing?.recentTools ?? [],
            `${action} ${ok ? "ok" : "error"}${
              outputTruncated
                ? outputArtifactCount > 0
                  ? ` (truncated; ${outputArtifactCount} artifact${outputArtifactCount === 1 ? "" : "s"})`
                  : " (truncated)"
                : ""
            }`,
          ),
        });
      } else if (event.type === "tool.blocked") {
        const action = asString(event.payload.action) ?? "tool";
        const reason = asString(event.payload.reason) ?? "blocked";
        const existing = this.getSubagent(eventSessionId);
        this.upsertSubagent(eventSessionId, {
          sessionId: eventSessionId,
          status: "running",
          activity: `tool blocked: ${action}`,
          recentTools: pushToolLog(existing?.recentTools ?? [], `${action} blocked (${reason})`),
        });
      } else if (event.type === "run.completed") {
        const summary = asString(event.payload.summary);
        this.upsertSubagent(eventSessionId, {
          sessionId: eventSessionId,
          name: asString(event.payload.displayName),
          promptName: asString(event.payload.promptName) ?? "subagent",
          status: "completed",
          activity: "completed",
          summary,
        });
      } else if (event.type === "run.failed") {
        const reason = asString(event.payload.reason) ?? "failed";
        this.upsertSubagent(eventSessionId, {
          sessionId: eventSessionId,
          name: asString(event.payload.displayName),
          promptName: asString(event.payload.promptName) ?? "subagent",
          status: "failed",
          activity: reason,
          error: reason,
        });
      }
      return false;
    }

    if (this.activeRunSessionId && eventSessionId && eventSessionId !== this.activeRunSessionId) {
      return false;
    }

    if (event.type === "model.reasoning_delta") {
      const next = appendThinkingDelta(
        this.state.entries,
        this.activeTurnId,
        asNumber(event.payload.iteration),
        randomUUID,
        String(event.payload.delta ?? ""),
      );
      this.activeTurnId = next.activeTurnId;
      this.setState({ ...this.state, entries: next.entries });
      return true;
    }
    if (event.type === "model.output_delta") {
      const next = appendAssistantDelta(
        this.state.entries,
        this.activeTurnId,
        asNumber(event.payload.iteration),
        randomUUID,
        String(event.payload.delta ?? ""),
      );
      this.activeTurnId = next.activeTurnId;
      this.setState({ ...this.state, entries: next.entries });
      return true;
    }
    if (event.type === "tool.started") {
      const action = String(event.payload.action ?? "unknown_tool");
      const inputSummary = asString(event.payload.inputSummary);
      if (action === "spawn_subagent" && this.activeTurnId) {
        this.pendingSubagentAnchors.push({
          turnId: this.activeTurnId,
          iteration: asNumber(event.payload.iteration),
          createdAt: Date.now(),
        });
      }
      const text =
        action === "wait_subagents"
          ? "waiting for subagent result..."
          : inputSummary && inputSummary.length > 0
            ? `tool started: ${action} ${inputSummary}`
            : `tool started: ${action}`;
      this.setState({
        ...this.state,
        entries: appendStepSystemMessage(
          this.state.entries,
          this.activeTurnId,
          asNumber(event.payload.iteration),
          randomUUID,
          text,
        ),
      });
      return true;
    }
    if (event.type === "tool.blocked") {
      const action = String(event.payload.action ?? "unknown_tool");
      const reason = String(event.payload.reason ?? "blocked");
      this.setState({
        ...this.state,
        entries: appendStepSystemMessage(
          this.state.entries,
          this.activeTurnId,
          asNumber(event.payload.iteration),
          randomUUID,
          `tool blocked: ${action} (${reason})`,
        ),
      });
      return true;
    }
    if (event.type === "limit.reached") {
      const action = String(event.payload.action ?? "unknown");
      const limit = Number(event.payload.limit ?? 0);
      this.setState({
        ...this.state,
        entries: appendStepSystemMessage(
          this.state.entries,
          this.activeTurnId,
          asNumber(event.payload.iteration),
          randomUUID,
          `limit reached: ${action} (${limit})`,
        ),
      });
      return true;
    }
    if (event.type === "run.failed") {
      this.appendSystemMessage(String(event.payload.reason ?? "run failed"));
      return true;
    }
    return true;
  }

  private upsertSubagent(sessionId: string, next: SubagentStatus): void {
    const existing = this.state.subagents.find((entry) => entry.sessionId === sessionId);
    const merged: SubagentStatus = existing
      ? {
          ...existing,
          ...next,
        }
      : next;
    const without = this.state.subagents.filter((entry) => entry.sessionId !== sessionId);
    const updated = [merged, ...without].slice(0, 24);
    this.setState({ ...this.state, subagents: updated });
  }

  private getSubagent(sessionId: string): SubagentStatus | undefined {
    return this.state.subagents.find((entry) => entry.sessionId === sessionId);
  }
}

function appendTrimmed(current: string, delta: string, maxLen: number): string {
  if (delta.length === 0) return current;
  const combined = `${current}${delta}`;
  if (combined.length <= maxLen) return combined;
  return combined.slice(combined.length - maxLen);
}

function pushToolLog(current: string[], entry: string): string[] {
  if (entry.length === 0) return current;
  return [...current, entry].slice(-5);
}
