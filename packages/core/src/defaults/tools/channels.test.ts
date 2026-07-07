import assert from "node:assert/strict";
import test from "node:test";
import { ChannelRegistry } from "../../channels/registry";
import { createChannelTools } from "./channels";

test("channel_list returns registered adapters", async () => {
  const registry = new ChannelRegistry();
  registry.register({
    channelId: "email",
    description: "SMTP email",
    transport: "smtp",
    tags: ["outbound"],
    async send() {
      return {
        channelId: "email",
        accepted: true,
        status: "sent",
        deliveries: [],
      };
    },
  });
  const channelList = createChannelTools({ registry }).find((tool) => tool.name === "channel_list");
  assert.ok(channelList);
  const result = (await channelList.execute({})) as { total: number; channels: Array<{ channelId: string }> };
  assert.equal(result.total, 1);
  assert.equal(result.channels[0]?.channelId, "email");
});

test("channel_send forwards to adapter with parsed recipients", async () => {
  const registry = new ChannelRegistry();
  let capturedRecipients = 0;
  registry.register({
    channelId: "email",
    description: "SMTP email",
    transport: "smtp",
    async send(request) {
      capturedRecipients = request.recipients.length;
      return {
        channelId: "email",
        accepted: true,
        status: "queued",
        messageId: "m-1",
        deliveries: request.recipients.map((recipient) => ({
          recipientId: recipient.id,
          status: "queued",
        })),
      };
    },
  });
  const channelSend = createChannelTools({ registry }).find((tool) => tool.name === "channel_send");
  assert.ok(channelSend);
  const result = (await channelSend.execute({
    channel: "email",
    recipients: ["a@example.com", { id: "b", address: "b@example.com" }],
    subject: "hello",
    text: "world",
    priority: "high",
  })) as { status: string; deliveries: Array<{ recipientId: string }> };
  assert.equal(capturedRecipients, 2);
  assert.equal(result.status, "queued");
  assert.equal(result.deliveries.length, 2);
});

test("channel_send rejects invalid inputs", async () => {
  const registry = new ChannelRegistry();
  registry.register({
    channelId: "email",
    description: "SMTP email",
    transport: "smtp",
    async send() {
      return {
        channelId: "email",
        accepted: true,
        status: "sent",
        deliveries: [],
      };
    },
  });
  const channelSend = createChannelTools({ registry }).find((tool) => tool.name === "channel_send");
  assert.ok(channelSend);
  await assert.rejects(
    () =>
      channelSend.execute({
        channel: "email",
        recipients: [],
        text: "body",
      }),
    /recipients/,
  );
});
