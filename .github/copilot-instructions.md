# Copilot Instructions for `microHarnesses`

## Build, run, and validation commands

Use npm scripts from the root `package.json`:

- Build all workspaces: `npm run build`
- Run all tests (builds first): `npm test`
- Run a single compiled test file: `node --test packages/core/dist/runtime/runtime.test.js`
- Lint: `npm run lint` (Biome)
- Format: `npm run format`

## High-level architecture

Composable, plugin-first library:

- `packages/core` — `@micro-harness/core` (agent loop, tools, sessions/context, policy, subagent primitive; zero runtime deps)
- `plugins/plan-mode` — read-only planning + exploration tools
- `plugins/example-tools` — reference `echo` / `time` tools

### Runtime loop (`packages/core/src/runtime/runtime.ts`)

Per iteration:
1. Run before-hooks
2. Build working turns via `ContextManager.buildWorkingTurns`
3. Select model via `ModelSelector`
4. Ask `ModelAdapter.nextStep` for a `StepPlan`
5. Execute tool calls via `ToolExecutionEngine`, which:
   - Evaluates `ToolPolicyEngine.evaluate`
   - On `require_approval`, awaits `approvalHandler` (missing → blocked)
   - Applies timeout via `withTimeout`, honoring `AbortSignal`
6. Append the resulting `Turn`
7. Snapshot to `SessionStore` per `snapshotEvery`
8. Run after-hooks
9. Stop when `step.stop === true` or limits are exceeded

### Domain layout

Each domain owns its own `types.ts`:

- `shared/` — errors, isNodeError, safeResolve, truncate
- `tools/` — types, registry, executionEngine
- `policy/` — types, defaultPolicyEngine, compositePolicyEngine, safety/{commandNormalizer,defaultRules,commandSafetyRule}
- `providers/` — types, registry, credentialsRegistry
- `model/` — types, defaultModelSelector, providerModelAdapter
- `prompts/` — types, fsPromptSource
- `context/` — types, manager, defaultCompressor
- `session/` — types, sessionStore
- `events/` — types, memoryEventSink
- `runtime/` — types, runtime, runEmitter, snapshotCadence
- `subagents/` — types, inProcessSubagentRunner
- `plugins/` — types, host, loader

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
  agents: { spawn(opts): Promise<SubagentResult>; invoke(req): Promise<AgentRunResult> };
}
```

Every `HarnessPlugin` must declare `capabilities: PluginCapability[]`.
Capabilities: `"tools" | "hooks" | "compressor" | "providers" | "credentials" | "policy" | "model-selector" | "channels" | "skills" | "agents" | "tool-governance"`.
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

`InProcessSubagentRunner` (built from a `SubagentRuntimeFactory` in
composition) runs children in-process. A typical factory uses filtered
`ToolRegistry`, fresh `ContextManager`, nested session
(`sessions/<parent>/subagents/<child>/`), `AbortSignal` propagation.
`spawn_subagent` can be exposed to models by registering the core default tool.

## Key conventions

- Keep contracts in per-domain `types.ts`; new subsystems reuse existing interfaces before adding new shapes.
- Treat `packages/core` as runtime library code; keep app-specific behavior outside core.
- Add harness features via plugins whenever possible.
- Errors are explicit: unknown tools, invalid plugins, and mis-declared capabilities throw typed errors (`UnknownToolError`, `PluginLoadError`, `PluginCapabilityError`, …); tool execution failures are recorded as `{ ok: false, error }` in turn results.
- Safety defaults: `DefaultPolicyEngine` denies high-risk tools; `CommandSafetyRule` adds command-shape screening in strict/balanced modes.
- CLI output for `run` and `sessions show` is JSON — preserve the machine-readable shape.
- State persistence is filesystem-based, relative to `--state-dir` (default `.micro-harness` in CWD).
- Cross-package deps use `peerDependencies` (semver ranges) so plugin packages don't duplicate core when installed by users.
