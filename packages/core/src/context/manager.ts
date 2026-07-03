import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { isNodeError } from "../shared/nodeError";
import { defaultCompressor } from "./defaultCompressor";
import type { CompressorFn, Turn } from "./types";

export interface ContextManagerOptions {
  stateDir: string;
  maxWorkingTurns: number;
  compressor?: CompressorFn;
  goal?: string;
}

interface SummaryState {
  compressedTurnCount: number;
}

/**
 * Owns the working context window: trims turns to `maxWorkingTurns` and
 * compresses overflowed turns exactly once, persisting summaries under
 * `<stateDir>/summaries/`.
 */
export class ContextManager {
  private readonly summaryDir: string;
  private readonly summaryStatePath: string;
  private readonly maxWorkingTurns: number;
  private compressor: CompressorFn;
  private goal?: string;

  constructor(options: ContextManagerOptions) {
    this.summaryDir = path.join(options.stateDir, "summaries");
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
            from: summaryState.compressedTurnCount,
          },
          null,
          2,
        ),
        "utf8",
      );
      await this.writeSummaryState({ compressedTurnCount: overflowCount });
    }

    return turns.slice(-this.maxWorkingTurns);
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
