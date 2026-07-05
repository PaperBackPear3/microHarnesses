import type { HarnessState } from "../context/types";
import type { RunOptions } from "../runtime/types";

export interface ChannelRequest {
  agentName: string;
  input: string;
  runOptions: RunOptions;
  sessionId?: string;
  metadata?: Record<string, unknown>;
}

export interface ChannelResponse {
  state: HarnessState;
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
