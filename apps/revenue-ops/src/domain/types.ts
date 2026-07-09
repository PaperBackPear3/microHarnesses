export type SourceSystem = "crm" | "billing" | "support" | "erp" | "payment_gateway";

export interface InboundEvent {
  source: SourceSystem;
  type: string;
  occurredAt: string;
  accountId?: string;
  debtorId?: string;
  payload: Record<string, unknown>;
}

export interface RetentionSignals {
  ticketCount7d: number;
  npsDelta: number;
  usageDeltaPct: number;
  renewalDaysLeft: number;
}

export interface CollectionsSignals {
  daysPastDue: number;
  amountDue: number;
  hasBrokenPromise: boolean;
  remindersSent: number;
}

export type CaseKind = "retention" | "collections";
export type CaseStatus = "open" | "pending_approval" | "closed";
export type Priority = "low" | "medium" | "high" | "critical";
export type OutboundChannel = "email" | "crm_task";

export interface ActionRecommendation {
  title: string;
  rationale: string;
  channel: OutboundChannel;
  requiresApproval: boolean;
}

export interface CaseOutcome {
  at: string;
  kind: "message_sent" | "payment_received" | "renewal_saved" | "renewal_lost" | "note";
  note: string;
  amount?: number;
}

export interface RevenueOpsCase {
  id: string;
  kind: CaseKind;
  entityId: string;
  score: number;
  priority: Priority;
  status: CaseStatus;
  signals: RetentionSignals | CollectionsSignals;
  recommendations: ActionRecommendation[];
  outcomes: CaseOutcome[];
  lastEventAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface RunResponse {
  case: RevenueOpsCase;
  assistantSummary: string;
}
