# Copilot Instructions for `microHarnesses`

## Build, run, and validation commands

Use npm scripts from `package.json`:

- Build TypeScript: `npm run build`
- Run harness (build + run): `npm run run -- "tool:echo hello time spawn:analyze this"`
- Start default command (build + run): `npm start`
- List checkpoints (build + run): `npm run checkpoints:list`

Current repo state:

- There is **no test script** yet.
- There is **no lint script** yet.
- There is no single-test command yet because no test runner is configured.

## High-level architecture

This project is a tiny CLI-first runtime with explicit extension points.

1. `src/cli.ts` is the composition root.
   - Parses `run` and `checkpoints` commands.
   - Wires `ToolRegistry`, `ContextManager`, `HarnessRuntime`, `LocalProcessSpawner`, and model adapter.
   - Loads optional plugins via `--plugins`.

2. `src/core/runtime.ts` is the orchestration engine.
   - Loop order per iteration:
     1. Run before-hooks.
     2. Build working context.
     3. Ask model for `StepPlan`.
     4. Execute tool calls.
     5. If `StepPlan` requests a child agent, spawn it via `LocalProcessSpawner`.
     6. Append turn.
     7. Write checkpoint.
     8. Run after-hooks.
     9. If `StepPlan.stop` is true, exit loop.
   - Plugins register through runtime-provided API hooks.

3. `src/context/manager.ts` owns context trimming and persistence.
   - Keeps only the last `maxWorkingTurns` in memory for model input.
   - Compresses overflow turns into summary files under `<stateDir>/summaries`.
   - Stores checkpoints under `<stateDir>/checkpoints` with full `HarnessState`.

4. `src/tools/*` and `src/tools/registry.ts` implement tool execution.
   - Tools are registered once by unique name.
   - Runtime resolves tool calls by name and records success/failure per call in `Turn.toolResults`.

5. `src/agents/localSpawner.ts` + `src/agents/worker.ts` implement local child-agent execution.
   - Spawner writes JSON input/output in a temp directory and starts worker with `node`.
   - Worker follows file-based contract: read input JSON, write output JSON (or error JSON).

6. `src/plugins/loader.ts` loads plugins dynamically by path.
   - Accepts `default` or `plugin` export.
   - Requires `name` + `register(api)` shape (see `HarnessPlugin` in `src/core/types.ts`).

## Key codebase conventions

- Keep contracts centralized in `src/core/types.ts`; new subsystems should reuse these interfaces before introducing new shapes.
- Never modify loop internals in `src/core/runtime.ts` to add features. All feature additions must go through the plugin hooks (`registerTool`, `onBeforeLoop`, `onAfterLoop`, `setCompressor`).
- If a required hook is absent from the plugin API, add it to `HarnessPlugin` in `src/core/types.ts` and wire the call site in `src/core/runtime.ts` before implementing the feature. Do not add hook call sites in any file other than `src/core/runtime.ts`.
- Error behavior is explicit: unknown tools and invalid plugins throw; tool execution failures are recorded as `{ ok: false, error }` in turn results rather than silently ignored.
- CLI output for `run` and `checkpoints show` is JSON; preserve this machine-readable output shape.
- State persistence is filesystem-based and relative to `--state-dir` (default `.micro-harness` in CWD); do not hardcode absolute paths.
