# Running the CLI

`apps/cli` is a **private reference application**, not the core product.

It demonstrates how to compose `@micro-harness/*` packages into a runnable agent app.

## What this CLI can do

- Run single-prompt tasks against OpenAI, Anthropic, or Ollama.
- Run an interactive loop with slash commands (`/info`, `/exit`, `/quit`).
- Execute built-in tools (filesystem, search, shell) through plugin composition.
- Delegate work with subagents.
- Use plan-mode tools for planning and repository exploration.
- Persist sessions, inspect them, and resume from snapshots.
- Load an additional custom plugin file with `--plugins`.

## Set credentials

```bash
export OPENAI_API_KEY=sk-...
export ANTHROPIC_API_KEY=sk-ant-...
export OLLAMA_BASE_URL=http://127.0.0.1:11434/v1
```

## Run with a cloud provider

```bash
npm run cli:run -- "summarise this task" --provider openai --model gpt-4.1-mini
```

## Run interactive mode

```bash
npm run cli:run -- --provider openai --model gpt-4.1-mini
```

You can inspect session/runtime info in interactive mode using `/info`.

## Run with a local model (Ollama)

```bash
ollama pull llama3.2:3b
npm run cli:run -- "small local task" --provider ollama --model llama3.2:3b
```

## Inspect sessions

```bash
node apps/cli/dist/index.js sessions list
node apps/cli/dist/index.js sessions show <session-id>
node apps/cli/dist/index.js sessions resume <session-id> "continue task"
```

## Load an extra plugin in the reference app

```bash
npm run cli:run -- "use my custom tool" \
  --plugins ./path/to/my-plugin.mjs \
  --provider openai --model gpt-4.1-mini
```
