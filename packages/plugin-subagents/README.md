# @micro-harness/plugin-subagents

Exposes an in-process `spawn_subagent` tool to the model, built on
[`@micro-harness/core`](../core)'s `InProcessSubagentRunner`.
Reusable package-first plugin for embedding subagents in your own runtime.
The repository's `apps/cli` demonstrates a reference composition.

Subagents run in the same Node process (no forking). Each spawned child gets
a filtered `ToolRegistry` (`spawn_subagent` is excluded by default to bound
recursion), a fresh `ContextManager`, and a nested session
(`sessions/<parent>/subagents/<child>/`). The parent receives only the child's
final assistant message as `summary` — everything is a tool.

## Install

```bash
npm install @micro-harness/core @micro-harness/plugin-subagents
```

## Usage

The host must first wire an `InProcessSubagentRunner` into the `PluginHost`:

```ts
import {
  HarnessRuntime,
  InProcessSubagentRunner,
  PluginHost,
  type SubagentRuntimeFactory,
} from "@micro-harness/core";
import { subagentsPlugin } from "@micro-harness/plugin-subagents";

const runtime = new HarnessRuntime({ /* ... */ });

const factory: SubagentRuntimeFactory = {
  build(request, parent) {
    // build a child runtime using the parent's shared deps (see
    // apps/cli/src/composition.ts in the repo for the full reference)
    return { runtime: childRuntime, agentName, prompt: request.prompt, runOptions };
  },
};

const host = new PluginHost({
  // ...other deps
  subagents: new InProcessSubagentRunner(factory, runtime),
});

await host.register([subagentsPlugin]);
```

## `spawn_subagent` inputs

| Field | Type | Description |
|---|---|---|
| `prompt` | string | Task for the child (required) |
| `agentName` | string | Prompt pack; defaults to the parent's |
| `allowedTools` | string[] | Whitelist of tool names the child may call |
| `maxIterations` | number | Cap on child iterations (default 8, capped) |
| `goal` | string | Optional child session goal |

## Capabilities

`["tools", "subagents"]` — requires the host to have `subagents` configured.

## License

MIT
