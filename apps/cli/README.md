# @micro-harness/cli

Reference CLI for running `@micro-harness/core` with the plugins wired in
`apps/cli/src/composition.ts`.

This app is private to the monorepo (not published as a standalone package).

## Installed plugins (auto-registered)

These are enabled by default on every `run`:

| Plugin | What it adds |
|---|---|
| `builtInProviderPlugins()` from `@micro-harness/providers` | Providers: `openai`, `anthropic`, `ollama` |
| `exampleToolsPlugin` | Tools: `echo`, `time` |
| `subagentsPlugin` | Tool: `spawn_subagent` |
| `PlanModePlugin` | Tools: `plan_agent`, `explore_agent`, `plan_mode_info` |

`PlanModePlugin` is configured with:
- `rootDir: process.cwd()`
- `maxExploreFiles: 30`
- `maxDepth: 6`

## Quick start

From the repository root:

```bash
npm install
npm run build
```

Set credentials for your provider:

```bash
export OPENAI_API_KEY=sk-...
export ANTHROPIC_API_KEY=sk-ant-...
export OLLAMA_BASE_URL=http://127.0.0.1:11434/v1
```

Run:

```bash
npm run cli:run -- "summarise this task" --provider openai --model gpt-4.1-mini
```

Interactive (no initial prompt; keeps asking until you exit):

```bash
npm run cli:run -- --provider openai --model gpt-4.1-mini
```

## CLI commands

| Command | Purpose |
|---|---|
| `run` | Starts interactive mode when no prompt is provided; prints compact thinking/reasoning status, tool/agent calls, and streamed deltas on stderr |
| `sessions list` | Lists sessions in `--state-dir` |
| `sessions show <session-id>` | Prints one session JSON |
| `sessions resume <session-id> <prompt>` | Resumes a session and continues with a new prompt |

Examples:

```bash
node apps/cli/dist/index.js sessions list
node apps/cli/dist/index.js sessions show <session-id>
node apps/cli/dist/index.js sessions resume <session-id> "continue from last state"
```

## Run flags

| Flag | Default | Notes |
|---|---|---|
| `--agent <name>` | `default` | Prompt pack under `--prompts-dir` |
| `--provider <id>` | `openai` | `openai`, `anthropic`, `ollama` |
| `--model <name>` | provider default | Model override |
| `--prompts-dir <path>` | `apps/cli/prompts` | Prompt pack root |
| `--iterations <n>` | `4` | Max loop iterations |
| `--snapshot-every <n>` | `2` | Snapshot cadence |
| `--session-id <id>` | none | Continue a specific session id |
| `--resume` | off | Resume from latest snapshot |
| `--goal <text>` | none | Persisted goal in session manifest |
| `--state-dir <path>` | `.micro-harness` in CWD | State/session root |
| `--plugins <path>` | none | Load one extra plugin file |
| `--no-safety` | off | Disable `CommandSafetyRule` |

## Usage examples with installed plugins

### 1) Built-in provider + basic run

```bash
npm run cli:run -- "Summarise the repository architecture in 5 bullets." \
  --provider openai --model gpt-4.1-mini
```

### 2) Example tools plugin (`time`, `echo`)

```bash
npm run cli:run -- "Use time, then echo the ISO timestamp with a short label." \
  --provider openai --model gpt-4.1-mini
```

### 3) Plan-mode introspection (`plan_mode_info`)

```bash
npm run cli:run -- "Call plan_mode_info and return only the tool list and guarantees." \
  --provider openai --model gpt-4.1-mini
```

### 4) Plan-mode planning (`plan_agent`)

```bash
npm run cli:run -- "Use plan_agent to create a prioritized plan for adding a new provider plugin with tests." \
  --provider openai --model gpt-4.1-mini
```

### 5) Plan-mode exploration (`explore_agent`)

```bash
npm run cli:run -- "Use explore_agent to find files mentioning PluginHost under apps/cli/src and summarize findings." \
  --provider openai --model gpt-4.1-mini
```

### 6) Subagents (`spawn_subagent`)

```bash
npm run cli:run -- "Use spawn_subagent to delegate investigation of session persistence, then return the child summary." \
  --provider openai --model gpt-4.1-mini
```

### 7) Local model via Ollama

```bash
ollama pull llama3.2:3b
npm run cli:run -- "Give me a short plan for refactoring a TypeScript module." \
  --provider ollama --model llama3.2:3b
```

## Loading an extra plugin with `--plugins`

The plugin file must export either:
- a `default` export that is a `HarnessPlugin`, or
- a named export `plugin`.

Example:

```bash
npm run cli:run -- "use my custom tool" \
  --plugins ./path/to/my-plugin.mjs \
  --provider openai --model gpt-4.1-mini
```
