# Composing plugins

Plugins extend behavior without changing core runtime code. Register capabilities through `PluginApi`.

## What plugins can register

- tools
- providers
- credentials resolvers
- policy rules
- model selector
- hooks
- compressor
- subagents

## Use built-in plugins

The CLI composition (`apps/cli/src/composition.ts`) wires common defaults:

- provider plugins (OpenAI, Anthropic, Ollama)
- basic tools plugin
- subagents plugin
- plan mode plugin

## Load an extra plugin

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
