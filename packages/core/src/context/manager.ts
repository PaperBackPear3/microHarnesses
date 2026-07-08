import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { HeuristicTokenCounter } from "../observability/tokenCounter";
import type { TokenCounter } from "../observability/types";
import type { Turn } from "../runtime/state";
import { isNodeError } from "../shared/nodeError";
import { renderToolResultFeedback } from "../tools/resultFeedback";
import { defaultCompressor } from "./defaultCompressor";
import { type OverflowPlan, computeOverflowPlan } from "./overflowPlan";
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
  /**
   * Auto-compaction trigger utilization in [0,1]. `1` disables token-based
   * triggering (turn-limit-only behavior).
   */
  compressionTriggerUtilization?: number;
  /**
   * Target utilization after compaction in [0,1]. Used as hysteresis so we
   * compact in batches and avoid recompacting every new turn once over the
   * trigger.
   */
  compressionTargetUtilization?: number;
  /**
   * Turn-window hysteresis target ratio in [0,1]. When turn-limit compaction
   * fires, compact to this ratio of `maxWorkingTurns` to avoid per-turn
   * recompaction.
   */
  turnCompactionTargetRatio?: number;
  /**
   * Conservative reserve for prompt overhead and model output headroom not
   * represented by turn text.
   */
  nonTurnTokenReserve?: number;
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
  private tokenCounter: TokenCounter;
  private tokenEstimator = "heuristic";
  private observedTokenScale = 1;
  private contextWindowTokens: number;
  private readonly compressionTriggerUtilization: number;
  private readonly compressionTargetUtilization: number;
  private readonly turnCompactionTargetRatio: number;
  private readonly nonTurnTokenReserve: number;

  constructor(options: ContextManagerOptions) {
    this.summaryDir = path.join(options.stateDir, "summaries");
    this.summaryStatePath = path.join(this.summaryDir, "state.json");
    this.maxWorkingTurns = options.maxWorkingTurns;
    this.compressor = options.compressor ?? defaultCompressor;
    this.goal = options.goal;
    this.tokenCounter = options.tokenCounter ?? new HeuristicTokenCounter();
    this.tokenEstimator = options.tokenCounter ? "custom" : "heuristic";
    this.contextWindowTokens = options.contextWindowTokens ?? 128_000;
    this.compressionTriggerUtilization = clampRatio(options.compressionTriggerUtilization ?? 1);
    this.compressionTargetUtilization = clampRatio(
      options.compressionTargetUtilization ?? Math.min(0.85, this.compressionTriggerUtilization),
    );
    this.turnCompactionTargetRatio = clampRatio(options.turnCompactionTargetRatio ?? 1);
    this.nonTurnTokenReserve = Math.max(0, Math.floor(options.nonTurnTokenReserve ?? 0));
  }

  setCompressor(compressor: CompressorFn): void {
    this.compressor = compressor;
  }

  setGoal(goal: string): void {
    this.goal = goal;
  }

  setContextWindowTokens(tokens: number): void {
    if (!Number.isFinite(tokens) || tokens <= 0) return;
    this.contextWindowTokens = Math.floor(tokens);
  }

  setTokenCounter(counter: TokenCounter, estimator = "custom"): void {
    this.tokenCounter = counter;
    this.tokenEstimator = estimator;
    this.observedTokenScale = 1;
  }

  recordObservedUsage(workingTurns: Turn[], inputTokens?: number): void {
    if (typeof inputTokens !== "number" || !Number.isFinite(inputTokens) || inputTokens <= 0) {
      return;
    }
    const rawEstimate = this.estimateWorkingPayloadTokensRaw(workingTurns);
    if (rawEstimate <= 0) {
      return;
    }
    const ratio = inputTokens / rawEstimate;
    if (!Number.isFinite(ratio) || ratio <= 0) {
      return;
    }
    const bounded = Math.min(4, Math.max(0.25, ratio));
    this.observedTokenScale = this.observedTokenScale * 0.7 + bounded * 0.3;
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
    const summaryState = await this.readSummaryState();
    const plan = this.computeOverflowPlan(turns);
    const newOverflowCount = plan.triggerOverflow - summaryState.compressedTurnCount;
    let compressedTurnCount = summaryState.compressedTurnCount;
    let compressed = false;
    if (newOverflowCount > 0) {
      await hooks?.onCompressionStarted?.({
        overflowTurns: plan.targetOverflow,
        deltaTurns: newOverflowCount,
      });
      const delta = turns.slice(summaryState.compressedTurnCount, plan.targetOverflow);
      const compression = await this.compressor(delta, {
        goal: this.goal,
        previousSummary: this.latestSummary,
      });
      this.applyCompressionResult(compression);
      compressed = true;
      await this.persistSummary(compression, delta.length, summaryState.compressedTurnCount, false);
      compressedTurnCount = plan.targetOverflow;
      await this.writeSummaryState({ compressedTurnCount });
      await hooks?.onCompressionCompleted?.({
        overflowTurns: plan.targetOverflow,
        deltaTurns: newOverflowCount,
      });
    }

    const recentTurns = turns.slice(compressedTurnCount);
    return {
      recentTurns,
      summary: this.latestSummary,
      stats: this.computeStats(turns.length, recentTurns, compressedTurnCount, compressed, plan),
    };
  }

  /**
   * Forces a compression pass against the current session turns.
   *
   * - When there is uncompressed overflow (`turns.length > maxWorkingTurns` and
   *   `overflow > compressedTurnCount`), this behaves like the normal automatic
   *   compression path and advances summary state.
   * - Otherwise, it force-compacts additional older turns while keeping the
   *   most recent turn verbatim in working context.
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

    const summaryState = await this.readSummaryState();
    const plan = this.computeOverflowPlan(turns);
    const newOverflowCount = plan.triggerOverflow - summaryState.compressedTurnCount;
    if (newOverflowCount > 0) {
      await hooks?.onCompressionStarted?.({
        overflowTurns: plan.targetOverflow,
        deltaTurns: newOverflowCount,
      });
      const delta = turns.slice(summaryState.compressedTurnCount, plan.targetOverflow);
      const compression = await this.compressor(delta, {
        goal: this.goal,
        previousSummary: this.latestSummary,
      });
      this.applyCompressionResult(compression);
      await this.persistSummary(compression, delta.length, summaryState.compressedTurnCount, false);
      await this.writeSummaryState({ compressedTurnCount: plan.targetOverflow });
      await hooks?.onCompressionCompleted?.({
        overflowTurns: plan.targetOverflow,
        deltaTurns: newOverflowCount,
      });
      return {
        compressed: true,
        forced: false,
        overflowTurns: plan.targetOverflow,
        deltaTurns: newOverflowCount,
        summary: compression,
      };
    }

    const keepRecentTurns = 1;
    const nextCompressedTurnCount = Math.max(
      summaryState.compressedTurnCount,
      Math.max(0, turns.length - keepRecentTurns),
    );
    if (nextCompressedTurnCount <= summaryState.compressedTurnCount) {
      return {
        compressed: false,
        forced: true,
        overflowTurns: plan.targetOverflow,
        deltaTurns: 0,
      };
    }
    const delta = turns.slice(summaryState.compressedTurnCount, nextCompressedTurnCount);
    await hooks?.onCompressionStarted?.({
      overflowTurns: nextCompressedTurnCount,
      deltaTurns: delta.length,
    });
    const compression = await this.compressor(delta, {
      goal: this.goal,
      previousSummary: this.latestSummary,
    });
    this.applyCompressionResult(compression);
    await this.persistSummary(compression, delta.length, summaryState.compressedTurnCount, true);
    await this.writeSummaryState({ compressedTurnCount: nextCompressedTurnCount });
    await hooks?.onCompressionCompleted?.({
      overflowTurns: nextCompressedTurnCount,
      deltaTurns: delta.length,
    });
    return {
      compressed: true,
      forced: true,
      overflowTurns: nextCompressedTurnCount,
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
    plan?: OverflowPlan,
  ): ContextWindowStats {
    const usedTokens = this.estimateWorkingPayloadTokens(workingTurns);
    const maxTokens = this.contextWindowTokens;
    const utilization = maxTokens > 0 ? Math.min(1, usedTokens / maxTokens) : 0;
    const estimator =
      Math.abs(this.observedTokenScale - 1) > 0.1
        ? `calibrated:${this.tokenEstimator}`
        : this.tokenEstimator;
    return {
      totalTurns,
      workingTurns: workingTurns.length,
      overflowTurns,
      ...(plan ? { overflowTurnsByTurnLimit: plan.overflowByTurnLimit } : {}),
      ...(plan ? { overflowTurnsByTokenUsage: plan.overflowByTokenUsage } : {}),
      ...(plan ? { compressionTrigger: plan.trigger } : {}),
      compressed,
      usedTokens,
      maxTokens,
      utilization,
      estimator,
    };
  }

  private computeOverflowPlan(turns: Turn[]): OverflowPlan {
    return computeOverflowPlan(
      turns,
      {
        maxWorkingTurns: this.maxWorkingTurns,
        turnCompactionTargetRatio: this.turnCompactionTargetRatio,
        compressionTriggerUtilization: this.compressionTriggerUtilization,
        compressionTargetUtilization: this.compressionTargetUtilization,
        contextWindowTokens: this.contextWindowTokens,
        nonTurnTokenReserve: this.nonTurnTokenReserve,
      },
      (inputTurns, budget) => this.computeTokenOverflowNeeded(inputTurns, budget),
    );
  }

  private computeTokenOverflowNeeded(turns: Turn[], budget: number): number {
    if (turns.length <= 1) return 0;
    const fixedSummaryTokens = this.estimateSummaryTokens();
    const turnTokens = turns.map((turn) => this.estimateTurnPayloadTokens(turn));
    const suffixTokens = new Array<number>(turnTokens.length + 1).fill(0);
    for (let index = turnTokens.length - 1; index >= 0; index -= 1) {
      suffixTokens[index] = suffixTokens[index + 1] + (turnTokens[index] ?? 0);
    }
    for (let overflow = 0; overflow <= turns.length - 1; overflow += 1) {
      const total = fixedSummaryTokens + (suffixTokens[overflow] ?? 0);
      if (total <= budget) {
        return overflow;
      }
    }
    return turns.length - 1;
  }

  private estimateWorkingPayloadTokens(workingTurns: Turn[]): number {
    return this.scaleTokenEstimate(this.estimateWorkingPayloadTokensRaw(workingTurns));
  }

  private estimateWorkingPayloadTokensRaw(workingTurns: Turn[]): number {
    let usedTokens = this.estimateSummaryTokensRaw();
    for (const turn of workingTurns) {
      usedTokens += this.estimateTurnPayloadTokensRaw(turn);
    }
    return usedTokens;
  }

  private estimateSummaryTokens(): number {
    return this.scaleTokenEstimate(this.estimateSummaryTokensRaw());
  }

  private estimateSummaryTokensRaw(): number {
    if (!this.latestSummary) return 0;
    let total = this.tokenCounter.count(this.latestSummary.summary);
    for (const highlight of this.latestSummary.highlights) {
      total += this.tokenCounter.count(highlight);
    }
    return total;
  }

  private estimateTurnPayloadTokens(turn: Turn): number {
    return this.scaleTokenEstimate(this.estimateTurnPayloadTokensRaw(turn));
  }

  private estimateTurnPayloadTokensRaw(turn: Turn): number {
    let total = 0;
    total += this.tokenCounter.count(turn.userMessage);
    total += this.tokenCounter.count(turn.assistantMessage);
    const userAttachments = (turn.userContent ?? []).filter((part) => part.type !== "text");
    const assistantAttachments = (turn.assistantContent ?? []).filter(
      (part) => part.type !== "text",
    );
    total += (userAttachments.length + assistantAttachments.length) * 256;
    if (turn.toolCalls.length > 0 || turn.toolResults.length > 0) {
      total += this.tokenCounter.count(renderToolResultFeedbackForEstimation(turn));
    }
    return total;
  }

  private scaleTokenEstimate(raw: number): number {
    if (raw <= 0) return 0;
    return Math.max(1, Math.floor(raw * this.observedTokenScale));
  }

  private async loadLatestSummary(): Promise<CompressionResult | undefined> {
    let names: Array<{ name: string; mtimeMs: number }>;
    try {
      const candidates = (await readdir(this.summaryDir)).filter(
        (name) => name.startsWith("summary-") && name.endsWith(".json"),
      );
      names = await Promise.all(
        candidates.map(async (name) => {
          const summaryPath = path.join(this.summaryDir, name);
          const file = await stat(summaryPath);
          return { name, mtimeMs: file.mtimeMs };
        }),
      );
      names.sort((a, b) => {
        if (a.mtimeMs !== b.mtimeMs) {
          return a.mtimeMs - b.mtimeMs;
        }
        return a.name.localeCompare(b.name);
      });
    } catch (error: unknown) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return undefined;
      }
      throw error;
    }
    const latest = names.at(-1)?.name;
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
    // Only adopt rediscovered goals when no explicit goal is currently set.
    const refinedGoal = compression.refinedGoal?.trim();
    if (refinedGoal && (!this.goal || this.goal.trim().length === 0)) {
      this.setGoal(refinedGoal);
    }
  }

  private async persistSummary(
    compression: CompressionResult,
    turnCount: number,
    from: number,
    forced: boolean,
  ): Promise<void> {
    const timestamp = new Date().toISOString().replaceAll(":", "-");
    const summaryFile = path.join(this.summaryDir, `summary-${timestamp}-${randomUUID()}.json`);
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

function renderToolResultFeedbackForEstimation(turn: Turn): string {
  return renderToolResultFeedback(turn.toolCalls, turn.toolResults);
}

function clampRatio(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}
