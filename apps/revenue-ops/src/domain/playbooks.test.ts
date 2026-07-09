import assert from "node:assert/strict";
import test from "node:test";
import { collectionsPlaybook, retentionPlaybook } from "./playbooks.js";

test("retentionPlaybook adds approval-required action on high risk", () => {
  const actions = retentionPlaybook(72, "high", {
    ticketCount7d: 7,
    npsDelta: -20,
    usageDeltaPct: -15,
    renewalDaysLeft: 30,
  });

  assert.ok(actions.some((item) => item.channel === "email"));
  assert.ok(actions.some((item) => item.requiresApproval));
});

test("collectionsPlaybook adds escalation with mandatory approval at critical severity", () => {
  const actions = collectionsPlaybook(92, "critical", {
    daysPastDue: 75,
    amountDue: 24000,
    hasBrokenPromise: true,
    remindersSent: 4,
  });

  const escalation = actions.find((item) => item.title.toLowerCase().includes("escalation"));
  assert.ok(escalation);
  assert.equal(escalation?.requiresApproval, true);
});
