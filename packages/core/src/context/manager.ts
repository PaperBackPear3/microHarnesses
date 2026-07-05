import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Turn } from "../runtime/state";
import { isNodeError } from "../shared/nodeError";
import { defaultCompressor } from "./defaultCompressor";
import type { CompressionResult, CompressorFn, WorkingContext } from "./types";

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
 * Owns the working context window: trims turns to `maxWorkingTurns`, compresses
 * overflowed turns exactly once (persisting summaries under
 * `<stateDir>/summaries/`), and returns the latest summary so the runtime can
 * reinject it into the model context.
 */
export class ContextManager {
  private readonly summaryDir: string;
  private readonly summaryStatePath: string;
  private readonly maxWorkingTurns: number;
  private compressor: CompressorFn;
  private goal?: string;
  private latestSummary?: CompressionResult;

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
    if (!this.latestSummary) {
      this.latestSummary = await this.loadLatestSummary();
    }
  }

  async buildWorkingTurns(turns: Turn[]): Promise<WorkingContext> {
    if (turns.length <= this.maxWorkingTurns) {
      return { recentTurns: turns, summary: this.latestSummary };
    }

    const overflowCount = turns.length - this.maxWorkingTurns;
    const summaryState = await this.readSummaryState();
    const newOverflowCount = overflowCount - summaryState.compressedTurnCount;
    if (newOverflowCount > 0) {
      const delta = turns.slice(summaryState.compressedTurnCount, overflowCount);
      const compression = await this.compressor(delta, { goal: this.goal });
      this.latestSummary = compression;
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

    return { recentTurns: turns.slice(-this.maxWorkingTurns), summary: this.latestSummary };
  }

  private async loadLatestSummary(): Promise<CompressionResult | undefined> {
    let names: string[];
    try {
      names = (await readdir(this.summaryDir))
        .filter((name) => name.startsWith("summary-") && name.endsWith(".json"))
        .sort();
    } catch (error: unknown) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return undefined;
      }
      throw error;
    }
    const latest = names.at(-1);
    if (!latest) {
      return undefined;
    }
    try {
      const raw = await readFile(path.join(this.summaryDir, latest), "utf8");
      const parsed = JSON.parse(raw) as {
        summary?: string;
        highlights?: string[];
        support_history?: string[];
      };
      return {
        summary: parsed.summary ?? "",
        highlights: parsed.highlights ?? [],
        supportHistory: parsed.support_history ?? [],
      };
    } catch {
      return undefined;
    }
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
