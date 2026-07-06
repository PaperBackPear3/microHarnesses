import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { HeuristicTokenCounter } from "../observability/tokenCounter";
import type { TokenCounter } from "../observability/types";
import type { Turn } from "../runtime/state";
import { isNodeError } from "../shared/nodeError";
import { defaultCompressor } from "./defaultCompressor";
import type { CompressionResult, CompressorFn, ContextWindowStats, WorkingContext } from "./types";

export interface ContextManagerOptions {
  stateDir: string;
  maxWorkingTurns: number;
  compressor?: CompressorFn;
  goal?: string;
  /** Token estimator for context-window utilization stats (default heuristic). */
  tokenCounter?: TokenCounter;
  /** Configured context window size in tokens for utilization (default 128000). */
  contextWindowTokens?: number;
}

interface SummaryState {
  compressedTurnCount: number;
}

export interface CompressionLifecycleHooks {
  onCompressionStarted?(details: {
    overflowTurns: number;
    deltaTurns: number;
  }): Promise<void> | void;
  onCompressionCompleted?(details: {
    overflowTurns: number;
    deltaTurns: number;
  }): Promise<void> | void;
}

export interface ManualCompressionResult {
  compressed: boolean;
  forced: boolean;
  overflowTurns: number;
  deltaTurns: number;
  reason?: "no_turns";
  summary?: CompressionResult;
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
  private readonly tokenCounter: TokenCounter;
  private readonly contextWindowTokens: number;

