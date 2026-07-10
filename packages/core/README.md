# @micro-harnesses/core

Package-first reusable runtime library building block for `microHarnesses`.

## Latest updates

- Core now ships `InProcessSubagentSupervisor` plus default
  `spawn_subagent`/`wait_subagents` tools for deterministic async delegation and
  model-facing join behavior.
- Core also includes declarative agents, MCP tool wrapping, model routing,
  provider-aware token counting, OpenAI/Anthropic/Ollama providers, channels,
  filesystem skills, tool-output artifacts, and agentic compression.

## What's inside

- **Agent loop** — `Agent` iterates model → tools → hooks
- **Tool registry & execution engine** — `ToolRegistry`, `ActionExecutionEngine` with per-tool policy check, timeout, and abort
- **Sessions & context** — `SessionStore` (append-only events + periodic snapshots + support history), `ContextManager` (trim + compress overflowed turns)
- **Policy engine** — `DefaultPolicyEngine` + `CompositePolicyEngine` with `PolicyRule` composition (most-restrictive-wins)
- **Command-safety rule** — `createCommandSafetyRule()` screens tool inputs annotated with `{ field, kind: "shell_command" | "file_path" }`; heuristic fallback for tools matching `/bash|shell|exec|cmd/i`
- **Approval seam** — `AgentOptions.approvalHandler` + `action.approval_requested / approved / denied` events
- **Provider & credentials registries** — `ProviderRegistry`, `CredentialsRegistry`, `ProviderModelAdapter`
- **Built-in providers** — OpenAI, Anthropic, Ollama, and generic OpenAI-compatible endpoints
- **Model routing** — `DefaultModelRouter`, route catalogs, live discovery, pricing/context metadata, `list_model_routes`
- **State-machine orchestration** — optional run-level flow machine (`llm`/`action`/`terminal`) that can constrain actions and drive focused session progression
- **Prompt source** — `FsPromptSource` (Markdown-based prompt packs)
- **Declarative agents** — `defineAgent()`, `defineAgentAsync()`, `promptFromFile()`
- **MCP** — stdio/HTTP `McpClient` and `createMcpToolset()`
- **Skills and channels** — `FsSkillSource`, `SkillRegistry`, `ChannelRegistry`, `channel_list`, `channel_send`
- **Plugin host** — `PluginHost` with capability enforcement; `PluginLoader` for dynamic loading
- **Subagent primitives** — `InProcessSubagentRunner` runs blocking children; `InProcessSubagentSupervisor` tracks async children and deterministic waits

## Install

```bash
npm install @micro-harnesses/core
```

## Seams

The runtime accepts these dependencies at construction:

```ts
new Agent({
  promptName,         // prompt-pack persona this agent runs
  model,              // ModelAdapter
  modelSelector,      // ModelSelector
  prompts,            // PromptSource
  tools,              // ToolRegistry
  context,            // ContextManager
  policy,             // ToolPolicyEngine
  observability,      // ObservabilityProvider (optional; traces + metrics + logs + live stream)
  sessionStore,       // SessionStore   (optional)
  limits,             // RuntimeLimits  (optional)
  approvalHandler,    // ApprovalHandler (optional)
});
```

Every field is an interface — swap any implementation. Most users compose
`CompositePolicyEngine` + `PolicyRule`s rather than replacing the policy
engine wholesale.

### Optional state-machine run control

Use `RunOptions.stateMachine` to have the runtime govern the full loop with
explicit states. The built-in profile `"focused-delivery"` defaults to advisory
enforcement and can be set to strict.

```ts
await agent.run("implement feature X", {
  maxIterations: 16,
  snapshotEvery: 2,
  profile: { defaultModel: "gpt-5.4" },
  stateMachine: {
    profile: "focused-delivery",
    enforcement: "advisory", // or "strict"
  },
});
```

## Observability

The runtime emits OpenTelemetry-shaped **traces**, **metrics**, and **logs**
through a zero-dependency `ObservabilityProvider`, plus a latency-sensitive
`StreamSink` for live UI progress. Build one with `createObservability({ ... })`
(or the `DefaultObservabilityProvider`), passing exporters:

```ts
const memory = new InMemoryObservabilityExporter();
const observability = createObservability({
  resource: { serviceName: "my-app", serviceVersion: "1.0.0" },
  traceExporters: [memory],
  metricExporters: [memory],
  logExporters: [memory],
  // Redaction: capture content by default; flip privacyMode to drop
  // prompt/reasoning/tool payloads entirely.
  redaction: { privacyMode: false },
  // Deterministic sampling (default AlwaysOn):
  // sampler: new TraceIdRatioSampler(0.1),
});
```

The runtime traces a span tree of `run → iteration → { context, model, tool,
skill }`, records metrics (token usage, tool/skill durations and outcomes,
context-window utilization — used/free/max/utilization tokens, error counters),
and structured logs. Concrete OpenTelemetry/OTLP exporters ship as plugins via
the `"observability"` plugin capability. Omit `observability` to get a
zero-overhead no-op provider. For a ready-to-use OTLP/Prometheus bridge plugin,
see `@micro-harnesses/plugin-observability-otel`.

