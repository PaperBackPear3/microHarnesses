# Getting started: local code review agent (Ollama + gemma4:latest)

## Which guide should you use?

Use this page if you want the **fastest path** to a working runtime focused on
one concrete use case (local code review).

If you want a broader end-to-end walkthrough of a generic Node app structure
and plugin wiring, use **Tutorial: build a sample application**
(`docs/tutorial-build-sample-app.md`).

## Goal

Build a small **local code review agent** that runs with:

- provider: `ollama`
- model: `gemma4:latest`
- tools: read-only workspace tools (`fs_list`, `fs_read`, `grep_search`)

The agent reviews a target file/path and returns findings.

## What you are setting up

You will create:

1. A TypeScript app that composes `@micro-harnesses/core`.
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
npm install @micro-harnesses/core
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

### How `FsPromptSource` reads these files

With:

```ts
new FsPromptSource({ rootDir: path.resolve("prompts") });
```

and runtime call:

```ts
runtime.run(...); // persona "code-review" is bound at construction
```

it resolves this folder:

```text
prompts/code-review/
```

File behavior:

- `system.md`: required
- `developer.md`: optional (loaded by default sections)
- `tools.md`: optional (loaded by default sections)
- `prompt.meta.json`: optional metadata

Default sections are `["developer", "tools"]`. You can override:

```ts
new FsPromptSource({
  rootDir: path.resolve("prompts"),
  sections: ["developer", "tools", "constraints", "examples"],
});
```

Section roles:

- `developer` -> developer instruction role
- `tools` -> tools instruction role
- any other section name -> custom instruction role

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
  Agent,
  createObservability,
  ProviderModelAdapter,
  ProviderRegistry,
  CredentialsRegistry,
  SessionStore,
  ToolRegistry,
  createCoreDefaultTools,
  registerCoreDefaults,
} from "@micro-harnesses/core";

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

  const runtime = new Agent({
    promptName: "code-review",
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
    observability: createObservability(),
    sessionStore: new SessionStore(stateDir),
  });

  const task = [
    `Review the code at: ${targetPath}`,
    "Find meaningful issues only (bugs, security, reliability).",
    "Return a concise report with severity, file/line, issue, and fix.",
  ].join("\n");

  const state = await runtime.run(task, {
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

You can also register runtime-native loop hooks in the same call by providing
`hookRegistrar`, `beforeHooks`, and `afterHooks`:

```ts
registerCoreDefaults({
  providerRegistry,
  credentialsRegistry,
  toolRegistry,
  includeBuiltInProviders: false,
  hookRegistrar: {
    onBeforeLoop: (hook) => runtime.addBeforeHook(hook),
    onAfterLoop: (hook) => runtime.addAfterHook(hook),
  },
  beforeHooks: [async (_state, _iteration) => {}],
});
```

---

## Stream from the model

To stream both model thinking and final answer text to your user, implement a
`StreamSink` and forward `model.reasoning_delta` + `model.output_delta`, then
pass it to `createObservability({ stream })`.

```ts
import { createObservability } from "@micro-harnesses/core";
import type { StreamEvent, StreamSink } from "@micro-harnesses/core";

class StreamingSink implements StreamSink {
  constructor(
    private readonly onChunk: (kind: "thinking" | "answer", chunk: string) => void,
  ) {}

  push(event: StreamEvent): void {
    if (event.type === "model.reasoning_delta") {
      const delta = event.payload.delta;
      if (typeof delta === "string" && delta.length > 0) {
        this.onChunk("thinking", delta);
      }
      return;
    }

    if (event.type === "model.output_delta") {
      const delta = event.payload.delta;
      if (typeof delta === "string" && delta.length > 0) {
        this.onChunk("answer", delta);
      }
    }
  }
}
```

Replace:

```ts
observability: createObservability(),
```

with:

```ts
observability: createObservability({
  stream: new StreamingSink((kind, chunk) => {
    // Terminal example:
    process.stdout.write(kind === "thinking" ? `[thinking] ${chunk}` : chunk);

    // Web app example:
    // ws.send(JSON.stringify({ kind, chunk }));
  }),
}),
```

If a provider/model does not expose reasoning tokens, you still get answer
streaming via `model.output_delta`.

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
npm run review -- packages/core/src/runtime/agent.ts
```

If you need a non-default Ollama URL:

```bash
export OLLAMA_BASE_URL=http://127.0.0.1:11434/v1
```

## How it works at runtime

1. The app loads prompt files from `prompts/code-review`.
2. The model (`gemma4:latest` via Ollama) plans a review step.
3. It can call read-only tools to inspect files.
4. `Agent` appends turns and snapshots session state locally.
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
  Agent,
  createObservability,
  ProviderModelAdapter,
  ProviderRegistry,
  CredentialsRegistry,
  SessionStore,
  ToolRegistry,
  createCoreDefaultTools,
  registerCoreDefaults,
} from "@micro-harnesses/core";

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

  const runtime = new Agent({
    promptName: "code-review",
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
    observability: createObservability(),
    sessionStore: new SessionStore(stateDir),
  });

  const task = [
    `Review the code at: ${targetPath}`,
    "Find meaningful issues only (bugs, security, reliability).",
    "Return a concise report with severity, file/line, issue, and fix.",
  ].join("\n");

  const state = await runtime.run(task, {
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
