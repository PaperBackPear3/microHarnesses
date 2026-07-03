# Copilot Instructions for `microHarnesses`

## Build, run, and validation commands

Use npm scripts from the root `package.json`:

- Build TypeScript: `npm run build`
- Run core tests: `npm test`
- Run a single compiled test file: `node --test packages/core/dist/runtime/runtime.test.js`
- Run harness (build + run): `npm run cli:run -- "summarize this task" --agent default --provider openai`
- Run harness locally via Ollama: `npm run cli:run -- "small local task" --agent default --provider ollama --model llama3.2:3b`
- Start default command (build + run): `npm start`
- List checkpoints (build + run): `npm run checkpoints:list`
- Show checkpoint: `node apps/cli/dist/index.js checkpoints show <checkpoint-id>`
- Delete checkpoint: `node apps/cli/dist/index.js checkpoints delete <checkpoint-id>`
- List sessions: `node apps/cli/dist/index.js sessions list`
- Show session: `node apps/cli/dist/index.js sessions show <session-id>`
- Resume session: `node apps/cli/dist/index.js sessions resume <session-id> "continue task"`

Current repo state:

- Tests exist for `@micro-harness/core` using Node's built-in test runner.
- There is **no lint script** yet.

## High-level architecture

This project is now library-first with a reference CLI:
- `packages/core`: reusable harness library (`@micro-harness/core`)
- `apps/cli`: reference consumer of the library

1. `apps/cli/src/index.ts` is the CLI composition root.
   - Parses `run` and `checkpoints` commands.
   - Wires prompt source, provider registry/adapters, model adapter, policy engine, and runtime.
   - Loads optional plugins via `--plugins`.

2. `packages/core/src/runtime/runtime.ts` is the orchestration engine.
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
   - Emits execution events and enforces tool policy decisions before tool execution.
   - Plugins register through runtime-provided API hooks.

3. `packages/core/src/prompts/fsPromptSource.ts` loads prompt packs.
   - Convention: `<prompts-dir>/<agent>/system.md` required; additional markdown sections are configurable (defaults include `developer.md` and `tools.md`), plus optional `prompt.meta.json`.
   - Frontmatter is stripped from markdown; `{{var}}` placeholders are rendered.

4. `packages/core/src/context/manager.ts` owns context trimming and persistence.
   - Keeps only the last `maxWorkingTurns` in memory for model input.
   - Compresses only newly-overflowed turns into summary files under `<stateDir>/summaries`, prioritizing recency/high-impact/goal relevance and separating support history.
   - Stores checkpoints under `<stateDir>/checkpoints` with full `HarnessState`.

5. `packages/core/src/session/sessionStore.ts` manages durable sessions.
   - Session manifest + append-only `events.jsonl` + periodic snapshots.
   - Support history is written separately to `support-history.jsonl`.

6. `packages/core/src/providers/*` implements OpenAI/Anthropic/Ollama adapters and auth resolution.
   - `EnvCredentialsResolver` reads provider keys/base URLs from environment variables.
   - Provider adapters normalize responses to shared runtime contracts.

7. `packages/core/src/tools/*` and `packages/core/src/tools/registry.ts` implement tool execution.
   - Tools are registered once by unique name.
   - Runtime resolves tool calls by name, evaluates tool policy, then records success/failure in `Turn.toolResults`.

8. `packages/core/src/agents/localSpawner.ts` + `apps/cli/src/worker.ts` implement local child-agent execution.
   - Spawner writes JSON input/output in a temp directory and starts worker with `node`.
   - Worker follows file-based contract: read input JSON, write output JSON (or error JSON).

9. `packages/core/src/plugins/loader.ts` loads plugins dynamically by path.
   - Accepts `default` or `plugin` export.
   - Requires `name` + `register(api)` shape (see `HarnessPlugin` in `packages/core/src/types.ts`).

10. `packages/plugin-plan-mode` is a distributable plugin package.
   - Exports `PlanModePlugin` and provides read-only `plan_agent` and `explore_agent` tools.

## Key codebase conventions

- Keep contracts centralized in `packages/core/src/types.ts`; new subsystems should reuse these interfaces before introducing new shapes.
- Treat `packages/core` as runtime library code; keep app-specific behavior in `apps/cli`.
- Add harness features through plugin hooks (`registerTool`, `onBeforeLoop`, `onAfterLoop`, `setCompressor`) unless the feature is explicitly runtime-level (provider/policy/context contracts).
- Error behavior is explicit: unknown tools and invalid plugins throw; tool execution failures are recorded as `{ ok: false, error }` in turn results rather than silently ignored.
- Security defaults are deny-first for high-risk tools; policy evaluation happens before execution.
- CLI output for `run` and `checkpoints show` is JSON; preserve this machine-readable output shape.
- State persistence is filesystem-based and relative to `--state-dir` (default `.micro-harness` in CWD); do not hardcode absolute paths.
