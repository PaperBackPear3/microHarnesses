# Copilot Instructions for `microHarnesses`

## Build, run, and validation commands

Use npm scripts from the root `package.json`:

- Build all workspaces: `npm run build`
- Run all tests (builds first): `npm test`
- Run a single compiled test file: `node --test packages/core/dist/runtime/agent.test.js`
- Lint: `npm run lint` (Biome)
- Format: `npm run format`

## High-level architecture

Composable, plugin-first library:

- `packages/core` — `@micro-harnesses/core` (agent loop, tools, sessions/context, policy, harness modes, provider adapters, skills, subagent primitive; zero runtime deps)
- `plugins/basic-tools` — workspace-scoped mutation + shell tools
- `plugins/plan-mode` — read-only planning + exploration tools
- `plugins/agentic-compression` — subagent-driven context compression
- `plugins/example-tools` — reference `echo` / `time` tools
- `apps/cli` — `@micro-harnesses/cli`, a thin composition + Ink TUI layer over core

### Runtime loop (`packages/core/src/runtime/agent.ts`)

Per iteration:
1. Run before-hooks
2. Build working turns via `ContextManager.buildWorkingTurns`
3. Select model via `ModelSelector`
4. Ask `ModelAdapter.nextStep` for a `StepPlan`
5. Execute tool calls via `ActionExecutionEngine`, which:
   - Evaluates `ToolPolicyEngine.evaluate`
   - On `require_approval`, awaits `approvalHandler` (missing → blocked)
   - Applies timeout via `withTimeout`, honoring `AbortSignal`
6. Append the resulting `Turn`
7. Snapshot to `SessionStore` per `snapshotEvery`
8. Run after-hooks
9. Stop when `step.stop === true` or limits are exceeded

### Domain layout

Each domain owns its own `types.ts`:

- `shared/` — errors, isNodeError, safeResolve/resolveWorkspacePath/relativeToRoot, truncate, inputParsing (readRequiredString/readOptional*/clampNumber/normalizeStringList — reused by plugins)
- `tools/` — types (incl. ToolResolver), registry, descriptors
- `actions/` — executionEngine (`ActionExecutionEngine`: governs tools + skills)
- `policy/` — types, defaultPolicyEngine, compositePolicyEngine, safety/{commandNormalizer,defaultRules,commandSafetyRule}
- `providers/` — types, registry, credentialsRegistry
- `model/` — types, defaultModelSelector, effortModelSelector (`EffortLevel`/`EffortModelSelector`), providerModelAdapter (static or dynamic `selection` getter)
- `prompts/` — types, fsPromptSource
- `skills/` — types, registry, asTool, fsSkillSource (loads executable skills from `<root>/<name>/SKILL.md` + optional `skill.meta.json`; prompt-expansion model)
- `context/` — types, manager, defaultCompressor
- `session/` — types, sessionStore
- `observability/` — types, provider (`ObservabilityProvider`/`createObservability`), tracer, metrics, logger, sampler, redaction, tokenCounter, in-memory/console/jsonl exporters (zero-dep, OTel-shaped traces + metrics + logs + `StreamSink`)
- `runtime/` — types, state (`Turn`/`RunState`), agent (`Agent` class), modes (`HarnessMode`/`ModeController`/`createModeAwareApprovalPolicy`/`withModeExecutionContract`), runObserver (`RunObserver`: run/iteration/model/action span tree + metrics + logs + stream), snapshotCadence
- `subagents/` — types, inProcessSubagentRunner
- `plugins/` — types, host, loader
- `defaults/` — registerCoreDefaults, createCoreDefaultTools, read-only workspace tools, providers/ (`OpenAICompatAdapter` + OpenAI/Anthropic/Ollama presets, `createOpenAICompatProviderPlugin`, `EnvCredentials`, model profiles, Ollama context-window detection)

### Plugin API (widened, capability-enforced)

```ts
interface PluginApi {
  registerTool(tool);
  onBeforeLoop(hook); onAfterLoop(hook);
  setCompressor(fn);
  registerProvider(adapter);
  registerCredentialsResolver(providerId, resolver);
  registerPolicyRule(rule);       // composed by CompositePolicyEngine (most-restrictive-wins)
  setModelSelector(selector);
  observability: {                // read tracer/meter/logger + register span/metric/log exporters
    tracer; meter; logger;
    registerTraceExporter(e); registerMetricExporter(e); registerLogExporter(e);
  };
  agents: { spawn(opts): Promise<SubagentResult>; invoke(req): Promise<AgentRunResult> };
}
```

Every `HarnessPlugin` must declare `capabilities: PluginCapability[]`.
Capabilities: `"tools" | "hooks" | "compressor" | "providers" | "credentials" | "policy" | "model-selector" | "channels" | "skills" | "agents" | "observability"`.
The `PluginHost` throws `PluginCapabilityError` when a plugin uses an
undeclared surface.

### Safety

`policy/safety/commandSafetyRule.ts` is a `PolicyRule` that screens tool
inputs annotated with `{ field, kind: "shell_command" | "file_path" }`
(heuristic fallback for tools matching `/bash|shell|exec|cmd/i`). The
starter ruleset (`defaultRules.ts`) covers common patterns but is **not
exhaustive** — treat it as screening, not a sandbox. The `normalizeCommand`
helper strips backslash / quote splices before matching.

### Subagents

`InProcessSubagentRunner` runs children in-process and blocks for the final
summary. `InProcessSubagentSupervisor` uses the same `SubagentRuntimeFactory`
but tracks async child handles, completion/failure state, abort propagation, and
deterministic waits. When a supervisor is passed to `createCoreDefaultTools`,
models get `spawn_subagent` plus `wait_subagents`; the CLI `/wait` command is a
user-facing wait-all alias over the same supervisor state.

## Key conventions

- Keep contracts in per-domain `types.ts`; new subsystems reuse existing interfaces before adding new shapes.
- Treat `packages/core` as runtime library code; keep app-specific behavior outside core.
- Add harness features via plugins whenever possible.
- Errors are explicit: unknown tools, invalid plugins, and mis-declared capabilities throw typed errors (`UnknownToolError`, `PluginLoadError`, `PluginCapabilityError`, …); tool execution failures are recorded as `{ ok: false, error }` in turn results.
- Safety defaults: `DefaultPolicyEngine` denies high-risk tools; `CommandSafetyRule` adds command-shape screening in strict/balanced modes.
- CLI output for `run` and `sessions show` is JSON — preserve the machine-readable shape.
- State persistence is filesystem-based, relative to `--state-dir` (default `.micro-harness` in CWD).
- Cross-package deps use `peerDependencies` (semver ranges) so plugin packages don't duplicate core when installed by users.
- Generic harness capabilities (modes, model selection, provider adapters, context-window heuristics) live in core; the CLI only composes them and owns TUI concerns (Ink rendering, keybindings, interactive approval prompts, status bar).
- Providers: prefer `createOpenAICompatProviderPlugin` for new OpenAI-compatible endpoints instead of writing a bespoke adapter.
- In the CLI TUI, keep input anchored at terminal bottom; render mode/model/context/usage in footer lines below input rather than inline with the composer.
- For autopilot flows, prefer prompts/instructions that continue autonomously until the goal is actually complete (not just “next step announced”).
