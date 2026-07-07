import { readOptionalBoolean, readOptionalString, readRequiredString } from "../../shared/inputParsing";
import { truncate } from "../../shared/text";
import type { ToolDefinition } from "../../tools/types";
import type { ChannelRecipient, ChannelSendRequest } from "../../channels/types";
import type { ChannelRegistry } from "../../channels/registry";

export interface ChannelToolsOptions {
  registry: ChannelRegistry;
  maxRecipients?: number;
  maxBodyChars?: number;
  maxSubjectChars?: number;
}

interface ResolvedChannelToolsOptions {
  registry: ChannelRegistry;
  maxRecipients: number;
  maxBodyChars: number;
  maxSubjectChars: number;
}

export function createChannelTools(options: ChannelToolsOptions): ToolDefinition[] {
  const resolved = resolveOptions(options);
  return [createChannelListTool(resolved), createChannelSendTool(resolved)];
}

function resolveOptions(options: ChannelToolsOptions): ResolvedChannelToolsOptions {
  return {
    registry: options.registry,
    maxRecipients: options.maxRecipients ?? 50,
    maxBodyChars: options.maxBodyChars ?? 20_000,
    maxSubjectChars: options.maxSubjectChars ?? 300,
  };
}

function createChannelListTool(options: ResolvedChannelToolsOptions): ToolDefinition {
  return {
    name: "channel_list",
    description: "List registered communication channels and their capabilities.",
    risk: "low",
    tags: ["channels", "communication", "read-only"],
    capabilities: ["channels.read"],
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    async execute() {
      const channels = options.registry.list().map((channel) => ({
        channelId: channel.channelId,
        description: channel.description,
        transport: channel.transport,
        tags: [...(channel.tags ?? [])],
        capabilities: [...(channel.capabilities ?? [])],
      }));
      return {
        total: channels.length,
        channels,
      };
    },
  };
}

function createChannelSendTool(options: ResolvedChannelToolsOptions): ToolDefinition {
  return {
    name: "channel_send",
    description: "Send a message through a registered communication channel.",
    risk: "low",
    tags: ["channels", "communication"],
    capabilities: ["channels.send"],
    inputSchema: {
      type: "object",
      properties: {
        channel: { type: "string" },
        recipients: {
          type: "array",
          items: {
            oneOf: [
              { type: "string" },
              {
                type: "object",
                properties: {
                  id: { type: "string" },
                  display_name: { type: "string" },
                  address: { type: "string" },
                  metadata: { type: "object" },
                },
                required: ["id"],
                additionalProperties: false,
              },
            ],
          },
        },
        subject: { type: "string" },
        text: { type: "string" },
        html: { type: "string" },
        dry_run: { type: "boolean" },
        priority: { type: "string", enum: ["low", "normal", "high"] },
        idempotency_key: { type: "string" },
        metadata: { type: "object" },
      },
      required: ["channel", "recipients", "text"],
      additionalProperties: false,
    },
    async execute(input, context) {
      const channelId = readRequiredString(input, "channel", "channel_send");
      const recipients = parseRecipients(input.recipients, options.maxRecipients);
      const text = truncate(
        readRequiredString(input, "text", "channel_send"),
        options.maxBodyChars,
      );
      const subjectRaw = readOptionalString(input, "subject", "");
      const subject = subjectRaw.length > 0 ? truncate(subjectRaw, options.maxSubjectChars) : undefined;
      const htmlRaw = readOptionalString(input, "html", "");
      const html = htmlRaw.length > 0 ? truncate(htmlRaw, options.maxBodyChars) : undefined;
      const dryRun = readOptionalBoolean(input, "dry_run", false);
      const priority = readOptionalString(input, "priority", "normal");
      if (priority !== "low" && priority !== "normal" && priority !== "high") {
        throw new Error('channel_send: "priority" must be one of low|normal|high');
      }
      const idempotencyKey = readOptionalString(input, "idempotency_key", "");
      const rawMetadata = input.metadata;
      const metadata =
        rawMetadata && typeof rawMetadata === "object" && !Array.isArray(rawMetadata)
          ? (rawMetadata as Record<string, unknown>)
          : undefined;

      const request: ChannelSendRequest = {
        channelId,
        recipients,
        message: { subject, text, html, metadata },
        dryRun,
        priority,
        ...(idempotencyKey.length > 0 ? { idempotencyKey } : {}),
        ...(metadata ? { metadata } : {}),
      };

      const result = await options.registry.get(channelId).send(request, {
        signal: context?.signal ?? new AbortController().signal,
        runId: context?.runId,
        sessionId: context?.sessionId,
        traceContext: context?.traceContext,
      });
      return {
        channelId: result.channelId,
        accepted: result.accepted,
        status: result.status,
        messageId: result.messageId,
        deliveries: result.deliveries,
        metadata: result.metadata ?? {},
      };
    },
  };
}

function parseRecipients(value: unknown, maxRecipients: number): ChannelRecipient[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('channel_send: "recipients" must be a non-empty array');
  }
  if (value.length > maxRecipients) {
    throw new Error(`channel_send: at most ${maxRecipients} recipients are allowed`);
  }
  const recipients: ChannelRecipient[] = value.map((entry, index) => {
    if (typeof entry === "string") {
      const id = entry.trim();
      if (id.length === 0) {
        throw new Error(`channel_send: recipient[${index}] string must be non-empty`);
      }
      return { id, address: id };
    }
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`channel_send: recipient[${index}] must be a string or object`);
    }
    const record = entry as Record<string, unknown>;
    const idRaw = record.id;
    if (typeof idRaw !== "string" || idRaw.trim().length === 0) {
      throw new Error(`channel_send: recipient[${index}].id must be a non-empty string`);
    }
    const displayName = typeof record.display_name === "string" ? record.display_name : undefined;
    const address = typeof record.address === "string" ? record.address : undefined;
    const metadata =
      record.metadata && typeof record.metadata === "object" && !Array.isArray(record.metadata)
        ? (record.metadata as Record<string, unknown>)
        : undefined;
    return {
      id: idRaw,
      ...(displayName ? { displayName } : {}),
      ...(address ? { address } : {}),
      ...(metadata ? { metadata } : {}),
    };
  });
  return recipients;
}