## `FsPromptSource` prompt-pack format

`FsPromptSource` loads prompts from:

`<rootDir>/<promptName>/`

Required file:

- `system.md`

Optional files:

- `developer.md`
- `tools.md`
- any extra section file you configure through `sections` (for example `constraints.md`)

Optional metadata file:

- `prompt.meta.json` (`name`, `modelHint`, `taskTypeHint`, `safetyMode`, `tags`)

Default behavior:

- `sections` defaults to `["developer", "tools"]`
- missing optional section files are skipped
- role mapping:
  - section `"developer"` -> instruction role `"developer"`
  - section `"tools"` -> instruction role `"tools"`
  - any other section name -> instruction role `"custom"` (with `name` set to section name)

Example:

```ts
const prompts = new FsPromptSource({
  rootDir: path.resolve("prompts"),
  sections: ["developer", "tools", "constraints", "examples"],
});
```

For agent `code-review`, this resolves:

- `prompts/code-review/system.md` (required)
- `prompts/code-review/developer.md` (optional)
- `prompts/code-review/tools.md` (optional)
- `prompts/code-review/constraints.md` (optional, custom role)
- `prompts/code-review/examples.md` (optional, custom role)

## Core defaults: capabilities-first composition

Core exposes provider/tool management primitives and optional built-ins.
You choose what to register:

```ts
import {
  createCoreDefaultTools,
  registerCoreDefaults,
  ToolRegistry,
  ProviderRegistry,
  CredentialsRegistry,
} from "@micro-harnesses/core";

registerCoreDefaults({
  providerRegistry,
  credentialsRegistry,
  toolRegistry,
  // built-in providers enabled by default (OpenAI/Anthropic/Ollama)
  includeBuiltInProviders: true,
  // explicit tool set owned by the composition root
  tools: createCoreDefaultTools({
    workspaceTools: { rootDir: process.cwd() },
    subagents: subagentSupervisor,
  }),
  hookRegistrar: {
    onBeforeLoop: (hook) => runtime.addBeforeHook(hook),
    onAfterLoop: (hook) => runtime.addAfterHook(hook),
  },
  beforeHooks: [
    async (state, iteration) => {
      // composition-owned hook behavior
    },
  ],
  afterHooks: [],
});
```

Custom providers are registered by passing `{ adapter, credentials }` entries
to `providers`. Custom tools are registered by passing `tools`. Native loop
hooks can be registered through `beforeHooks` / `afterHooks` when
`hookRegistrar` is provided by the composition root.

When `createCoreDefaultTools` receives a `SubagentSupervisor`, it registers:

- `spawn_subagent` — launches a tracked child and returns a handle immediately.
  The tool accepts a display `name` (UI label) and a `promptName` (installed
  prompt-pack persona) as separate inputs.
- `wait_subagents` — waits for the next completed child by default, or all
  selected running children with `mode: "all"`, returning completed summaries
  plus the remaining running subagents.

The blocking `SubagentRunner.run` contract remains available for plugins and
composition code that need an immediate child result.

## Declarative agent shortcut

```ts
import { createCoreDefaultTools, defineAgent, promptFromFile } from "@micro-harnesses/core";

const agent = defineAgent({
  name: "coder",
  role: "concise software engineering assistant",
  prompt: promptFromFile("prompts/coder.md", {
    variables: { project: "my-app" },
  }),
  model: { providerId: "openai" },
  tools: createCoreDefaultTools({
    workspaceTools: { rootDir: process.cwd() },
  }),
});
```

Use `defineAgentAsync()` when `mcp` servers are configured; discovered tools are
registered as `mcp__<server>__<tool>`.

## Model routing

Routing is opt-in. Provide `Agent.setModelRouting(...)` with a router and route
catalog to choose a provider/model route per run. `DefaultModelRouter` supports
`auto`, `cost`, `speed`, `intelligence`, and `balanced` preferences. The
`list_model_routes` default tool exposes the same catalog to models.

## Command-safety rule

The included rule is **best-effort screening, not a sandbox**. The starter
ruleset in `policy/safety/defaultRules.ts` covers common dangerous patterns
(sudo/doas, `rm -rf` variants, `dd of=/dev/`, `mkfs`, `curl|sh`, fork bombs,
`chmod 777`, secret exfil, workspace-escape paths, …) and is **deliberately
non-exhaustive** — add rules for your threat model via
`compositeEngine.addRule(...)`.

Severity × `safetyMode` mapping:

| severity | strict | balanced | open |
|---|---|---|---|
| critical | deny | deny | require_approval |
| high | deny | require_approval | require_approval |
| medium | require_approval | require_approval | allow |

## Plugin capabilities

Plugins declare which surfaces they use:

`"tools" | "hooks" | "compressor" | "providers" | "credentials" | "policy" | "model-selector" | "channels" | "skills" | "agents" | "observability"`

The host throws `PluginCapabilityError` when a plugin uses an undeclared
surface.

## Further reading

- [Concepts and decision guide](../../docs/concepts-and-decision-guide.md)
- [Runtime interfaces reference](../../docs/reference-runtime-interfaces.md)
- [How runtime works](../../docs/how-runtime-works.md)

## License

MIT
