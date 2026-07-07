import type { StreamEvent } from "@micro-harnesses/core";

export interface StatusState {
  model?: string;
  tokensIn: number;
  tokensOut: number;
  turns: number;
  errors: number;
  limitHits: number;
  compressing: boolean;
  contextUsedTokens?: number;
  contextMaxTokens?: number;
  contextUtilization?: number;
  contextEstimator?: string;
}

export function createStatusState(): StatusState {
  return {
    tokensIn: 0,
    tokensOut: 0,
    turns: 0,
    errors: 0,
    limitHits: 0,
    compressing: false,
  };
}

export function reduceStatus(state: StatusState, event: StreamEvent): StatusState {
  if (event.type === "model.selected") {
    return { ...state, model: asString(event.payload.model) };
  }
  if (event.type === "model.usage") {
    const usage = event.payload.usage as
      | { inputTokens?: number; outputTokens?: number }
      | undefined;
    return {
      ...state,
      tokensIn: state.tokensIn + (usage?.inputTokens ?? 0),
      tokensOut: state.tokensOut + (usage?.outputTokens ?? 0),
    };
  }
  if (event.type === "context.window") {
    return {
      ...state,
      contextUsedTokens: asNumber(event.payload.usedTokens),
      contextMaxTokens: asNumber(event.payload.maxTokens),
      contextUtilization: asNumber(event.payload.utilization),
      contextEstimator: asString(event.payload.estimator),
    };
  }
  if (event.type === "run.completed") {
    return { ...state, turns: state.turns + (asNumber(event.payload.turns) ?? 0) };
  }
  if (event.type === "context.compression_started") {
    return { ...state, compressing: true };
  }
  if (event.type === "context.compression_completed") {
    return { ...state, compressing: false };
  }
  if (event.type === "limit.reached") {
    return { ...state, errors: state.errors + 1, limitHits: state.limitHits + 1 };
  }
  if (event.type === "tool.blocked" || event.type === "run.failed") {
    return { ...state, errors: state.errors + 1 };
  }
  return state;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}
