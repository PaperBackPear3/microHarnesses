import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { CompressorFn, HarnessState, Turn } from "../types";

export interface ContextManagerOptions {
  stateDir: string;
  maxWorkingTurns: number;
  compressor?: CompressorFn;
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

  constructor(options: ContextManagerOptions) {
    this.stateDir = options.stateDir;
    this.checkpointDir = path.join(this.stateDir, "checkpoints");
    this.summaryDir = path.join(this.stateDir, "summaries");
    this.summaryStatePath = path.join(this.summaryDir, "state.json");
    this.maxWorkingTurns = options.maxWorkingTurns;
    this.compressor = options.compressor ?? defaultCompressor;
  }

  setCompressor(compressor: CompressorFn): void {
    this.compressor = compressor;
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
      const summary = await this.compressor(delta);
      const summaryFile = path.join(this.summaryDir, `summary-${randomUUID()}.json`);
      await writeFile(
        summaryFile,
        JSON.stringify({ summary, turns: delta.length, from: summaryState.compressedTurnCount }, null, 2),
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

async function defaultCompressor(turns: Turn[]): Promise<string> {
  const toolCalls = turns.reduce((total, turn) => total + turn.toolCalls.length, 0);
  const spawned = turns.filter((turn) => Boolean(turn.spawnedAgentResult)).length;
  return `Compressed ${turns.length} turns. Tool calls: ${toolCalls}. Spawned agent turns: ${spawned}.`;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error !== null && typeof error === "object" && "code" in error;
}
