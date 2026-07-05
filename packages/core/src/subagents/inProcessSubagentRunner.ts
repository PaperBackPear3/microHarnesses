import type { Agent } from "../runtime/types";
import type {
  SubagentResult,
  SubagentRunOptions,
  SubagentRunner,
  SubagentRuntimeFactory,
} from "./types";

/**
 * Runs subagents in the same Node process. Every call builds a fresh child
 * `HarnessRuntime` via the supplied `SubagentRuntimeFactory`, awaits it to
 * completion, and returns the child's final assistant message as `summary`
 * — the only context that flows back to the parent (everything is a tool).
 *
 * The parent runtime is captured at construction so factories can pull the
 * parent session id off it (for nested sessions) even when the parent isn't
 * currently in `run()`.
 */
export class InProcessSubagentRunner implements SubagentRunner {
  private readonly factory: SubagentRuntimeFactory;
  private readonly parentRuntime: Agent;

  constructor(factory: SubagentRuntimeFactory, parentRuntime: Agent) {
    this.factory = factory;
    this.parentRuntime = parentRuntime;
  }

  async run(options: SubagentRunOptions): Promise<SubagentResult> {
    const built = await this.factory.build(options, this.parentRuntime);

    let abortHandler: (() => void) | undefined;
    if (options.signal) {
      if (options.signal.aborted) {
        built.runtime.kill("aborted before subagent invoke");
      } else {
        abortHandler = () => built.runtime.kill("aborted by parent signal");
        options.signal.addEventListener("abort", abortHandler, { once: true });
      }
    }

    try {
      const result = await built.runtime.invoke({
        agentName: built.agentName,
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
}
