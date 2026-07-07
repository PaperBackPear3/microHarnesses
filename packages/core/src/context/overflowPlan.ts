import type { Turn } from "../runtime/state";

export interface OverflowPlan {
  triggerOverflow: number;
  targetOverflow: number;
  overflowByTurnLimit: number;
  overflowByTokenUsage: number;
  trigger: "none" | "turns" | "tokens" | "both";
}

export interface OverflowPlanOptions {
  maxWorkingTurns: number;
  turnCompactionTargetRatio: number;
  compressionTriggerUtilization: number;
  compressionTargetUtilization: number;
  contextWindowTokens: number;
  nonTurnTokenReserve: number;
}

export function computeOverflowPlan(
  turns: Turn[],
  options: OverflowPlanOptions,
  computeTokenOverflowNeeded: (turns: Turn[], budget: number) => number,
): OverflowPlan {
  const turnTriggerOverflow = Math.max(0, turns.length - options.maxWorkingTurns);
  const turnTargetTurns = Math.max(
    1,
    Math.floor(options.maxWorkingTurns * options.turnCompactionTargetRatio),
  );
  const turnTargetOverflow = Math.max(0, turns.length - turnTargetTurns);

  const triggerEnabled =
    options.compressionTriggerUtilization < 1 &&
    options.contextWindowTokens > 0 &&
    turns.length > 1;
  let tokenTriggerOverflow = 0;
  let tokenTargetOverflow = 0;
  if (triggerEnabled) {
    const triggerBudget = Math.max(
      1,
      Math.floor(options.contextWindowTokens * options.compressionTriggerUtilization) -
        options.nonTurnTokenReserve,
    );
    const targetBudget = Math.max(
      1,
      Math.floor(options.contextWindowTokens * options.compressionTargetUtilization) -
        options.nonTurnTokenReserve,
    );
    tokenTriggerOverflow = computeTokenOverflowNeeded(turns, triggerBudget);
    tokenTargetOverflow = computeTokenOverflowNeeded(turns, targetBudget);
  }

  const triggerOverflow = Math.max(turnTriggerOverflow, tokenTriggerOverflow);
  const targetOverflow = Math.max(triggerOverflow, turnTargetOverflow, tokenTargetOverflow);
  const maxOverflow = Math.max(0, turns.length - 1);

  const trigger: OverflowPlan["trigger"] =
    turnTriggerOverflow > 0 && tokenTriggerOverflow > 0
      ? "both"
      : turnTriggerOverflow > 0
        ? "turns"
        : tokenTriggerOverflow > 0
          ? "tokens"
          : "none";

  return {
    triggerOverflow: Math.min(Math.max(0, triggerOverflow), maxOverflow),
    targetOverflow: Math.min(Math.max(0, targetOverflow), maxOverflow),
    overflowByTurnLimit: turnTriggerOverflow,
    overflowByTokenUsage: tokenTriggerOverflow,
    trigger,
  };
}
