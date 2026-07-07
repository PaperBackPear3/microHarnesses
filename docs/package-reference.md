# Package reference and concepts

This page documents package functionality and the concepts each package is responsible for.

## `@micro-harnesses/core`

**Role**: reusable runtime library.

### Main capabilities

- Runtime loop (`Agent`)
- Tool/skill/channel registries and execution engines
- Filesystem skills (`FsSkillSource`: `SKILL.md` + optional `skill.meta.json` bundles loaded as executable skills)
- Harness modes (`HarnessMode`, `ModeController`, mode-aware approval policy, autopilot execution contract)
- Core read-only planning tools (`plan_agent`, `explore_agent`, `plan_mode_info`) via `createCoreDefaultTools({ planModeTools: ... })`
- Context + session persistence (`ContextManager`, `SessionStore`)
- Policy model (`DefaultPolicyEngine`, `CompositePolicyEngine`, `PolicyRule`)
- Plugin host + capability enforcement (`PluginHost`)
- Provider + credentials registries, built-in adapters (OpenAI, Anthropic, Ollama) and the generic `OpenAICompatAdapter` / `createOpenAICompatProviderPlugin` for any OpenAI-compatible endpoint
- Provider-aware token counting (`ProviderAdapter.createTokenCounter`) with runtime calibration from observed model usage
- Model selection (`DefaultModelSelector`, `EffortModelSelector`, default provider model profiles, Ollama context-window detection)
- Subagent primitives (`InProcessSubagentRunner`, `InProcessSubagentSupervisor`)
- Compression primitives (`defaultCompressor`, `createAgenticCompressor`) for heuristic or subagent-driven context compression

### Concepts

- **Interfaces first**: model, prompts, policy, session, tools are all replaceable seams.
- **Capability boundaries**: plugin APIs are guarded by declared capabilities.
- **Most restrictive wins**: policy composition can only increase restrictions.
- **Prompt pack convention**: `FsPromptSource` uses `<rootDir>/<promptName>/system.md` plus optional sections (`developer`, `tools`, and custom sections).
- **Deterministic subagent wait**: the supervisor tracks launch order, completion
  order, failures, aborts, and remaining running children; default tools expose
  this as `spawn_subagent` plus `wait_subagents`.
- **Agentic compression**: `createAgenticCompressor` spawns summarizer and
  goal-finder subagents with no tools, then falls back to deterministic
  compression if subagent execution fails.

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

**Role**: minimal reference plugin for authors.

### Tools

- `echo`
- `time`

### Concepts

- **Authoring template**: smallest complete plugin shape.
- **Low-risk tool definition**: simple schemas and deterministic outputs.

---

## `@micro-harnesses/cli`

**Role**: agentic coding CLI built on core.

### Concepts

- **Thin composition root**: wires core registries, plugins, providers, modes, skills, and observability in `runtime/composition.ts`.
- **TUI ownership**: Ink rendering, keybindings, slash commands, interactive approval prompts, and status display stay in the app.
- **Version visibility**: running CLI version is exposed in both `--version` output and the TUI footer/help view.

## Composition recommendation

Keep core generic and stable, then package environment-specific behavior into plugins. This preserves reuse and makes safety posture explicit in your composition root.
