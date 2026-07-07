# What is microHarnesses

microHarnesses is a package-first TypeScript ecosystem for building AI agent runtimes.

Instead of shipping one monolithic framework, microHarnesses gives you composable runtime primitives in `@micro-harnesses/core`, then lets you add behavior through plugins and app-level composition.

## Project goals

- Keep the runtime reusable and app-agnostic.
- Make extension points explicit (tools, policy, providers, hooks, agents, skills, channels, MCP, observability, and model routing).
- Support strict safety and governance with composable policy rules.
- Let each product compose only the capabilities it needs.

## How the project is structured

- `packages/core` — runtime loop and shared primitives.
- `plugins/*` — optional capability packages.
- `apps/cli` — reference composition showing how packages can be wired together.
- `docs/` — user and contributor documentation.

## Core concepts

- **Runtime loop**: model step -> governed tool/skill execution -> state update -> repeat.
- **Tool policy**: each tool call is evaluated before execution (`allow`, `deny`, `require_approval`).
- **Plugin capabilities**: plugins declare what they can register; host enforces it.
- **Session + context**: event log + snapshots + working-turn management.
- **Providers + model routing**: built-in and custom providers expose model adapters, token counters, model catalogs, and route metadata.
- **Skills + channels**: filesystem skills expand reusable instructions; channels provide explicit message transports.
- **Subagents**: nested runtime runs with blocking or async supervised lifecycle.
- **Observability**: OTel-shaped traces, metrics, logs, live stream events, usage, and context-window telemetry.

## Read next

- Runtime internals: [`how-runtime-works.md`](./how-runtime-works.md)
- Concepts and adoption choices: [`concepts-and-decision-guide.md`](./concepts-and-decision-guide.md)
- Package reference: [`package-reference.md`](./package-reference.md)
- Runtime interfaces: [`reference-runtime-interfaces.md`](./reference-runtime-interfaces.md)
- Getting started: [`how-to-get-started.md`](./how-to-get-started.md)
