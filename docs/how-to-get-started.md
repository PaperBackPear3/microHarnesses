# microHarnesses: Getting started

microHarnesses is a composable, plugin-first library for building LLM agent harnesses.

## 1. Install and build

```bash
npm install
npm run build
```

## 2. Understand the package split

- `@micro-harness/core`: runtime loop, tools, context/session, plugin host.
- `@micro-harness/providers`: provider plugins (OpenAI, Anthropic, Ollama).
- Plugin packages: optional capabilities such as planning mode, subagents, and utility tools.

## 3. Why this architecture

The core stays small and stable, while plugins let you add only what you need for your environment and risk model.

## 4. Next docs

- Run the CLI: `how-to-run-cli.md`
- Compose plugins: `how-to-compose-plugins.md`
