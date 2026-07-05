# Getting started

microHarnesses is a **package-first** project.

The main deliverables are reusable packages in `packages/*`:

- `@micro-harness/core` (agent engine/runtime loop)
- `@micro-harness/providers` (provider adapters)
- plugin packages (tools, planning, subagents, and more)

`apps/cli` is a **reference app** that consumes those packages to show one composition pattern.

## Install and build the workspace

```bash
npm install
npm run build
```

## Choose your path

1. Build your own app/composition root with the packages (recommended for production use).
2. Use `apps/cli` to quickly test prompts, tools, sessions, and plugin behavior.

## Package map

- `@micro-harness/core`: runtime loop, tools, context/session, plugin host.
- `@micro-harness/providers`: provider plugins (OpenAI, Anthropic, Ollama).
- `@micro-harness/plugin-*`: optional capabilities such as planning mode, subagents, and utility tools.

## Why this architecture

The core stays small and stable. Plugins let you add only what you need for your environment, safety posture, and product requirements.