  constructor(options: ContextManagerOptions) {
    this.summaryDir = path.join(options.stateDir, "summaries");
    this.summaryStatePath = path.join(this.summaryDir, "state.json");
    this.maxWorkingTurns = options.maxWorkingTurns;
    this.compressor = options.compressor ?? defaultCompressor;
    this.goal = options.goal;
    this.tokenCounter = options.tokenCounter ?? new HeuristicTokenCounter();
    this.contextWindowTokens = options.contextWindowTokens ?? 128_000;
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

  async buildWorkingTurns(
    turns: Turn[],
    hooks?: CompressionLifecycleHooks,
  ): Promise<WorkingContext> {
    if (turns.length <= this.maxWorkingTurns) {
      const recentTurns = turns;
      return {
        recentTurns,
        summary: this.latestSummary,
        stats: this.computeStats(turns.length, recentTurns, 0, false),
      };
    }

    const overflowCount = turns.length - this.maxWorkingTurns;
    const summaryState = await this.readSummaryState();
    const newOverflowCount = overflowCount - summaryState.compressedTurnCount;
    let compressed = false;
    if (newOverflowCount > 0) {
      await hooks?.onCompressionStarted?.({
        overflowTurns: overflowCount,
        deltaTurns: newOverflowCount,
      });
      const delta = turns.slice(summaryState.compressedTurnCount, overflowCount);
      const compression = await this.compressor(delta, {
        goal: this.goal,
        previousSummary: this.latestSummary,
      });
      this.applyCompressionResult(compression);
      compressed = true;
      await this.persistSummary(compression, delta.length, summaryState.compressedTurnCount, false);
      await this.writeSummaryState({ compressedTurnCount: overflowCount });
      await hooks?.onCompressionCompleted?.({
        overflowTurns: overflowCount,
        deltaTurns: newOverflowCount,
      });
    }

    const recentTurns = turns.slice(-this.maxWorkingTurns);
    return {
      recentTurns,
      summary: this.latestSummary,
      stats: this.computeStats(turns.length, recentTurns, overflowCount, compressed),
    };
  }

  /**
   * Forces a compression pass against the current session turns.
   *
   * - When there is uncompressed overflow (`turns.length > maxWorkingTurns` and
   *   `overflow > compressedTurnCount`), this behaves like the normal automatic
   *   compression path and advances summary state.
   * - Otherwise, it still performs a forced compression over the current
   *   working window to refresh/produce a summary immediately, but does not
   *   advance overflow bookkeeping.
   */
  async compactNow(
    turns: Turn[],
    hooks?: CompressionLifecycleHooks,
  ): Promise<ManualCompressionResult> {
    await this.init();
    if (turns.length === 0) {
      return {
        compressed: false,
        forced: true,
        overflowTurns: 0,
        deltaTurns: 0,
        reason: "no_turns",
      };
    }

    const overflowCount = Math.max(0, turns.length - this.maxWorkingTurns);
    const summaryState = await this.readSummaryState();
    const newOverflowCount = overflowCount - summaryState.compressedTurnCount;
    if (newOverflowCount > 0) {
      await hooks?.onCompressionStarted?.({
        overflowTurns: overflowCount,
        deltaTurns: newOverflowCount,
      });
      const delta = turns.slice(summaryState.compressedTurnCount, overflowCount);
      const compression = await this.compressor(delta, {
        goal: this.goal,
        previousSummary: this.latestSummary,
      });
      this.applyCompressionResult(compression);
      await this.persistSummary(compression, delta.length, summaryState.compressedTurnCount, false);
      await this.writeSummaryState({ compressedTurnCount: overflowCount });
      await hooks?.onCompressionCompleted?.({
        overflowTurns: overflowCount,
        deltaTurns: newOverflowCount,
      });
      return {
        compressed: true,
        forced: false,
        overflowTurns: overflowCount,
        deltaTurns: newOverflowCount,
        summary: compression,
      };
    }

    const from = Math.max(0, turns.length - this.maxWorkingTurns);
    const delta = turns.slice(from);
    await hooks?.onCompressionStarted?.({
      overflowTurns: overflowCount,
      deltaTurns: delta.length,
    });
    const compression = await this.compressor(delta, {
      goal: this.goal,
      previousSummary: this.latestSummary,
    });
    this.applyCompressionResult(compression);
    await this.persistSummary(compression, delta.length, from, true);
    await hooks?.onCompressionCompleted?.({
      overflowTurns: overflowCount,
      deltaTurns: delta.length,
    });
    return {
      compressed: true,
      forced: true,
      overflowTurns: overflowCount,
      deltaTurns: delta.length,
      summary: compression,
    };
  }

  /** Estimates context-window utilization for the working turns + summary. */
  private computeStats(
    totalTurns: number,
    workingTurns: Turn[],
    overflowTurns: number,
    compressed: boolean,
  ): ContextWindowStats {
    let usedTokens = 0;
    for (const turn of workingTurns) {
      usedTokens += this.tokenCounter.count(turn.userMessage);
      usedTokens += this.tokenCounter.count(turn.assistantMessage);
    }
    if (this.latestSummary) {
      usedTokens += this.tokenCounter.count(this.latestSummary.summary);
      for (const highlight of this.latestSummary.highlights) {
        usedTokens += this.tokenCounter.count(highlight);
      }
    }
    const maxTokens = this.contextWindowTokens;
    const utilization = maxTokens > 0 ? Math.min(1, usedTokens / maxTokens) : 0;
    return {
      totalTurns,
      workingTurns: workingTurns.length,
      overflowTurns,
      compressed,
      usedTokens,
      maxTokens,
      utilization,
    };
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

  private applyCompressionResult(compression: CompressionResult): void {
    this.latestSummary = compression;
    // A goals-finder-style compressor may rediscover a more accurate goal
    // mid-run; adopt it so later compression cycles in this run see it.
    const refinedGoal = compression.refinedGoal?.trim();
    if (refinedGoal) {
      this.setGoal(refinedGoal);
    }
  }

  private async persistSummary(
    compression: CompressionResult,
    turnCount: number,
    from: number,
    forced: boolean,
  ): Promise<void> {
    const summaryFile = path.join(this.summaryDir, `summary-${randomUUID()}.json`);
    await writeFile(
      summaryFile,
      JSON.stringify(
        {
          goal: this.goal ?? "",
          summary: compression.summary,
          highlights: compression.highlights,
          support_history: compression.supportHistory,
          turns: turnCount,
          from,
          forced,
        },
        null,
        2,
      ),
      "utf8",
    );
  }
}
