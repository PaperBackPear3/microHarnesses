export { asNumber } from "../shared/values.js";

export interface ChatStep {
  id: string;
  iteration?: number;
  thinkingText: string;
  assistantText: string;
  systemMessages: Array<{ id: string; text: string }>;
  thinkingCollapsed: boolean;
}

export interface ChatTurn {
  id: string;
  userText: string;
  steps: ChatStep[];
}

export interface ChatEntry {
  id: string;
  type: "system" | "turn";
  text?: string;
  turn?: ChatTurn;
}

export type IdFactory = () => string;
export type StepUpdater = (step: ChatStep) => ChatStep;

export function appendSystemEntry(entries: ChatEntry[], id: string, text: string): ChatEntry[] {
  return [...entries, { id, type: "system", text }];
}

export function startUserTurn(entries: ChatEntry[], id: string, userText: string): ChatEntry[] {
  return [
    ...entries,
    {
      id,
      type: "turn",
      turn: {
        id,
        userText,
        steps: [],
      },
    },
  ];
}

export function appendThinkingDelta(
  entries: ChatEntry[],
  activeTurnId: string | undefined,
  iteration: number | undefined,
  createId: IdFactory,
  delta: string,
): { entries: ChatEntry[]; activeTurnId?: string } {
  if (delta.length === 0) return { entries, activeTurnId };
  const ensured = ensureActiveTurn(entries, activeTurnId, createId);
  return {
    activeTurnId: ensured.activeTurnId,
    entries: updateActiveStep(
      ensured.entries,
      ensured.activeTurnId,
      iteration,
      createId,
      (step) => ({
        ...step,
        thinkingText: `${step.thinkingText}${delta}`,
      }),
    ),
  };
}

export function appendAssistantDelta(
  entries: ChatEntry[],
  activeTurnId: string | undefined,
  iteration: number | undefined,
  createId: IdFactory,
  delta: string,
): { entries: ChatEntry[]; activeTurnId?: string } {
  if (delta.length === 0) return { entries, activeTurnId };
  const ensured = ensureActiveTurn(entries, activeTurnId, createId);
  return {
    activeTurnId: ensured.activeTurnId,
    entries: updateActiveStep(
      ensured.entries,
      ensured.activeTurnId,
      iteration,
      createId,
      (step) => ({
        ...step,
        assistantText: `${step.assistantText}${delta}`,
      }),
    ),
  };
}

export function appendStepSystemMessage(
  entries: ChatEntry[],
  activeTurnId: string | undefined,
  iteration: number | undefined,
  createId: IdFactory,
  text: string,
): ChatEntry[] {
  if (!activeTurnId) {
    return appendSystemEntry(entries, createId(), text);
  }
  return updateActiveStep(entries, activeTurnId, iteration, createId, (step) => ({
    ...step,
    systemMessages: [...step.systemMessages, { id: createId(), text }],
  }));
}

export function updateActiveStep(
  entries: ChatEntry[],
  activeTurnId: string,
  iteration: number | undefined,
  createId: IdFactory,
  update: StepUpdater,
): ChatEntry[] {
  return entries.map((entry) => {
    if (entry.type !== "turn" || !entry.turn || entry.turn.id !== activeTurnId) return entry;
    const stepIndex = findStepIndex(entry.turn.steps, iteration);
    const steps = entry.turn.steps.slice();
    const target =
      stepIndex >= 0
        ? steps[stepIndex]
        : {
            id: createId(),
            iteration,
            thinkingText: "",
            assistantText: "",
            systemMessages: [],
            thinkingCollapsed: false,
          };
    const updated = update(target);
    if (stepIndex >= 0) {
      steps[stepIndex] = updated;
    } else {
      steps.push(updated);
    }
    return {
      ...entry,
      turn: {
        ...entry.turn,
        steps,
      },
    };
  });
}

export function findStepIndex(steps: ChatStep[], iteration: number | undefined): number {
  if (typeof iteration === "number") {
    return steps.findIndex((step) => step.iteration === iteration);
  }
  return steps.length - 1;
}

export function formatIteration(iteration: number | undefined): string {
  return typeof iteration === "number" && iteration > 1 ? ` ${iteration}` : "";
}

function ensureActiveTurn(
  entries: ChatEntry[],
  activeTurnId: string | undefined,
  createId: IdFactory,
): { entries: ChatEntry[]; activeTurnId: string } {
  if (activeTurnId) return { entries, activeTurnId };
  const id = createId();
  return { activeTurnId: id, entries: startUserTurn(entries, id, "") };
}
