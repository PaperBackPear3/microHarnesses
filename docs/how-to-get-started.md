# Getting started

microHarnesses is a **package-first** project.

The main deliverables are reusable packages in `packages/*`:

- `@micro-harness/core` (agent engine/runtime loop)
- plugin packages (tools, planning, subagents, and more)

## Install and build the workspace

```bash
npm install
npm run build
```

## Choose your path

Build your own app/composition root with the packages.

## Package map

- `@micro-harness/core`: runtime loop, tools, context/session, plugin host.
- `@micro-harness/plugin-*`: optional capabilities such as planning mode, subagents, and utility tools.

## Why this architecture

The core stays small and stable. Plugins let you add only what you need for your environment, safety posture, and product requirements.
