# Composing plugins

Plugins are the primary extension mechanism in microHarnesses.

You compose plugins at your application composition root so runtime behavior stays modular and explicit.

## Capability model

Each plugin must declare the surfaces it uses:

`"tools" | "hooks" | "compressor" | "providers" | "credentials" | "policy" | "model-selector" | "channels" | "skills" | "agents" | "observability"`

`PluginHost` enforces capabilities and throws `PluginCapabilityError` when a plugin touches an undeclared surface.

## What this gives you

- Safer extension boundaries.
- Clear ownership of behavior.
- Easy reuse across apps/compositions.
- Most-restrictive policy composition when plugins add policy rules.

## Compose plugins in one place

```ts
import {
  createCoreDefaultTools,
  CompositePolicyEngine,
  DefaultPolicyEngine,
  registerCoreDefaults,
  PluginHost,
  ToolRegistry,
  ProviderRegistry,
  CredentialsRegistry,
  ChannelRegistry,
  createObservability,
} from "@micro-harnesses/core";
import { basicToolsPlugin } from "@micro-harnesses/plugin-basic-tools";

const tools = new ToolRegistry();
const providers = new ProviderRegistry();
const credentials = new CredentialsRegistry();
const policy = new CompositePolicyEngine(new DefaultPolicyEngine());
const channels = new ChannelRegistry();
const observability = createObservability();

registerCoreDefaults({
  providerRegistry: providers,
  credentialsRegistry: credentials,
  toolRegistry: tools,
  includeBuiltInProviders: false,
  tools: createCoreDefaultTools({
    workspaceTools: { rootDir: process.cwd() },
    planModeTools: { rootDir: process.cwd(), maxExploreFiles: 30, maxDepth: 6 },
    channelTools: { registry: channels },
  }),
});

const pluginHost = new PluginHost({
  tools,
  providers,
  credentials,
  policy,
  onBeforeLoop: () => {},
  onAfterLoop: () => {},
  setCompressor: () => {},
  setModelSelector: () => {},
  channels,
  observability,
  agents: {
    async spawn() {
      throw new Error("Agent service not configured");
    },
    async invoke() {
      throw new Error("Agent service not configured");
    },
  },
});

await pluginHost.register([
  basicToolsPlugin,
]);
```

## Minimal custom plugin

```ts
import type { HarnessPlugin, PluginApi } from "@micro-harnesses/core";

export const myPlugin: HarnessPlugin = {
  name: "my-plugin",
  capabilities: ["tools"],
  register(api: PluginApi) {
    api.registerTool({
      name: "upper",
      description: "Uppercases text",
      risk: "low",
      inputSchema: {
        type: "object",
        properties: { text: { type: "string" } },
        required: ["text"],
        additionalProperties: false,
      },
      async execute(input) {
        return { text: String(input.text ?? "").toUpperCase() };
      },
    });
  },
};
```

## Composition guidelines

- Keep `packages/core` generic and reusable.
- Put environment-specific behavior in plugins.
- Prefer many focused plugins over one large plugin.
- Declare only the capabilities a plugin truly needs.
- Use the `"observability"` capability for exporters/instrumentation and the
  `"channels"` capability for communication adapters.
- Prefer core provider helpers (`createOpenAICompatProviderPlugin`) over custom
  provider code for OpenAI-compatible endpoints.
