export type ExecutionEventType =
  | "run.started"
  | "model.selected"
  | "model.completed"
  | "tool.allowed"
  | "tool.blocked"
  | "tool.killed"
  | "tool.approval_requested"
  | "tool.approval_approved"
  | "tool.approval_denied"
  | "run.limit_reached"
  | "run.completed";

export interface ExecutionEvent {
  type: ExecutionEventType;
  timestamp: string;
  runId: string;
  payload: Record<string, unknown>;
}

export interface EventSink {
  push(event: ExecutionEvent): Promise<void>;
}
