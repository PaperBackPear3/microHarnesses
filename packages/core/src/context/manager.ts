import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { HeuristicTokenCounter } from "../observability/tokenCounter";
import type { TokenCounter } from "../observability/types";
import type { Turn } from "../runtime/state";
import { isNodeError } from "../shared/nodeError";
import { truncate } from "../shared/text";
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

interface OverflowPlan {
  triggerOverflow: number;
  targetOverflow: number;
  overflowByTurnLimit: number;
  overflowByTokenUsage: number;
  trigger: "none" | "turns" | "tokens" | "both";
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

    const from = Math.max(0, turns.length - this.maxWorkingTurns);
    const delta = turns.slice(from);
    await hooks?.onCompressionStarted?.({
      overflowTurns: plan.targetOverflow,
      deltaTurns: delta.length,
    });
    const compression = await this.compressor(delta, {
      goal: this.goal,
      previousSummary: this.latestSummary,
    });
    this.applyCompressionResult(compression);
    await this.persistSummary(compression, delta.length, from, true);
    await hooks?.onCompressionCompleted?.({
      overflowTurns: plan.targetOverflow,
      deltaTurns: delta.length,
    });
    return {
      compressed: true,
      forced: true,
      overflowTurns: plan.targetOverflow,
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
    };
  }

  private computeOverflowPlan(turns: Turn[]): OverflowPlan {
    const turnTriggerOverflow = Math.max(0, turns.length - this.maxWorkingTurns);
    const turnTargetTurns = Math.max(
      1,
      Math.floor(this.maxWorkingTurns * this.turnCompactionTargetRatio),
    );
    const turnTargetOverflow = Math.max(0, turns.length - turnTargetTurns);

    const triggerEnabled =
      this.compressionTriggerUtilization < 1 && this.contextWindowTokens > 0 && turns.length > 1;
    let tokenTriggerOverflow = 0;
    let tokenTargetOverflow = 0;
    if (triggerEnabled) {
      const triggerBudget = Math.max(
        1,
        Math.floor(this.contextWindowTokens * this.compressionTriggerUtilization) -
          this.nonTurnTokenReserve,
      );
      const targetBudget = Math.max(
        1,
        Math.floor(this.contextWindowTokens * this.compressionTargetUtilization) -
          this.nonTurnTokenReserve,
      );
      tokenTriggerOverflow = this.computeTokenOverflowNeeded(turns, triggerBudget);
      tokenTargetOverflow = this.computeTokenOverflowNeeded(turns, targetBudget);
    }

    const triggerOverflow = Math.max(turnTriggerOverflow, tokenTriggerOverflow);
    const targetOverflow = Math.max(triggerOverflow, turnTargetOverflow, tokenTargetOverflow);

    const trigger: OverflowPlan["trigger"] =
      turnTriggerOverflow > 0 && tokenTriggerOverflow > 0
        ? "both"
        : turnTriggerOverflow > 0
          ? "turns"
          : tokenTriggerOverflow > 0
            ? "tokens"
            : "none";

    return {
      triggerOverflow: Math.min(Math.max(0, triggerOverflow), Math.max(0, turns.length - 1)),
      targetOverflow: Math.min(Math.max(0, targetOverflow), Math.max(0, turns.length - 1)),
      overflowByTurnLimit: turnTriggerOverflow,
      overflowByTokenUsage: tokenTriggerOverflow,
      trigger,
    };
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
    let usedTokens = this.estimateSummaryTokens();
    for (const turn of workingTurns) {
      usedTokens += this.estimateTurnPayloadTokens(turn);
    }
    return usedTokens;
  }

  private estimateSummaryTokens(): number {
    if (!this.latestSummary) return 0;
    let total = this.tokenCounter.count(this.latestSummary.summary);
    for (const highlight of this.latestSummary.highlights) {
      total += this.tokenCounter.count(highlight);
    }
    return total;
  }

  private estimateTurnPayloadTokens(turn: Turn): number {
    let total = 0;
    total += this.tokenCounter.count(turn.userMessage);
    total += this.tokenCounter.count(turn.assistantMessage);
    if (turn.toolCalls.length > 0 || turn.toolResults.length > 0) {
      total += this.tokenCounter.count(renderToolResultFeedbackForEstimation(turn));
    }
    return total;
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

function renderToolResultFeedbackForEstimation(turn: Turn): string {
  const callLines = turn.toolCalls.map((call, index) => {
    const input = truncate(JSON.stringify(call.input), 300);
    return `${index + 1}. ${call.name} input=${input}`;
  });
  const resultLines = turn.toolResults.map((result, index) => {
    if (!result.ok) {
      return `${index + 1}. error=${result.error ?? "unknown error"}`;
    }
    return `${index + 1}. output=${truncate(JSON.stringify(result.output), 500)}`;
  });
  return [
    "Tool execution feedback from the previous step:",
    "Tool calls:",
    ...(callLines.length > 0 ? callLines : ["(none)"]),
    "Tool results:",
    ...(resultLines.length > 0 ? resultLines : ["(none)"]),
    "Use this feedback to decide the next action. If the request is satisfied, return the final answer.",
  ].join("\n");
}

function clampRatio(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}
