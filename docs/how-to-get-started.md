# Getting started

This guide gets you from zero to a working microHarnesses composition quickly.

## 1. Install

```bash
npm install @micro-harness/core @micro-harness/plugin-example-tools
```

## 2. Create a minimal runtime

Build a small composition root that wires runtime dependencies explicitly.

```ts
import {
  ContextManager,
  DefaultModelSelector,
  DefaultPolicyEngine,
  HarnessRuntime,
  MemoryEventSink,
  ToolRegistry,
  type ModelAdapter,
  type PromptSource,
  type StepInput,
  type StepPlan,
} from "@micro-harness/core";
import { echoTool, timeTool } from "@micro-harness/plugin-example-tools";

class DemoModel implements ModelAdapter {
  async nextStep(_input: StepInput): Promise<StepPlan> {
    return {
      assistantMessage: "Hello from microHarnesses",
      toolCalls: [],
      stop: true,
    };
  }
}

class DemoPrompts implements PromptSource {
  async load(_agentName: string, task: string) {
    return { system: "system", instructions: [], task, metadata: { name: "default" } };
  }
}

const tools = new ToolRegistry();
tools.register(echoTool);
tools.register(timeTool);

const runtime = new HarnessRuntime({
  model: new DemoModel(),
  modelSelector: new DefaultModelSelector(),
  prompts: new DemoPrompts(),
  tools,
  context: new ContextManager({ stateDir: ".micro-harness/context", maxWorkingTurns: 6 }),
  policy: new DefaultPolicyEngine(),
  eventSink: new MemoryEventSink(),
});

const result = await runtime.run("default", "Say hello", {
  maxIterations: 2,
  snapshotEvery: 1,
  profile: { defaultModel: "demo-model" },
});

console.log(result.turns.at(-1)?.assistantMessage);
```

## 3. Add production pieces

For real applications, replace demo model/prompt classes with:

- `ProviderModelAdapter` + `ProviderRegistry` + `CredentialsRegistry`
- `FsPromptSource`
- `PluginHost` to register plugins (`basic-tools`, `plan-mode`, custom plugins)
- `SessionStore` for persistent sessions and snapshots

## 4. Next steps

- Follow the full end-to-end tutorial: [`tutorial-build-sample-app.md`](./tutorial-build-sample-app.md)
- Learn runtime internals: [`how-runtime-works.md`](./how-runtime-works.md)
- Learn plugin composition patterns: [`how-to-compose-plugins.md`](./how-to-compose-plugins.md)
