import type { Agent } from "@micro-harnesses/core";
import type { RevenueOpsConfig } from "../config.js";
import { collectionsPlaybook, retentionPlaybook } from "../domain/playbooks.js";
import { priorityFromScore, scoreCollections, scoreRetention } from "../domain/scoring.js";
import type {
  CollectionsSignals,
  InboundEvent,
  RetentionSignals,
  RevenueOpsCase,
  RunResponse,
} from "../domain/types.js";
import { JsonCaseStore } from "../store/caseStore.js";

interface RevenueOpsAgents {
  retentionAgent: Agent;
  collectionsAgent: Agent;
}

export class RevenueOpsService {
  private readonly store: JsonCaseStore;
  private readonly config: RevenueOpsConfig;
  private readonly agents: RevenueOpsAgents;

  constructor(store: JsonCaseStore, config: RevenueOpsConfig, agents: RevenueOpsAgents) {
    this.store = store;
    this.config = config;
    this.agents = agents;
  }

  async ingest(event: InboundEvent): Promise<RevenueOpsCase> {
    if (event.accountId) {
      return this.upsertRetentionCase(event.accountId, event);
    }
    if (event.debtorId) {
      return this.upsertCollectionsCase(event.debtorId, event);
    }
    throw new Error("Event must include accountId or debtorId");
  }

  async runRetention(accountId: string): Promise<RunResponse> {
    const existing = await this.store.findByKindEntity("retention", accountId);
    if (!existing) throw new Error(`Retention case not found for accountId=${accountId}`);

    const prompt = [
      "Sei un assistente di post-vendita e rinnovi proattivi.",
      "Dati caso:",
      JSON.stringify(existing, null, 2),
      "Genera un piano operativo sintetico in italiano, con priorità, rationale e prossima azione AM.",
      "Ribadisci che la negoziazione finale resta umana.",
    ].join("\n\n");

    const result = await this.agents.retentionAgent.invoke({
      prompt,
      input: { text: prompt },
      execution: {
        sessionId: `ret-${accountId}`,
        goal: `Retention run for ${accountId}`,
        maxIterations: 4,
        snapshotEvery: 1,
        profile: { defaultModel: this.config.model },
      },
    });

    return { case: existing, assistantSummary: result.summary };
  }

  async runCollections(debtorId: string): Promise<RunResponse> {
    const existing = await this.store.findByKindEntity("collections", debtorId);
    if (!existing) throw new Error(`Collections case not found for debtorId=${debtorId}`);

    const prompt = [
      "Sei un assistente collections per recupero crediti B2B.",
      "Dati caso:",
      JSON.stringify(existing, null, 2),
      "Produci solleciti e priorità operative; usa email + task CRM.",
      "Se è presente escalation alta severità, indica approvazione umana obbligatoria prima dell'invio.",
    ].join("\n\n");

    const result = await this.agents.collectionsAgent.invoke({
      prompt,
      input: { text: prompt },
      execution: {
        sessionId: `col-${debtorId}`,
        goal: `Collections run for ${debtorId}`,
        maxIterations: 4,
        snapshotEvery: 1,
        profile: { defaultModel: this.config.model },
      },
    });

    return { case: existing, assistantSummary: result.summary };
  }

  async getCase(id: string): Promise<RevenueOpsCase | undefined> {
    return this.store.get(id);
  }

  async kpis(): Promise<{
    retention: { openCases: number; atRiskHighOrCritical: number; pendingApproval: number };
    collections: { openCases: number; highOrCritical: number; pendingApproval: number };
  }> {
    const all = await this.store.list();
    const retention = all.filter((item) => item.kind === "retention" && item.status !== "closed");
    const collections = all.filter((item) => item.kind === "collections" && item.status !== "closed");
    return {
      retention: {
        openCases: retention.length,
        atRiskHighOrCritical: retention.filter(
          (item) => item.priority === "high" || item.priority === "critical",
        ).length,
        pendingApproval: retention.filter((item) => item.status === "pending_approval").length,
      },
      collections: {
        openCases: collections.length,
        highOrCritical: collections.filter(
          (item) => item.priority === "high" || item.priority === "critical",
        ).length,
        pendingApproval: collections.filter((item) => item.status === "pending_approval").length,
      },
    };
  }

