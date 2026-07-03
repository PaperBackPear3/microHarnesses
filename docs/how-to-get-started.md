# Getting started

## Install and build

```bash
npm install
npm run build
```

## Understand the package split

- `@micro-harness/core`: runtime loop, tools, context/session, plugin host.
- `@micro-harness/providers`: provider plugins (OpenAI, Anthropic, Ollama).
- Plugin packages: optional capabilities such as planning mode, subagents, and utility tools.

## Why this architecture

The core stays small and stable. Plugins let you add only what you need for your environment and threat model.
