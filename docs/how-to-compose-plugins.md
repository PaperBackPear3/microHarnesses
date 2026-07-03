# How to compose plugins

microHarnesses uses plugins to extend behavior without changing core runtime code.

## 1. What plugins can register

Plugins can register one or more capabilities through `PluginApi`, including:

- tools
- providers
- credentials resolvers
- policy rules
- model selector
- hooks
- compressor
- subagents

## 2. Use built-in plugins in the reference composition

The CLI composition (`apps/cli/src/composition.ts`) wires common defaults:

- provider plugins (OpenAI, Anthropic, Ollama)
- basic tools plugin
- subagents plugin
- plan mode plugin

## 3. Load an extra plugin

```bash
npm run cli:run -- "use my custom tool" \
  --plugins ./path/to/my-plugin.mjs \
  --provider openai --model gpt-4.1-mini
```

The plugin file should export either:

- `default` export with a `HarnessPlugin`, or
- named export `plugin`.

## 4. Minimal plugin example

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
