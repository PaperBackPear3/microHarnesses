import assert from "node:assert/strict";
import type { IncomingMessage } from "node:http";
import { Readable } from "node:stream";
import test from "node:test";
import { parseInboundEvent } from "./jsonEndpoint.js";

test("parseInboundEvent validates and normalizes payload", async () => {
  const req = Object.assign(
    Readable.from([
      Buffer.from(
        JSON.stringify({
          source: "crm",
          type: "renewal_update",
          occurredAt: "2026-07-09T10:00:00.000Z",
          accountId: "acc-123",
          payload: { renewalDaysLeft: 35 },
        }),
      ),
    ]),
    {
      method: "POST",
      headers: { "content-type": "application/json" },
    },
  ) as IncomingMessage;

  const parsed = await parseInboundEvent(req, 1024);
  assert.equal(parsed.source, "crm");
  assert.equal(parsed.accountId, "acc-123");
  assert.deepEqual(parsed.payload, { renewalDaysLeft: 35 });
});
