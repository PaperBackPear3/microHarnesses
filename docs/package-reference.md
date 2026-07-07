# Package reference and concepts

This page documents package functionality and the concepts each package is responsible for.

## `@micro-harnesses/core`

**Role**: reusable runtime library.

### Main capabilities

- Runtime loop (`Agent`)
- Tool/skill/channel registries and execution engines
- MCP client/tool wrapping (`createMcpToolset`) for stdio and HTTP servers
- Filesystem skills (`FsSkillSource`: `SKILL.md` + optional `skill.meta.json` bundles loaded as executable skills)
- Declarative agents (`defineAgent`, `defineAgentAsync`, `promptFromFile`) with inline/file prompts, built-in providers, skills, subagents, and MCP
- Harness modes (`HarnessMode`, `ModeController`, mode-aware approval policy, autopilot execution contract)
- Core default tools (`tool_output_read`, read-only workspace tools, `plan_agent`, `explore_agent`, `plan_mode_info`, channel tools, `spawn_subagent`, `wait_subagents`, `list_model_routes`) via `createCoreDefaultTools(...)`
- Context + session persistence (`ContextManager`, `SessionStore`)
- Policy model (`DefaultPolicyEngine`, `CompositePolicyEngine`, `PolicyRule`)
- Plugin host + capability enforcement (`PluginHost`)
- Provider + credentials registries, built-in adapters (OpenAI, Anthropic, Ollama) and the generic `OpenAICompatAdapter` / `createOpenAICompatProviderPlugin` for any OpenAI-compatible endpoint
- Provider-aware token counting (`ProviderAdapter.createTokenCounter`) with runtime calibration from observed model usage
- Model selection and routing (`DefaultModelSelector`, `EffortModelSelector`, `DefaultModelRouter`, `ModelRoute` catalog, default provider model profiles, live discovery, known pricing/context metadata, Ollama context-window detection)
- Subagent primitives (`InProcessSubagentRunner`, `InProcessSubagentSupervisor`)
- Compression primitives (`defaultCompressor`, `createAgenticCompressor`) for heuristic or subagent-driven context compression
- Observability (`createObservability`, in-memory/console/jsonl exporters, token counters, stream sink, trace/metric/log APIs)

### Concepts

- **Interfaces first**: model, prompts, policy, session, tools are all replaceable seams.
- **Capability boundaries**: plugin APIs are guarded by declared capabilities.
- **Most restrictive wins**: policy composition can only increase restrictions.
- **Prompt pack convention**: `FsPromptSource` uses `<rootDir>/<promptName>/system.md` plus optional sections (`developer`, `tools`, and custom sections).
- **Declarative composition**: `defineAgent()` is the lowest-boilerplate path for package consumers; `defineAgentAsync()` adds MCP setup.
- **Deterministic subagent wait**: the supervisor tracks launch order, completion
  order, failures, aborts, and remaining running children; default tools expose
  this as `spawn_subagent` plus `wait_subagents`.
- **Agentic compression**: `createAgenticCompressor` spawns summarizer and
  goal-finder subagents with no tools, then falls back to deterministic
  compression if subagent execution fails.
- **Model route transparency**: `list_model_routes` exposes the same in-memory
  catalog used by routing and CLI model lists.

---

## `@micro-harnesses/plugin-basic-tools`

**Role**: workspace-scoped mutation and shell tools.

### Tools

- `fs_write`
- `fs_append`
- `fs_mkdir`
- `fs_move`
- `fs_remove`
- `shell_exec`

### Concepts

- **Workspace confinement** via root directory resolution.
- **Bounded execution** for shell calls (timeout, output caps, abort support).
- **High-risk classification** so policy engines can gate mutation/command tools.

---

## `@micro-harnesses/plugin-example-tools`

**Role**: minimal reference plugin for tool and channel authors.

### Tools

- `echo`
- `time`

### Channels

- `ExampleWebhookChannelPlugin` / `exampleWebhookChannelPlugin` registers a
  reference webhook-backed `ChannelAdapter` using `MH_EXAMPLE_WEBHOOK_URL` or an
  explicit `endpointUrl`.

### Concepts

- **Authoring template**: smallest complete plugin shape.
- **Low-risk tool definition**: simple schemas and deterministic outputs.
- **Channel plugin template**: smallest complete `"channels"` capability plugin.

---

## `@micro-harnesses/cli`

**Role**: agentic coding CLI built on core.

### Concepts

- **Thin composition root**: wires core registries, plugins, providers, modes, skills, and observability in `runtime/composition.ts`.
- **TUI ownership**: Ink rendering, keybindings, slash commands, interactive approval prompts, and status display stay in the app.
- **Version visibility**: running CLI version is exposed in both `--version` output and the TUI footer/help view.
- **Routing controls**: `/route` and `--routing-preference` opt into catalog-based model routing; `/model` lists routes across configured providers.

## Composition recommendation

Keep core generic and stable, then package environment-specific behavior into plugins. This preserves reuse and makes safety posture explicit in your composition root.
