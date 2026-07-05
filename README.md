# microHarnesses

microHarnesses is a package-first ecosystem for building LLM agent harnesses.
The primary product is the reusable library set — especially
`@micro-harness/core` plus provider and plugin packages — so you can compose
your own runtime and swap implementations as needed.

`apps/cli` is included as a private reference application that demonstrates how
to compose the packages in a real app. It is a consumer of the ecosystem, not
the main product.

## Packages

The core package and plugin/provider packages are the main surface area:

| Package                                                                | Purpose                                                                                                                                                                                               |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`@micro-harness/core`](packages/core)                                 | Agent loop, tool registry, sessions/context/compression, plugin host, policy engine + command-safety rule, provider/credentials registries, in-process subagent primitive. Zero runtime dependencies. |
| [`@micro-harness/providers`](packages/providers)                       | Provider plugins: OpenAI, Anthropic, Ollama. Each is a `HarnessPlugin` that registers an adapter + env-based credentials resolver.                                                                    |
| [`@micro-harness/plugin-plan-mode`](packages/plugin-plan-mode)         | Read-only planning and file exploration tools.                                                                                                                                                        |
| [`@micro-harness/plugin-subagents`](packages/plugin-subagents)         | `spawn_subagent` tool built on core's `InProcessSubagentRunner`.                                                                                                                                      |
| [`@micro-harness/plugin-basic-tools`](packages/plugin-basic-tools)     | Workspace-scoped utility tools: file IO, grep search, and shell execution.                                                                                                                            |
| [`@micro-harness/plugin-example-tools`](packages/plugin-example-tools) | Reference tool plugin (`echo`, `time`). Doubles as a plugin-authoring example.                                                                                                                        |
| `apps/cli` (private reference app)                                     | Secondary, private composition root that consumes the packages and demonstrates one wiring pattern. See [`apps/cli/README.md`](apps/cli/README.md) and `apps/cli/src/composition.ts`.                |

## Design principles

- **Everything is a plugin.** Providers, credentials, policy rules, tools,
  hooks, compressors, model selector, subagents — all registered through the
  `PluginApi`. Users can swap any of them.
- **Explicit capabilities.** Plugins declare which parts of the API they touch
  (`capabilities: ["tools", "providers", …]`) and the host enforces it.
- **Zero runtime dependencies in core.** Node built-ins only.
- **Safety in depth, not as a sandbox.** The `CommandSafetyRule` is one
  composable layer — a screening layer that raises `require_approval` /
  `deny` for shell commands matching a starter ruleset. It defeats trivial
  bypasses (`s\udo`, `"su"do`) but is documented as best-effort. Users add
  their own rules for their threat model.
- **Approval seam.** When policy returns `require_approval`, the runtime
  emits `tool.approval_requested` and awaits a caller-supplied
  `ApprovalHandler`. No handler → the tool is blocked.

## Install and build

```bash
npm install
npm run build   # builds all workspaces
npm test        # builds first, then runs tests (Node's built-in test runner)
npm run lint    # Biome check
```

## Reference CLI (example package consumer)

### Credentials

```bash
export OPENAI_API_KEY=sk-...
export ANTHROPIC_API_KEY=sk-ant-...
# for local Ollama (optional — defaults to http://127.0.0.1:11434/v1)
export OLLAMA_BASE_URL=http://127.0.0.1:11434/v1
```

### Run

```bash
npm run cli:run -- "summarise this task" --provider openai --model gpt-4.1-mini
```

Interactive (no initial prompt; loops until you exit):

```bash
npm run cli:run -- --provider openai --model gpt-4.1-mini
```

`run` streams progress directly to stderr (thinking/reasoning, tool/agent calls, assistant deltas) and does not emit a final JSON blob. Streamed reasoning/thinking deltas are also written to the session event log.

Local Ollama (no API key):

```bash
ollama pull llama3.2:3b
npm run cli:run -- "summarise this task" --provider ollama --model llama3.2:3b
```

The CLI auto-registers package-provided plugins (see [`apps/cli/src/composition.ts`](apps/cli/src/composition.ts)):

- `builtInProviderPlugins()` — OpenAI, Anthropic, Ollama
- `basicToolsPlugin` — `fs_list`, `fs_read`, `fs_write`, `fs_append`, `fs_mkdir`, `fs_move`, `fs_remove`, `grep_search`, `shell_exec`
- `subagentsPlugin` — `spawn_subagent`
- `PlanModePlugin` — `plan_agent`, `explore_agent`, `plan_mode_info`

Load additional plugins with `--plugins <path>` (a file whose default export is a `HarnessPlugin`).

### CLI flags

