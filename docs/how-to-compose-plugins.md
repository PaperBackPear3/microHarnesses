# Composing plugins

Plugins are the extension model for the package ecosystem.

Compose plugins in your own app's composition root to extend behavior without changing core runtime code.

## What plugins can register

- tools
- providers
- credentials resolvers
- policy rules
- model selector
- hooks
- compressor
- channels
- skills
- agents
- tool-governance

## Where composition lives

Architecture belongs in packages; your app wires those packages together.

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
