# How the runtime works

This page explains the core execution model in `@micro-harness/core`.

## Loop lifecycle

For each iteration, `HarnessRuntime` does:

1. Run before-hooks.
2. Build working turns via `ContextManager`.
3. Select model with `ModelSelector`.
4. Ask `ModelAdapter.nextStep(...)` for a `StepPlan`.
5. Execute skill/tool calls through execution engines.
6. Apply policy decisions (`allow`, `deny`, `require_approval`) before each tool call.
7. Append a `Turn` to runtime state.
8. Snapshot to `SessionStore` based on `snapshotEvery`.
9. Run after-hooks.

The loop stops when:

- model returns `stop: true`, or
- runtime limits are reached, or
- runtime is killed/aborted.

## Execution planes

- **Model plane**: turns prompts + context into the next step plan.
- **Policy plane**: evaluates safety/governance of each tool call.
- **Execution plane**: runs tools with timeout + abort signal.
- **State plane**: persists events, turns, and snapshots.

## Policy and safety

Default flow:

- `DefaultPolicyEngine` handles baseline high/low risk.
- `CompositePolicyEngine` combines default policy with custom `PolicyRule`s.
- `createCommandSafetyRule()` screens shell/path-like inputs and can deny or require approval depending on safety mode.

Important: command safety is screening, not sandboxing.

## Sessions and context

- `SessionStore` manages manifests, append-only event logs, support history, and snapshots.
- `ContextManager` controls how many turns are sent to the model and can compress overflow.
- `goal` is stored with session metadata and propagated through runs/subagents.

## Subagents

`InProcessSubagentRunner` builds child runtimes in-process. Typical usage:

- filter tool registry for the child
- give child its own context/session path
- propagate abort signals
- record parent-child session linkage

## Why this design

It keeps the runtime deterministic and inspectable, while still allowing product teams to extend behavior through plugins instead of core forks.
