import type { AgentHandle } from "../runtime/types";
import { InProcessSubagentSupervisor } from "./supervisor";
import type {
  SubagentResult,
  SubagentRunOptions,
  SubagentRunner,
  SubagentRuntimeFactory,
} from "./types";

/**
 * Runs subagents in the same Node process. Every call builds a fresh child
 * `Agent` via the supplied `SubagentRuntimeFactory`, awaits it to completion,
 * and returns the child's final assistant message as `summary` — the only
 * context that flows back to the parent (everything is a tool).
 *
 * The parent agent is captured at construction so factories can pull the
 * parent session id off it (for nested sessions) even when the parent isn't
 * currently in `run()`.
 */
export class InProcessSubagentRunner implements SubagentRunner {
  private readonly supervisor: InProcessSubagentSupervisor;

  constructor(factory: SubagentRuntimeFactory, parent: AgentHandle) {
    this.supervisor = new InProcessSubagentSupervisor(factory, parent);
  }

  async run(options: SubagentRunOptions): Promise<SubagentResult> {
    return await this.supervisor.run(options);
  }
}
