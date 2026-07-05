export type ExecutionEventType =
  | "run.started"
  | "model.selected"
  | "model.thinking_started"
  | "model.reasoning_delta"
  | "model.delta"
  | "model.reasoning_stream_completed"
  | "model.stream_completed"
  | "model.thinking_completed"
  | "model.completed"
  | "action.allowed"
  | "action.blocked"
  | "action.killed"
  | "action.approval_requested"
  | "action.approval_approved"
  | "action.approval_denied"
  | "run.limit_reached"
  | "run.completed"
  | "run.failed";

export interface ExecutionEvent {
  type: ExecutionEventType;
  timestamp: string;
  runId: string;
  payload: Record<string, unknown>;
}

export interface EventSink {
  push(event: ExecutionEvent): Promise<void>;
}
