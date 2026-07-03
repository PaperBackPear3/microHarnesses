import type { HarnessRuntime } from "../runtime/runtime";
import type {
  SubagentBuiltRuntime,
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
  private readonly parentRuntime: HarnessRuntime;

  constructor(factory: SubagentRuntimeFactory, parentRuntime: HarnessRuntime) {
    this.factory = factory;
    this.parentRuntime = parentRuntime;
  }

  async run(options: SubagentRunOptions): Promise<SubagentResult> {
    const built: SubagentBuiltRuntime = await this.factory.build(options, this.parentRuntime);

    let abortHandler: (() => void) | undefined;
    if (options.signal) {
      if (options.signal.aborted) {
        built.runtime.kill();
      } else {
        abortHandler = () => built.runtime.kill();
        options.signal.addEventListener("abort", abortHandler, { once: true });
      }
    }

    try {
      const state = await built.runtime.run(built.agentName, built.prompt, built.runOptions);
      const summary = state.turns[state.turns.length - 1]?.assistantMessage ?? "";
      return { summary, state };
    } finally {
      if (abortHandler && options.signal) {
        options.signal.removeEventListener("abort", abortHandler);
      }
    }
  }
}
