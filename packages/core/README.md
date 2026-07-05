# @micro-harness/core

Package-first reusable runtime library building block for `microHarnesses`. Zero runtime dependencies.

## What's inside

- **Agent loop** — `HarnessRuntime` iterates model → tools → hooks
- **Tool registry & execution engine** — `ToolRegistry`, `ToolExecutionEngine` with per-tool policy check, timeout, and abort
- **Sessions & context** — `SessionStore` (append-only events + periodic snapshots + support history), `ContextManager` (trim + compress overflowed turns)
- **Policy engine** — `DefaultPolicyEngine` + `CompositePolicyEngine` with `PolicyRule` composition (most-restrictive-wins)
- **Command-safety rule** — `createCommandSafetyRule()` screens tool inputs annotated with `{ field, kind: "shell_command" | "file_path" }`; heuristic fallback for tools matching `/bash|shell|exec|cmd/i`
- **Approval seam** — `RuntimeDeps.approvalHandler` + `tool.approval_requested / approved / denied` events
- **Provider & credentials registries** — `ProviderRegistry`, `CredentialsRegistry`, `ProviderModelAdapter`
- **Prompt source** — `FsPromptSource` (Markdown-based prompt packs)
- **Plugin host** — `PluginHost` with capability enforcement; `PluginLoader` for dynamic loading
- **Subagent primitive** — `InProcessSubagentRunner` runs children in-process with a filtered `ToolRegistry` and nested session

## Install

```bash
npm install @micro-harness/core
```

## Seams

The runtime accepts these dependencies at construction:

```ts
new HarnessRuntime({
  model,              // ModelAdapter
  modelSelector,      // ModelSelector
  prompts,            // PromptSource
  tools,              // ToolRegistry
  context,            // ContextManager
  policy,             // ToolPolicyEngine
  eventSink,          // EventSink
  sessionStore,       // SessionStore   (optional)
  limits,             // RuntimeLimits  (optional)
  approvalHandler,    // ApprovalHandler (optional)
});
```

Every field is an interface — swap any implementation. Most users compose
`CompositePolicyEngine` + `PolicyRule`s rather than replacing the policy
engine wholesale.

## `FsPromptSource` prompt-pack format

`FsPromptSource` loads prompts from:

`<rootDir>/<agentName>/`

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
} from "@micro-harness/core";

registerCoreDefaults({
  providerRegistry,
  credentialsRegistry,
  toolRegistry,
  // built-in providers enabled by default (OpenAI/Anthropic/Ollama)
  includeBuiltInProviders: true,
  // explicit tool set owned by the composition root
  tools: createCoreDefaultTools({
    workspaceTools: { rootDir: process.cwd() },
    subagents: subagentRunner,
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

`"tools" | "hooks" | "compressor" | "providers" | "credentials" | "policy" | "model-selector" | "channels" | "skills" | "agents" | "tool-governance"`

The host throws `PluginCapabilityError` when a plugin uses an undeclared
surface.

## Further reading

- [Concepts and decision guide](../../docs/concepts-and-decision-guide.md)
- [Runtime interfaces reference](../../docs/reference-runtime-interfaces.md)
- [How runtime works](../../docs/how-runtime-works.md)

## License

MIT
