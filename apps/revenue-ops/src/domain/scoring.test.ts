import assert from "node:assert/strict";
import test from "node:test";
import { priorityFromScore, scoreCollections, scoreRetention } from "./scoring.js";

test("scoreRetention increases with worsening signals", () => {
  const low = scoreRetention({
    ticketCount7d: 1,
    npsDelta: 2,
    usageDeltaPct: 5,
    renewalDaysLeft: 120,
  });
  const high = scoreRetention({
    ticketCount7d: 9,
    npsDelta: -25,
    usageDeltaPct: -30,
    renewalDaysLeft: 12,
  });

  assert.ok(high > low);
  assert.equal(priorityFromScore(high), "critical");
});

test("scoreCollections marks broken promise as higher risk", () => {
  const baseline = scoreCollections({
    daysPastDue: 20,
    amountDue: 3000,
    hasBrokenPromise: false,
    remindersSent: 1,
  });
  const escalated = scoreCollections({
    daysPastDue: 20,
    amountDue: 3000,
    hasBrokenPromise: true,
    remindersSent: 1,
  });

  assert.ok(escalated > baseline);
});