  private async upsertRetentionCase(accountId: string, event: InboundEvent): Promise<RevenueOpsCase> {
    const current = await this.store.findByKindEntity("retention", accountId);
    const nextSignals = mergeRetentionSignals(
      current?.signals && isRetentionSignals(current.signals) ? current.signals : undefined,
      event,
    );
    const score = scoreRetention(nextSignals);
    const priority = priorityFromScore(score);
    const recommendations = retentionPlaybook(score, priority, nextSignals);
    const now = event.occurredAt;

    const next: RevenueOpsCase = {
      id: current?.id ?? `ret-${accountId}`,
      kind: "retention",
      entityId: accountId,
      score,
      priority,
      status: recommendations.some((item) => item.requiresApproval) ? "pending_approval" : "open",
      signals: nextSignals,
      recommendations,
      outcomes: current?.outcomes ?? [],
      lastEventAt: now,
      createdAt: current?.createdAt ?? now,
      updatedAt: now,
    };
    return this.store.upsert(next);
  }

  private async upsertCollectionsCase(debtorId: string, event: InboundEvent): Promise<RevenueOpsCase> {
    const current = await this.store.findByKindEntity("collections", debtorId);
    const nextSignals = mergeCollectionsSignals(
      current?.signals && isCollectionsSignals(current.signals) ? current.signals : undefined,
      event,
    );
    const score = scoreCollections(nextSignals);
    const priority = priorityFromScore(score);
    const recommendations = collectionsPlaybook(score, priority, nextSignals);
    const now = event.occurredAt;

    const next: RevenueOpsCase = {
      id: current?.id ?? `col-${debtorId}`,
      kind: "collections",
      entityId: debtorId,
      score,
      priority,
      status: recommendations.some((item) => item.requiresApproval) ? "pending_approval" : "open",
      signals: nextSignals,
      recommendations,
      outcomes: current?.outcomes ?? [],
      lastEventAt: now,
      createdAt: current?.createdAt ?? now,
      updatedAt: now,
    };
    return this.store.upsert(next);
  }
}

function mergeRetentionSignals(
  current: RetentionSignals | undefined,
  event: InboundEvent,
): RetentionSignals {
  const base: RetentionSignals = current ?? {
    ticketCount7d: 0,
    npsDelta: 0,
    usageDeltaPct: 0,
    renewalDaysLeft: 120,
  };
  return {
    ticketCount7d: numberOr(base.ticketCount7d, event.payload.ticketCount7d),
    npsDelta: numberOr(base.npsDelta, event.payload.npsDelta),
    usageDeltaPct: numberOr(base.usageDeltaPct, event.payload.usageDeltaPct),
    renewalDaysLeft: numberOr(base.renewalDaysLeft, event.payload.renewalDaysLeft),
  };
}

function mergeCollectionsSignals(
  current: CollectionsSignals | undefined,
  event: InboundEvent,
): CollectionsSignals {
  const base: CollectionsSignals = current ?? {
    daysPastDue: 0,
    amountDue: 0,
    hasBrokenPromise: false,
    remindersSent: 0,
  };
  return {
    daysPastDue: numberOr(base.daysPastDue, event.payload.daysPastDue),
    amountDue: numberOr(base.amountDue, event.payload.amountDue),
    hasBrokenPromise: booleanOr(base.hasBrokenPromise, event.payload.hasBrokenPromise),
    remindersSent: numberOr(base.remindersSent, event.payload.remindersSent),
  };
}

function numberOr(fallback: number, value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return fallback;
}

function booleanOr(fallback: boolean, value: unknown): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function isRetentionSignals(value: unknown): value is RetentionSignals {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.ticketCount7d === "number" &&
    typeof record.npsDelta === "number" &&
    typeof record.usageDeltaPct === "number" &&
    typeof record.renewalDaysLeft === "number"
  );
}

function isCollectionsSignals(value: unknown): value is CollectionsSignals {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.daysPastDue === "number" &&
    typeof record.amountDue === "number" &&
    typeof record.hasBrokenPromise === "boolean" &&
    typeof record.remindersSent === "number"
  );
}
