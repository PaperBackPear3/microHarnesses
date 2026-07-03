export type ExecutionEventType =
  | "run.started"
  | "model.selected"
  | "model.completed"
  | "tool.allowed"
  | "tool.blocked"
  | "tool.killed"
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
