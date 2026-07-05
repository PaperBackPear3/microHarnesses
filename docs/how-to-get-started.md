# Getting started: local code review agent (Ollama + gemma4:latest)

## Goal

Build a small **local code review agent** that runs with:

- provider: `ollama`
- model: `gemma4:latest`
- tools: read-only workspace tools (`fs_list`, `fs_read`, `grep_search`)

The agent reviews a target file/path and returns findings.

## What you are setting up

You will create:

1. A TypeScript app that composes `@micro-harness/core`.
2. A prompt pack (`prompts/code-review/*`) used by `FsPromptSource`.
3. A runtime wired to Ollama via `ProviderModelAdapter`.
4. Read-only code exploration tools so the model can inspect code safely.

---

## 1. Install Ollama and pull Gemma

Install Ollama (https://ollama.com/download), then pull the model:

```bash
ollama pull gemma4:latest
```

Optional: verify it is available.

```bash
ollama list
```

---

## 2. Create the project

```bash
mkdir local-code-review-agent
cd local-code-review-agent
npm init -y
npm install @micro-harness/core
npm install -D typescript @types/node
npx tsc --init
```

Create folders:

```bash
mkdir -p src prompts/code-review
```

---

## 3. Create the prompt files

### `prompts/code-review/system.md`

```md
You are a focused code review assistant.

Priorities:
1. Correctness bugs
2. Security issues
3. Reliability and edge cases

Be concise and cite file paths and line numbers when possible.
```

### `prompts/code-review/developer.md`

```md
Workflow:
1. Understand the target path and list nearby files if needed.
2. Read only the relevant files.
3. Return findings as:
   - severity (high/medium/low)
   - file + line
   - issue
   - suggested fix

If no meaningful issues are found, say so explicitly.
```

### `prompts/code-review/tools.md`

```md
You can use:
- fs_list: inspect directories
- fs_read: read file content
- grep_search: search code text

Use tools only when needed, keep exploration focused.
```

---

## 4. Create the runtime (`src/index.ts`)

This file sets up:

- built-in providers (including Ollama)
- read-only workspace tools
- prompt source
- runtime loop
- one review run from CLI input

```ts
import path from "node:path";
import {
  ContextManager,
  DefaultModelSelector,
  DefaultPolicyEngine,
  FsPromptSource,
  HarnessRuntime,
  MemoryEventSink,
  ProviderModelAdapter,
  ProviderRegistry,
  CredentialsRegistry,
  SessionStore,
  ToolRegistry,
  createCoreDefaultTools,
  registerCoreDefaults,
} from "@micro-harness/core";

async function main(): Promise<void> {
  const targetPath = process.argv[2] ?? "src/index.ts";
  const stateDir = path.resolve(".micro-harness");

  const providerRegistry = new ProviderRegistry();
  const credentialsRegistry = new CredentialsRegistry();
  const toolRegistry = new ToolRegistry();

  registerCoreDefaults({
    providerRegistry,
    credentialsRegistry,
    toolRegistry,
    includeBuiltInProviders: true,
    tools: createCoreDefaultTools({
      workspaceTools: {
        rootDir: process.cwd(),
        maxReadChars: 120_000,
        maxSearchFiles: 200,
        maxSearchMatches: 200,
      },
    }),
  });

  const runtime = new HarnessRuntime({
    model: new ProviderModelAdapter({
      providerRegistry,
      credentialsRegistry,
      providerId: "ollama",
      model: "gemma4:latest",
      maxTokens: 2048,
    }),
    modelSelector: new DefaultModelSelector(),
    prompts: new FsPromptSource({
      rootDir: path.resolve("prompts"),
    }),
    tools: toolRegistry,
    context: new ContextManager({
      stateDir: path.join(stateDir, "context"),
      maxWorkingTurns: 8,
      goal: "Perform a focused local code review",
    }),
    policy: new DefaultPolicyEngine(),
    eventSink: new MemoryEventSink(),
    sessionStore: new SessionStore(stateDir),
  });

  const task = [
    `Review the code at: ${targetPath}`,
    "Find meaningful issues only (bugs, security, reliability).",
    "Return a concise report with severity, file/line, issue, and fix.",
  ].join("\n");

  const state = await runtime.run("code-review", task, {
    maxIterations: 6,
    snapshotEvery: 1,
    profile: { defaultModel: "gemma4:latest" },
    goal: `Code review for ${targetPath}`,
  });

  const final = state.turns.at(-1)?.assistantMessage ?? "No response";
  console.log(final);
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  console.error(`Error: ${message}`);
  process.exit(1);
});
```

---

## 5. Add scripts to `package.json`

```json
{
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "review": "npm run build && node dist/index.js"
  }
}
```

---

## 6. Run the agent

Make sure Ollama is running locally, then run:

```bash
npm run review -- packages/core/src/runtime/runtime.ts
```

If you need a non-default Ollama URL:

```bash
export OLLAMA_BASE_URL=http://127.0.0.1:11434/v1
```

## How it works at runtime

1. The app loads prompt files from `prompts/code-review`.
2. The model (`gemma4:latest` via Ollama) plans a review step.
3. It can call read-only tools to inspect files.
4. `HarnessRuntime` appends turns and snapshots session state locally.
5. Final assistant output is printed as the review report.

---

## Full code (copy/paste)

### `src/index.ts`

```ts
import path from "node:path";
import {
  ContextManager,
  DefaultModelSelector,
  DefaultPolicyEngine,
  FsPromptSource,
  HarnessRuntime,
  MemoryEventSink,
  ProviderModelAdapter,
  ProviderRegistry,
  CredentialsRegistry,
  SessionStore,
  ToolRegistry,
  createCoreDefaultTools,
  registerCoreDefaults,
} from "@micro-harness/core";

async function main(): Promise<void> {
  const targetPath = process.argv[2] ?? "src/index.ts";
  const stateDir = path.resolve(".micro-harness");

  const providerRegistry = new ProviderRegistry();
  const credentialsRegistry = new CredentialsRegistry();
  const toolRegistry = new ToolRegistry();

  registerCoreDefaults({
    providerRegistry,
    credentialsRegistry,
    toolRegistry,
    includeBuiltInProviders: true,
    tools: createCoreDefaultTools({
      workspaceTools: {
        rootDir: process.cwd(),
        maxReadChars: 120_000,
        maxSearchFiles: 200,
        maxSearchMatches: 200,
      },
    }),
  });

  const runtime = new HarnessRuntime({
    model: new ProviderModelAdapter({
      providerRegistry,
      credentialsRegistry,
      providerId: "ollama",
      model: "gemma4:latest",
      maxTokens: 2048,
    }),
    modelSelector: new DefaultModelSelector(),
    prompts: new FsPromptSource({
      rootDir: path.resolve("prompts"),
    }),
    tools: toolRegistry,
    context: new ContextManager({
      stateDir: path.join(stateDir, "context"),
      maxWorkingTurns: 8,
      goal: "Perform a focused local code review",
    }),
    policy: new DefaultPolicyEngine(),
    eventSink: new MemoryEventSink(),
    sessionStore: new SessionStore(stateDir),
  });

  const task = [
    `Review the code at: ${targetPath}`,
    "Find meaningful issues only (bugs, security, reliability).",
    "Return a concise report with severity, file/line, issue, and fix.",
  ].join("\n");

  const state = await runtime.run("code-review", task, {
    maxIterations: 6,
    snapshotEvery: 1,
    profile: { defaultModel: "gemma4:latest" },
    goal: `Code review for ${targetPath}`,
  });

  const final = state.turns.at(-1)?.assistantMessage ?? "No response";
  console.log(final);
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  console.error(`Error: ${message}`);
  process.exit(1);
});
```

### `prompts/code-review/system.md`

```md
You are a focused code review assistant.

Priorities:
1. Correctness bugs
2. Security issues
3. Reliability and edge cases

Be concise and cite file paths and line numbers when possible.
```

### `prompts/code-review/developer.md`

```md
Workflow:
1. Understand the target path and list nearby files if needed.
2. Read only the relevant files.
3. Return findings as:
   - severity (high/medium/low)
   - file + line
   - issue
   - suggested fix

If no meaningful issues are found, say so explicitly.
```

### `prompts/code-review/tools.md`

```md
You can use:
- fs_list: inspect directories
- fs_read: read file content
- grep_search: search code text

Use tools only when needed, keep exploration focused.
```
