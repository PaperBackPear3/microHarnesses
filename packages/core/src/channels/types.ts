import type { TraceContext } from "../observability/types";

export type ChannelId = string;

export interface ChannelRecipient {
  id: string;
  displayName?: string;
  address?: string;
  metadata?: Record<string, unknown>;
}

export interface ChannelAttachment {
  name: string;
  mimeType?: string;
  content?: string;
  url?: string;
  sizeBytes?: number;
}

export interface ChannelMessage {
  subject?: string;
  text: string;
  html?: string;
  attachments?: ChannelAttachment[];
  metadata?: Record<string, unknown>;
}

export interface ChannelSendRequest {
  channelId: ChannelId;
  recipients: ChannelRecipient[];
  message: ChannelMessage;
  idempotencyKey?: string;
  priority?: "low" | "normal" | "high";
  dryRun?: boolean;
  metadata?: Record<string, unknown>;
}

export type ChannelDeliveryStatus = "sent" | "queued" | "failed" | "skipped";

export interface ChannelDeliveryResult {
  recipientId: string;
  status: ChannelDeliveryStatus;
  providerMessageId?: string;
  error?: string;
}

export type ChannelSendStatus = "sent" | "queued" | "partial" | "failed" | "dry_run";

export interface ChannelSendResult {
  channelId: ChannelId;
  accepted: boolean;
  status: ChannelSendStatus;
  messageId?: string;
  deliveries: ChannelDeliveryResult[];
  metadata?: Record<string, unknown>;
}

export interface ChannelSendContext {
  signal: AbortSignal;
  runId?: string;
  sessionId?: string;
  traceContext?: TraceContext;
}

export interface ChannelAdapter {
  channelId: ChannelId;
  description: string;
  transport: string;
  tags?: string[];
  capabilities?: string[];
  send(request: ChannelSendRequest, context?: ChannelSendContext): Promise<ChannelSendResult>;
}

export interface ChannelCatalogQuery {
  transport?: string;
  tag?: string;
  capability?: string;
}

export interface ChannelCatalogEntry {
  channelId: ChannelId;
  description: string;
  transport: string;
  tags: string[];
  capabilities: string[];
}
