import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { CompressorFn, HarnessState, Turn } from "../types";

export interface ContextManagerOptions {
  stateDir: string;
  maxWorkingTurns: number;
  compressor?: CompressorFn;
  goal?: string;
}

interface CheckpointFile {
  id: string;
  createdAt: string;
  state: HarnessState;
}

interface SummaryState {
  compressedTurnCount: number;
}

export class ContextManager {
  private readonly stateDir: string;
  private readonly checkpointDir: string;
  private readonly summaryDir: string;
  private readonly summaryStatePath: string;
  private readonly maxWorkingTurns: number;
  private compressor: CompressorFn;
  private goal?: string;

  constructor(options: ContextManagerOptions) {
    this.stateDir = options.stateDir;
    this.checkpointDir = path.join(this.stateDir, "checkpoints");
    this.summaryDir = path.join(this.stateDir, "summaries");
    this.summaryStatePath = path.join(this.summaryDir, "state.json");
    this.maxWorkingTurns = options.maxWorkingTurns;
    this.compressor = options.compressor ?? defaultCompressor;
    this.goal = options.goal;
  }

  setCompressor(compressor: CompressorFn): void {
    this.compressor = compressor;
  }

  setGoal(goal: string): void {
    this.goal = goal;
  }

  async init(): Promise<void> {
    await mkdir(this.checkpointDir, { recursive: true });
    await mkdir(this.summaryDir, { recursive: true });
  }

  async buildWorkingTurns(turns: Turn[]): Promise<Turn[]> {
    if (turns.length <= this.maxWorkingTurns) {
      return turns;
    }

    const overflowCount = turns.length - this.maxWorkingTurns;
    const summaryState = await this.readSummaryState();
    const newOverflowCount = overflowCount - summaryState.compressedTurnCount;
    if (newOverflowCount > 0) {
      const delta = turns.slice(summaryState.compressedTurnCount, overflowCount);
      const compression = await this.compressor(delta, { goal: this.goal });
      const summaryFile = path.join(this.summaryDir, `summary-${randomUUID()}.json`);
      await writeFile(
        summaryFile,
        JSON.stringify(
          {
            goal: this.goal ?? "",
            summary: compression.summary,
            highlights: compression.highlights,
            support_history: compression.supportHistory,
            turns: delta.length,
            from: summaryState.compressedTurnCount
          },
          null,
          2
        ),
        "utf8"
      );
      await this.writeSummaryState({ compressedTurnCount: overflowCount });
    }

    return turns.slice(-this.maxWorkingTurns);
  }

  async saveCheckpoint(state: HarnessState): Promise<string> {
    const id = `cp-${randomUUID()}`;
    const data: CheckpointFile = {
      id,
      createdAt: new Date().toISOString(),
      state
    };
    const filePath = path.join(this.checkpointDir, `${id}.json`);
    await writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
    return id;
  }

  async loadCheckpoint(id: string): Promise<HarnessState> {
    const filePath = path.join(this.checkpointDir, `${id}.json`);
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as CheckpointFile;
    return parsed.state;
  }

  async discardCheckpoint(id: string): Promise<void> {
    const filePath = path.join(this.checkpointDir, `${id}.json`);
    await rm(filePath);
  }

  async listCheckpoints(): Promise<string[]> {
    const files = await readdir(this.checkpointDir);
    return files
      .filter((name) => name.endsWith(".json"))
      .map((name) => name.replace(".json", ""))
      .sort();
  }

  private async readSummaryState(): Promise<SummaryState> {
    try {
      const raw = await readFile(this.summaryStatePath, "utf8");
      const parsed = JSON.parse(raw) as SummaryState;
      return { compressedTurnCount: parsed.compressedTurnCount ?? 0 };
    } catch (error: unknown) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return { compressedTurnCount: 0 };
      }
      throw error;
    }
  }

  private async writeSummaryState(state: SummaryState): Promise<void> {
    await writeFile(this.summaryStatePath, JSON.stringify(state, null, 2), "utf8");
  }
}

async function defaultCompressor(turns: Turn[], context: { goal?: string }) {
  const goal = context.goal?.trim() || "No explicit goal set";
  const scored = turns
    .map((turn, index) => ({
      turn,
      score: computeTurnScore(turn, index, turns.length, goal)
    }))
    .sort((a, b) => b.score - a.score);

  const top = scored.slice(0, Math.min(5, scored.length)).map((entry) => entry.turn);
  const highlights = top.map(
    (turn) =>
      `iter=${turn.iteration} tools=${turn.toolCalls.length} assistant="${trim(turn.assistantMessage, 120)}"`
  );

  const supportHistory = turns.flatMap((turn) =>
    turn.toolResults
      .filter((result) => !result.ok)
      .map((result) => `iter=${turn.iteration} tool-failure: ${result.error ?? "unknown error"}`)
  );

  return {
    summary: `Goal: ${goal}. Retained ${highlights.length} high-priority highlights out of ${turns.length} compressed turns.`,
    highlights,
    supportHistory
  };
}

function computeTurnScore(turn: Turn, index: number, total: number, goal: string): number {
  const recency = total > 1 ? index / (total - 1) : 1;
  const impact =
    turn.toolCalls.length * 2 +
    turn.toolResults.filter((r) => !r.ok).length * 3 +
    (turn.spawnedAgentResult ? 2 : 0);
  const goalMatch = includesAny(turn.assistantMessage, goal) || includesAny(turn.userMessage, goal) ? 2 : 0;
  return recency * 5 + impact + goalMatch;
}

function includesAny(text: string, goal: string): boolean {
  const words = goal
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word.length > 3)
    .slice(0, 10);
  if (words.length === 0) {
    return false;
  }
  const lowerText = text.toLowerCase();
  return words.some((word) => lowerText.includes(word));
}

function trim(text: string, max: number): string {
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max - 1)}…`;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error !== null && typeof error === "object" && "code" in error;
}
