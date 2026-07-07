import assert from "node:assert/strict";
import test from "node:test";
import { DuplicateChannelError, UnknownChannelError } from "../shared/errors";
import { ChannelRegistry } from "./registry";
import type { ChannelAdapter } from "./types";

const adapter = (channelId: string): ChannelAdapter => ({
  channelId,
  description: `${channelId} adapter`,
  transport: "test",
  async send() {
    return {
      channelId,
      accepted: true,
      status: "sent",
      deliveries: [],
    };
  },
});

test("registers and retrieves channel adapters", () => {
  const registry = new ChannelRegistry();
  registry.register(adapter("email"));
  assert.equal(registry.get("email").channelId, "email");
  assert.equal(registry.has("email"), true);
});

test("throws DuplicateChannelError on duplicate registration", () => {
  const registry = new ChannelRegistry();
  registry.register(adapter("email"));
  assert.throws(() => registry.register(adapter("email")), DuplicateChannelError);
});

test("throws UnknownChannelError when missing", () => {
  const registry = new ChannelRegistry();
  assert.throws(() => registry.get("missing"), UnknownChannelError);
});

test("catalog filters by transport and tags", () => {
  const registry = new ChannelRegistry();
  registry.register({
    ...adapter("email"),
    transport: "smtp",
    tags: ["outbound"],
    capabilities: ["attachments"],
  });
  registry.register({
    ...adapter("webhook"),
    transport: "http",
    tags: ["integration"],
  });

  const smtp = registry.catalog({ transport: "smtp" });
  assert.equal(smtp.length, 1);
  assert.equal(smtp[0]?.channelId, "email");

  const outbound = registry.catalog({ tag: "outbound" });
  assert.equal(outbound.length, 1);
  assert.equal(outbound[0]?.channelId, "email");
});
