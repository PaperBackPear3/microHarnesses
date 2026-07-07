import type {
  ChannelAdapter,
  HarnessPlugin,
  PluginApi,
  PluginCapability,
} from "@micro-harnesses/core";

export interface ExampleWebhookChannelPluginOptions {
  channelId?: string;
  endpointUrl?: string;
}

export class ExampleWebhookChannelPlugin implements HarnessPlugin {
  readonly name = "example-webhook-channel-plugin";
  readonly capabilities: PluginCapability[] = ["channels"];
  private readonly channelId: string;
  private readonly endpointUrl?: string;

  constructor(options: ExampleWebhookChannelPluginOptions = {}) {
    this.channelId = options.channelId ?? "webhook";
    this.endpointUrl = options.endpointUrl;
  }

  register(api: PluginApi): void {
    const endpointUrl = this.endpointUrl ?? process.env.MH_EXAMPLE_WEBHOOK_URL;
    const adapter: ChannelAdapter = {
      channelId: this.channelId,
      description: "Reference webhook-backed outbound channel adapter.",
      transport: "http",
      tags: ["reference", "webhook"],
      capabilities: ["outbound.send"],
      async send(request, context) {
        if (request.dryRun) {
          return {
            channelId: request.channelId,
            accepted: true,
            status: "dry_run",
            deliveries: request.recipients.map((recipient) => ({
              recipientId: recipient.id,
              status: "skipped",
            })),
          };
        }
        if (!endpointUrl) {
          throw new Error(
            `channel "${request.channelId}" requires endpointUrl or MH_EXAMPLE_WEBHOOK_URL`,
          );
        }
        const response = await fetch(endpointUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            channelId: request.channelId,
            recipients: request.recipients,
            message: request.message,
            idempotencyKey: request.idempotencyKey,
            priority: request.priority ?? "normal",
            metadata: request.metadata ?? {},
          }),
          ...(context?.signal ? { signal: context.signal } : {}),
        });
        if (!response.ok) {
          throw new Error(
            `channel "${request.channelId}" webhook send failed: HTTP ${response.status}`,
          );
        }
        return {
          channelId: request.channelId,
          accepted: true,
          status: "sent",
          deliveries: request.recipients.map((recipient) => ({
            recipientId: recipient.id,
            status: "sent",
          })),
        };
      },
    };
    api.registerChannel(adapter);
  }
}

export const exampleWebhookChannelPlugin: HarnessPlugin = new ExampleWebhookChannelPlugin();
