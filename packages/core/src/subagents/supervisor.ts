import { randomUUID } from "node:crypto";
import type { AgentHandle } from "../runtime/types";
import type {
  SubagentResult,
  SubagentRunOptions,
  SubagentRuntimeFactory,
  SubagentSnapshot,
  SubagentSpawnResult,
  SubagentSupervisor,
  SubagentWaitOptions,
  SubagentWaitResult,
} from "./types";

interface TrackedSubagent {
  id: string;
  launchIndex: number;
  request: SubagentRunOptions;
  status: "running" | "completed" | "failed";
  startedAt: string;
  completedAt?: string;
  sessionId?: string;
  summary?: string;
  error?: string;
  delivered: boolean;
  promise: Promise<SubagentResult>;
}

export interface InProcessSubagentSupervisorOptions {
  idFactory?: () => string;
  now?: () => string;
}

/**
 * Tracks in-process child agents independently from the parent tool call. This
 * lets model-facing tools launch children, later join them deterministically,
 * and surface completed summaries through normal tool results.
 */
export class InProcessSubagentSupervisor implements SubagentSupervisor {
  private readonly factory: SubagentRuntimeFactory;
  private readonly parent: AgentHandle;
  private readonly idFactory: () => string;
  private readonly now: () => string;
  private readonly tracked = new Map<string, TrackedSubagent>();
  private launchCounter = 0;

  constructor(
    factory: SubagentRuntimeFactory,
    parent: AgentHandle,
    options: InProcessSubagentSupervisorOptions = {},
  ) {
    this.factory = factory;
    this.parent = parent;
    this.idFactory = options.idFactory ?? randomUUID;
    this.now = options.now ?? (() => new Date().toISOString());
  }

  async run(options: SubagentRunOptions): Promise<SubagentResult> {
    const built = await this.factory.build(options, this.parent);
    return runBuiltSubagent(built, options);
  }

  async spawn(options: SubagentRunOptions): Promise<SubagentSpawnResult> {
    const id = this.idFactory();
    const launchIndex = ++this.launchCounter;
    const tracked: TrackedSubagent = {
      id,
      launchIndex,
      request: options,
      status: "running",
      startedAt: this.now(),
      delivered: false,
      promise: Promise.resolve(undefined as never),
    };
    this.tracked.set(id, tracked);

    tracked.promise = this.startTracked(tracked);
    // Prevent unhandled rejection noise: failures are captured on the tracked
    // record and surfaced by wait/list.
    tracked.promise.catch(() => undefined);

    return { id, launchIndex, sessionId: tracked.sessionId, status: "running" };
  }

  async wait(options: SubagentWaitOptions = {}): Promise<SubagentWaitResult> {
    throwIfAborted(options.signal);

    const mode = options.mode ?? "next";
    const selected = this.select(options.ids);
    const undelivered = selected
      .filter((entry) => entry.status !== "running" && !entry.delivered)
      .sort(compareCompletion);
    if (undelivered.length > 0) {
      return this.deliver(undelivered, options.ids);
    }

    const running = selected.filter((entry) => entry.status === "running");
    if (running.length === 0) {
      return { completed: [], running: this.runningSnapshots(options.ids) };
    }

    if (mode === "all") {
      await this.awaitAll(running, options.signal);
    } else {
      await this.awaitNext(running, options.signal);
    }

    const completed = selected
      .filter((entry) => entry.status !== "running" && !entry.delivered)
      .sort(compareCompletion);
    return this.deliver(mode === "next" ? completed.slice(0, 1) : completed, options.ids);
  }

  list(): SubagentSnapshot[] {
    return [...this.tracked.values()].sort(compareLaunch).map(toSnapshot);
  }

  private async startTracked(tracked: TrackedSubagent): Promise<SubagentResult> {
    try {
      const built = await this.factory.build(tracked.request, this.parent);
      tracked.sessionId = built.runOptions.sessionId;
      const result = await runBuiltSubagent(built, tracked.request);
      tracked.status = "completed";
      tracked.completedAt = this.now();
      tracked.summary = result.summary;
      tracked.sessionId = result.state.sessionId ?? tracked.sessionId;
      return result;
    } catch (error) {
      tracked.status = "failed";
      tracked.completedAt = this.now();
      tracked.error = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }

  private select(ids: string[] | undefined): TrackedSubagent[] {
    const values = ids
      ? ids.map((id) => this.tracked.get(id)).filter((entry): entry is TrackedSubagent => !!entry)
      : [...this.tracked.values()];
    return values.sort(compareLaunch);
  }

  private async awaitNext(
    running: TrackedSubagent[],
    signal: AbortSignal | undefined,
  ): Promise<void> {
    await abortable(
      Promise.race(running.map((entry) => entry.promise.catch(() => undefined))),
      signal,
    );
  }

  private async awaitAll(
    running: TrackedSubagent[],
    signal: AbortSignal | undefined,
  ): Promise<void> {
    await abortable(
      Promise.all(running.map((entry) => entry.promise.catch(() => undefined))),
      signal,
    );
  }

  private deliver(entries: TrackedSubagent[], ids: string[] | undefined): SubagentWaitResult {
    for (const entry of entries) {
      entry.delivered = true;
    }
    return {
      completed: entries.map(toSnapshot),
      running: this.runningSnapshots(ids),
    };
  }

  private runningSnapshots(ids: string[] | undefined): SubagentSnapshot[] {
    return this.select(ids)
      .filter((entry) => entry.status === "running")
      .map(toSnapshot);
  }
}

async function runBuiltSubagent(
  built: Awaited<ReturnType<SubagentRuntimeFactory["build"]>>,
  options: SubagentRunOptions,
): Promise<SubagentResult> {
  let abortHandler: (() => void) | undefined;
  if (options.signal) {
    if (options.signal.aborted) {
      built.agent.kill("aborted before subagent invoke");
    } else {
      abortHandler = () => built.agent.kill("aborted by parent signal");
      options.signal.addEventListener("abort", abortHandler, { once: true });
    }
  }

  try {
    const result = await built.agent.invoke({
      prompt: built.prompt,
      execution: built.runOptions,
    });
    return { summary: result.summary, state: result.state };
  } finally {
    if (abortHandler && options.signal) {
      options.signal.removeEventListener("abort", abortHandler);
    }
  }
}

function toSnapshot(entry: TrackedSubagent): SubagentSnapshot {
  return {
    id: entry.id,
    launchIndex: entry.launchIndex,
    prompt: entry.request.prompt,
    ...(entry.request.promptName ? { promptName: entry.request.promptName } : {}),
    ...(entry.request.goal ? { goal: entry.request.goal } : {}),
    ...(entry.sessionId ? { sessionId: entry.sessionId } : {}),
    status: entry.status,
    startedAt: entry.startedAt,
    ...(entry.completedAt ? { completedAt: entry.completedAt } : {}),
    ...(entry.summary !== undefined ? { summary: entry.summary } : {}),
    ...(entry.error ? { error: entry.error } : {}),
  };
}

function compareLaunch(a: TrackedSubagent, b: TrackedSubagent): number {
  return a.launchIndex - b.launchIndex;
}

function compareCompletion(a: TrackedSubagent, b: TrackedSubagent): number {
  return (a.completedAt ?? "").localeCompare(b.completedAt ?? "") || compareLaunch(a, b);
}

async function abortable<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  throwIfAborted(signal);
  if (!signal) return promise;
  return await new Promise<T>((resolve, reject) => {
    const abort = () => reject(new Error("subagent wait aborted"));
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new Error("subagent wait aborted");
  }
}
