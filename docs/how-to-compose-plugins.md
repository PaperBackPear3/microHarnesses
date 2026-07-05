# Composing plugins

Plugins are the extension model for the package ecosystem.

Compose plugins in your own app's composition root (or in `apps/cli` as a reference example) to extend behavior without changing core runtime code.

## What plugins can register

- tools
- providers
- credentials resolvers
- policy rules
- model selector
- hooks
- compressor
- subagents

## Where composition lives

Architecture belongs in packages; your app wires those packages together.

In this repository, `apps/cli/src/composition.ts` is a reference composition that wires common defaults:

- provider plugins (OpenAI, Anthropic, Ollama)
- basic tools plugin
- subagents plugin
- plan mode plugin

## Load an extra plugin (reference CLI example)

```bash
npm run cli:run -- "use my custom tool" \
  --plugins ./path/to/my-plugin.mjs \
  --provider openai --model gpt-4.1-mini
```

The plugin file should export either:

- `default` export with a `HarnessPlugin`, or
- named export `plugin`.

## Minimal plugin example

```ts
import type { HarnessPlugin, PluginApi } from "@micro-harness/core";

export const myPlugin: HarnessPlugin = {
  name: "my-plugin",
  capabilities: ["tools"],
  register(api: PluginApi) {
    api.registerTool({
      name: "upper",
      description: "Uppercases text",
      risk: "low",
      async execute(input) {
        return { text: String(input.text ?? "").toUpperCase() };
      },
    });
  },
};
```
