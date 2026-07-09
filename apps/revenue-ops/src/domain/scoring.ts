import type { CollectionsSignals, Priority, RetentionSignals } from "./types.js";

export function scoreRetention(signals: RetentionSignals): number {
  const ticketScore = clamp(signals.ticketCount7d * 4, 0, 30);
  const npsScore = clamp(Math.max(0, -signals.npsDelta) * 2, 0, 25);
  const usageScore = clamp(Math.max(0, -signals.usageDeltaPct) * 1.5, 0, 25);
  const renewalScore = clamp((30 - signals.renewalDaysLeft) * 1.5, 0, 20);
  return clamp(Math.round(ticketScore + npsScore + usageScore + renewalScore), 0, 100);
}

export function scoreCollections(signals: CollectionsSignals): number {
  const agingScore = clamp(signals.daysPastDue * 0.8, 0, 35);
  const amountScore = clamp(signals.amountDue / 300, 0, 35);
  const promiseScore = signals.hasBrokenPromise ? 20 : 0;
  const reminderScore = clamp(signals.remindersSent * 3, 0, 10);
  return clamp(Math.round(agingScore + amountScore + promiseScore + reminderScore), 0, 100);
}

export function priorityFromScore(score: number): Priority {
  if (score >= 85) return "critical";
  if (score >= 65) return "high";
  if (score >= 40) return "medium";
  return "low";
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
