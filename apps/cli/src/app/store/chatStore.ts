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
      this.upsertSubagent(eventSessionId, {
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
      this.state.subagents.some((entry) => entry.sessionId === eventSessionId)
    ) {
      if (event.type === "model.selected") {
        this.upsertSubagent(eventSessionId, {
          sessionId: eventSessionId,
          promptName: "subagent",
          status: "running",
          model: asString(event.payload.model),
          activity: "model selected",
        });
      } else if (event.type === "model.reasoning_delta") {
        this.upsertSubagent(eventSessionId, {
          sessionId: eventSessionId,
          promptName: "subagent",
          status: "running",
          activity: "reasoning",
        });
      } else if (event.type === "model.output_delta") {
        this.upsertSubagent(eventSessionId, {
          sessionId: eventSessionId,
          promptName: "subagent",
          status: "running",
          activity: "responding",
        });
      } else if (event.type === "tool.started") {
        const action = asString(event.payload.action) ?? "tool";
        this.upsertSubagent(eventSessionId, {
          sessionId: eventSessionId,
          promptName: "subagent",
          status: "running",
          activity: `tool: ${action}`,
        });
      } else if (event.type === "run.completed") {
        const summary = asString(event.payload.summary);
        this.upsertSubagent(eventSessionId, {
          sessionId: eventSessionId,
          promptName: asString(event.payload.promptName) ?? "subagent",
          status: "completed",
          activity: "completed",
          summary,
        });
        if (summary && summary.length > 0) {
          this.appendSystemMessage(`subagent completed (${eventSessionId}): ${summary}`);
        } else {
          this.appendSystemMessage(`subagent completed (${eventSessionId}).`);
        }
      } else if (event.type === "run.failed") {
        this.upsertSubagent(eventSessionId, {
          sessionId: eventSessionId,
          promptName: asString(event.payload.promptName) ?? "subagent",
          status: "failed",
          activity: asString(event.payload.reason) ?? "failed",
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
      const text =
        action === "wait_subagents" ? "waiting for subagent result..." : `tool started: ${action}`;
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
          promptName: next.promptName === "subagent" ? existing.promptName : next.promptName,
        }
      : next;
    const without = this.state.subagents.filter((entry) => entry.sessionId !== sessionId);
    const updated = [merged, ...without].slice(0, 24);
    this.setState({ ...this.state, subagents: updated });
  }
}
