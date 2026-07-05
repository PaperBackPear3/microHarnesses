import type { RunState } from "../runtime/state";
import type { RunOptions } from "../runtime/types";

export interface ChannelRequest {
  input: string;
  runOptions: RunOptions;
  sessionId?: string;
  metadata?: Record<string, unknown>;
}

export interface ChannelResponse {
  state: RunState;
  finalMessage: string;
}

export interface ChannelContext {
  invoke(request: ChannelRequest): Promise<ChannelResponse>;
}

export interface ChannelDefinition {
  id: string;
  description: string;
  open?(): Promise<void> | void;
  close?(): Promise<void> | void;
  handle(request: ChannelRequest, context: ChannelContext): Promise<ChannelResponse>;
}
