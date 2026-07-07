# How the runtime works

This page explains the core execution model in `@micro-harnesses/core`.

## Loop lifecycle

For each iteration, `Agent` does:

1. Run before-hooks.
2. Build working turns via `ContextManager`.
3. Select model with `ModelSelector`.
4. Ask `ModelAdapter.nextStep(...)` for a `StepPlan`.
5. Route/select the model. If runtime routing is configured, `ModelRouter`
   chooses a provider/model route; otherwise `ModelSelector` chooses from the
   profile.
6. Execute skill/tool calls through execution engines.
7. Apply policy decisions (`allow`, `deny`, `require_approval`) before each tool call.
8. Append a `Turn` to runtime state.
9. Snapshot to `SessionStore` based on `snapshotEvery`.
10. Run after-hooks.

The loop stops when:

- model returns `stop: true`, or
- runtime limits are reached, or
- runtime is killed/aborted.

## Execution planes

- **Model plane**: turns prompts + context into the next step plan; can use
  static selection or explicit model routing.
- **Policy plane**: evaluates safety/governance of each tool call.
- **Execution plane**: runs tools with timeout + abort signal.
- **State plane**: persists events, turns, and snapshots.
- **Observability plane**: emits spans, metrics, logs, stream deltas, usage, and
  context-window telemetry.

## Prompt loading (`PromptSource` / `FsPromptSource`)

At run start, runtime loads one prompt bundle for the selected `agentName` via `PromptSource`.

With `FsPromptSource`, prompt files are loaded from:

- `<rootDir>/<promptName>/system.md` (required)
- optional section files from `sections` (default: `developer.md`, `tools.md`)
- optional `<rootDir>/<promptName>/prompt.meta.json`

Section-to-role mapping:

- `developer` section -> developer role
- `tools` section -> tools role
- any other section name -> custom role

## Policy and safety

Default flow:

- `DefaultPolicyEngine` handles baseline high/low risk.
- `CompositePolicyEngine` combines default policy with custom `PolicyRule`s.
- `createCommandSafetyRule()` screens shell/path-like inputs and can deny or require approval depending on safety mode.

Important: command safety is screening, not sandboxing.

## Sessions and context

- `SessionStore` manages manifests, append-only event logs, support history, and snapshots.
- `ContextManager` controls how many turns are sent to the model and can compress overflow.
  It uses provider-specific token counters when available and calibrates
  estimates from observed model usage.
- `goal` is stored with session metadata and propagated through runs/subagents.
- Oversized tool outputs can be captured as artifacts and read later with
  `tool_output_read`, keeping model feedback bounded while preserving access to
  full output.

## Subagents

`InProcessSubagentRunner` builds child runtimes in-process and waits for them to
finish. `InProcessSubagentSupervisor` uses the same factory contract but tracks
async children so model-facing tools can spawn first and join later.

Typical usage:

- filter tool registry for the child
- give child its own context/session path
- propagate abort signals
- record parent-child session linkage
- register `spawn_subagent` and `wait_subagents` from `createCoreDefaultTools`
  when the model should delegate and then wait for child summaries

## Channels, skills, and MCP

- `FsSkillSource` loads `<skills>/<name>/SKILL.md`, optional
  `skill.meta.json`, and bundled resource files as executable prompt-expansion
  skills.
- `ChannelRegistry` stores `ChannelAdapter`s; `createChannelTools` exposes
  `channel_list` and `channel_send` when a composition opts into channels.
- `createMcpToolset()` wraps stdio or HTTP MCP servers as high-risk tools named
  `mcp__<server>__<tool>`. Use `defineAgentAsync()` for declarative MCP setup.

## Model routing

Model routing is opt-in. Compositions call `Agent.setModelRouting()` with a
router, a route catalog, and routing request defaults. When enabled,
`DefaultModelRouter` filters available routes, honors explicit overrides, then
scores candidates by `cost`, `speed`, `intelligence`, `balanced`, or `auto`.
The same route catalog can be exposed to models with `list_model_routes`.

## Why this design

It keeps the runtime deterministic and inspectable, while still allowing product teams to extend behavior through plugins instead of core forks.