| Flag                                     | Default                   | Description                                                          |
| ---------------------------------------- | ------------------------- | -------------------------------------------------------------------- |
| `--agent <name>`                         | `default`                 | Prompt pack to load from `--prompts-dir`                             |
| `--provider <openai\|anthropic\|ollama>` | `openai`                  | LLM provider                                                         |
| `--model <name>`                         | provider's `defaultModel` | Model override                                                       |
| `--max-tokens <n>`                       | `4096`                    | Maximum output tokens per model call                                 |
| `--prompts-dir <path>`                   | `apps/cli/prompts`        | Root directory for prompt packs                                      |
| `--iterations <n>`                       | `4`                       | Maximum loop iterations                                              |
| `--snapshot-every <n>`                   | `2`                       | Save session snapshot every N iterations                             |
| `--session-id <id>`                      | new                       | Re-use an existing session (auto-resume enabled)                     |
| `--resume`                               | off                       | Resume from latest session snapshot (also implied by `--session-id`) |
| `--goal <text>`                          | prompt text               | Explicit goal persisted in session manifest                          |
| `--state-dir <path>`                     | `.micro-harness`          | State and session storage root                                       |
| `--plugins <path>`                       | none                      | Path to a plugin file (loaded after built-ins)                       |
| `--no-safety`                            | off                       | Disable `CommandSafetyRule` (use only for local dev / trusted env)   |

Interactive slash commands: `/info` (show current session/runtime info), `/exit`, `/quit`.

### Session operations

Sessions live under `<state-dir>/sessions/<session-id>/`:

| File                    | Purpose                                                                            |
| ----------------------- | ---------------------------------------------------------------------------------- |
| `manifest.json`         | Session metadata and file pointers (incl. `parentSessionId` for subagent sessions) |
| `events.jsonl`          | Append-only event/operation log                                                    |
| `snapshots/*.json`      | Periodic state snapshots for fast resume                                           |
| `support-history.jsonl` | Tool/policy failures and diagnostics                                               |

```bash
node apps/cli/dist/index.js sessions list
node apps/cli/dist/index.js sessions show <session-id>
node apps/cli/dist/index.js sessions resume <session-id> "continue from last state"
```

## Composability story

Composability lives in the packages, and the CLI simply demonstrates one
composition. The core + plugins expose seams you can wire in your own app. Read
[`apps/cli/src/composition.ts`](apps/cli/src/composition.ts) as an example
consumer; key seams are:

- `new ToolRegistry()` — every tool is registered here (by plugins or the app)
- `new ProviderRegistry()` + `new CredentialsRegistry()` — providers register
  themselves via provider plugins (`builtInProviderPlugins()` from
  `@micro-harness/providers`), and users can swap any adapter or resolver
- `new CompositePolicyEngine(new DefaultPolicyEngine())` — the default engine
  handles risk annotations; policy rules (e.g. `createCommandSafetyRule()`)
  compose on top with most-restrictive-wins
- `new HarnessRuntime({ … })` — the loop; consumes the deps above plus an
  `EventSink`, optional `SessionStore`, `approvalHandler`, and per-run
  `limits`
- `new PluginHost({ … })` — plugins register capabilities; the host enforces
  each plugin only touches surfaces it declared
- `new InProcessSubagentRunner(factory, parent)` — child agents run in the
  same Node process; the factory closure builds the child runtime with a
  filtered `ToolRegistry` and nested session (`sessions/<parent>/subagents/<child>/`)

## Prompt pack convention

```
<prompts-dir>/<agent-name>/
  system.md          # required
  developer.md       # optional
  tools.md           # optional
  prompt.meta.json   # optional (modelHint, taskTypeHint, safetyMode: "strict"|"balanced"|"open", tags)
```

Frontmatter (`---`) is stripped. Variables use `{{name}}` syntax.

## Writing a plugin

The minimum plugin declares a `name`, its `capabilities`, and a `register`
function. See [`packages/plugin-example-tools`](packages/plugin-example-tools)
for the reference implementation.

```ts
import type { HarnessPlugin, PluginApi } from "@micro-harness/core";

export const myPlugin: HarnessPlugin = {
  name: "my-plugin",
  capabilities: ["tools"],
  register(api: PluginApi) {
    api.registerTool({
      name: "upper",
      description: "Uppercases text",
      risk: "low",
      async execute(input) {
        return { text: String(input.text ?? "").toUpperCase() };
      },
    });
  },
};
```

Capabilities: `"tools"`, `"hooks"`, `"compressor"`, `"providers"`,
`"credentials"`, `"policy"`, `"model-selector"`, `"subagents"`. Using a
surface you didn't declare throws `PluginCapabilityError`.

## Safety

The starter `CommandSafetyRule` screens tool inputs annotated with
`{ field, kind: "shell_command" | "file_path" }` (heuristic fallback for tools
matching `/bash|shell|exec|cmd/i`). The **starter ruleset is deliberately
non-exhaustive** — see
[`packages/core/src/policy/safety/defaultRules.ts`](packages/core/src/policy/safety/defaultRules.ts)
and treat it as one layer of defense-in-depth. Add rules for your threat
model via `policy.addRule(...)`. Severity × `safetyMode` mapping:

| Severity ↓ / mode → | strict           | balanced         | open             |
| ------------------- | ---------------- | ---------------- | ---------------- |
| critical            | deny             | deny             | require_approval |
| high                | deny             | require_approval | require_approval |
| medium              | require_approval | require_approval | allow            |

## Publishing

Tag a release (`git tag v0.3.1 && git push --tags`) — the `Release` workflow
builds, tests, and publishes each publishable package with npm provenance.
`NPM_TOKEN` must be set in repo secrets.

## License

MIT
