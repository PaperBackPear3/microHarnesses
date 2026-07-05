# Tutorial: build a sample application

This tutorial builds a small Node.js app that runs a microHarnesses runtime with plugin tools.

## Goal

Create a `hello-harness` app that:

- runs one prompt through `HarnessRuntime`
- registers plugin tools
- persists local state
- prints the final assistant message

## 1. Initialize project

```bash
mkdir hello-harness
cd hello-harness
npm init -y
npm install @micro-harness/core @micro-harness/plugin-example-tools
npm install -D typescript @types/node
npx tsc --init
```

## 2. Create `src/main.ts`

```ts
import {
  ContextManager,
  DefaultModelSelector,
  DefaultPolicyEngine,
  HarnessRuntime,
  MemoryEventSink,
  ToolRegistry,
  type ModelAdapter,
  type PromptBundle,
  type PromptSource,
  type StepInput,
  type StepPlan,
} from "@micro-harness/core";
import { echoTool, timeTool } from "@micro-harness/plugin-example-tools";

class DemoPromptSource implements PromptSource {
  async load(_agentName: string, task: string): Promise<PromptBundle> {
    return {
      system: "You are a concise assistant.",
      instructions: [],
      task,
      metadata: { name: "demo" },
    };
  }
}

class DemoModel implements ModelAdapter {
  async nextStep(input: StepInput): Promise<StepPlan> {
    const usedEcho = input.workingTurns.some((turn) =>
      turn.toolResults.some((result) => result.ok && typeof result.output.text === "string"),
    );

    if (!usedEcho) {
      return {
        assistantMessage: "I will call echo first.",
        toolCalls: [{ name: "echo", input: { text: input.userPrompt } }],
        stop: false,
      };
    }

    return {
      assistantMessage: "Done. I echoed your prompt using a plugin tool.",
      toolCalls: [],
      stop: true,
    };
  }
}

const tools = new ToolRegistry();
tools.register(echoTool);
tools.register(timeTool);

const runtime = new HarnessRuntime({
  model: new DemoModel(),
  modelSelector: new DefaultModelSelector(),
  prompts: new DemoPromptSource(),
  tools,
  context: new ContextManager({
    stateDir: ".micro-harness/context",
    maxWorkingTurns: 6,
    goal: "Demo tutorial run",
  }),
  policy: new DefaultPolicyEngine(),
  eventSink: new MemoryEventSink(),
});

const state = await runtime.run("default", "hello microHarnesses", {
  maxIterations: 4,
  snapshotEvery: 1,
  profile: { defaultModel: "demo-model" },
});

console.log(state.turns.at(-1)?.assistantMessage ?? "No response");
```

## 3. Add scripts

In `package.json`:

```json
{
  "type": "module",
  "scripts": {
    "build": "tsc",
    "start": "node dist/main.js"
  }
}
```

## 4. Run it

```bash
npm run build
npm run start
```

Expected output:

```text
Done. I echoed your prompt using a plugin tool.
```

## 5. Expand the sample

Next improvements:

- Replace `DemoModel` with `ProviderModelAdapter` + provider registries.
- Add `PluginHost` and register `@micro-harness/plugin-basic-tools` and `@micro-harness/plugin-plan-mode`.
- Add `SessionStore` for durable runs and snapshots.
- Add approval handling and command safety rules for high-risk tools.
