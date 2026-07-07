# Plan: `apps/cli` v2 — a full development code assistant

Rebuild `apps/cli` from scratch into a polished, interactive **development code
assistant** (à la GitHub Copilot CLI / Claude Code): a chat TUI with streaming
model output, visible "thinking", session navigation, effort levels, and the
three operating modes **Plan → Accept edits → Autopilot**. Built entirely on the
**new core v1** (`Agent`, providers, subagents, observability) and the existing
plugins. Treat it as a delete-all-and-rebuild.

> Status: **proposed**. Scope: `apps/cli` only (no core changes required; core v1
> already exposes everything needed).

---

## 0. Why a rewrite

The current `apps/cli` is dead code and cannot compile:
- Imports a non-existent `HarnessRuntime` and packages that don't exist
  (`@micro-harness/plugin-subagents`, `@micro-harness/providers`), and uses the
  wrong scope (`@micro-harness/*` vs `@micro-harnesses/*`).
- Still modeled on the removed `EventSink` world.
- `apps/*` is **not** in the root `workspaces`, so it's never built/tested/linted.

Decision: delete `apps/cli/src/**` and `apps/cli/prompts/**`, rewrite
`package.json`/`tsconfig.json`, and **add `apps/*` to the root `workspaces`** so
the product is built, tested, and linted with everything else.

---

## 1. Product goals

A single binary (`mh` / `micro-harness`) that:
1. **Chat interface** — rich TUI: message history, streaming assistant tokens,
   tool-call cards, spinners, a status bar.
2. **Streaming** — live model output + a collapsible **Thinking** panel fed by
   reasoning deltas.
3. **Effort / thinking levels** — `low | medium | high` reasoning effort that maps
   to model selection + task-type hint and how much thinking is shown.
4. **Session navigation** — new/resume/switch/list sessions with a fuzzy picker,
   backed by core `SessionStore`; show per-session summary + telemetry.
5. **Modes** — cycle **Plan → Accept edits → Autopilot** (Copilot-style
   Shift+Tab), driving policy + approvals + tool scope.
6. **Accept-edits UX** — diff preview before applying file edits; approve/reject
   per edit; auto-approve in higher modes.
7. **Autopilot** — full autonomy (auto-approve, all tools), with interrupt.
8. **Headless mode** — `mh -p "…"` for non-interactive/CI use with
   machine-readable output (preserve JSON contract for `run`/`sessions`).

---

## 2. Tech choices

- **TUI**: [Ink](https://github.com/vadimdemedes/ink) (React for the terminal) —
  the standard for Copilot/Claude-style CLIs; great for streaming, panels, focus.
  Deps: `ink`, `react`, `ink-text-input` (or a custom input), `ink-spinner`.
- **Diffs**: `diff` (jsdiff) for edit previews; simple ANSI colorizer.
- **Args**: keep a tiny hand-rolled parser (current style) or add a minimal one;
  no heavy framework.
- App code may take dependencies freely (core stays zero-dep; this is the app).
- Target CommonJS to match the repo `tsconfig.base.json`; if Ink/ESM-only
  versions force ESM, pin to the last CJS-compatible line **or** switch this
  package to `"type": "module"` + ESM tsconfig (decide in Milestone 1 spike).

---

## 3. Architecture

```
apps/cli/
  package.json            # name @micro-harnesses/cli, bin mh|micro-harness, deps: core + plugins + ink/react
  tsconfig.json
  README.md
  prompts/                # rewritten assistant persona(s): coder, planner
  src/
    index.ts              # bin entry: parse argv, dispatch chat|run|sessions|help|version
    cli/
      args.ts             # flags: --model --provider --effort --mode --session --state-dir -p/--print --no-safety
      commands/
        chat.ts           # default: launch the Ink app
        run.ts            # headless single-prompt (machine-readable output)
        sessions.ts       # list/show/resume (JSON output preserved)
    config/
      config.ts           # load/merge ~/.microharness/config.json + env + flags
      providers.ts        # provider/model/effort resolution & API-key discovery
    runtime/
      composition.ts      # build Agent graph from core + plugins + observability
      approvalPolicy.ts   # mode-aware PolicyRule (require_approval for mutations)
      approvalHandler.ts  # bridges require_approval -> UI prompt (diff/confirm)
      modelSelector.ts    # effort/mode -> model profile + task-type
    modes/
      modes.ts            # Mode state machine: plan|accept-edits|autopilot
    session/
      sessionService.ts   # over core SessionStore: list/new/resume/telemetry summary
    streaming/
      uiStream.ts         # StreamSink -> UI event bus (React store/emitter)
    telemetry/
      status.ts           # derive live status (context window %, tokens, turns, errors)
    app/                  # Ink components
      App.tsx             # top-level; owns run lifecycle, input, mode, focus
      ChatView.tsx        # message list + streaming assistant bubble
      Message.tsx         # user/assistant/tool/system message renderers
      ThinkingPanel.tsx   # collapsible reasoning stream
      ToolCall.tsx        # tool/skill call card (name, input summary, status, duration)
      DiffView.tsx        # unified diff for pending edits
      ApprovalPrompt.tsx  # approve/reject/always for require_approval
      StatusBar.tsx       # model, mode, effort, ctx-window %, tokens, turns, errors
      SessionPicker.tsx   # fuzzy session list/resume
      InputBar.tsx        # prompt input + slash-command hints
    slash/
      commands.ts         # /new /sessions /resume /model /effort /mode /plan /context /telemetry /help /clear /exit
    *.test.ts
```

### 3.1 Wiring core (composition.ts)
Build against the **real** core surfaces (no phantom packages):
- `ProviderModelAdapter` + `ProviderRegistry`/`CredentialsRegistry`; register
  built-in providers via `builtInProviderPlugins()` (openai/anthropic/ollama).
- `ToolRegistry` + `registerCoreDefaults` (workspace read-only tools +
  `spawn_subagent`).
- `PluginHost.register([...builtInProviderPlugins(), basicToolsPlugin,
  planModePlugin, exampleToolsPlugin, userPlugins])`.
- `ContextManager` with `contextWindowTokens` + `tokenCounter` for the status bar.
- `CompositePolicyEngine(new DefaultPolicyEngine(...))` + `createCommandSafetyRule()`
  + the **mode-aware `approvalPolicy` rule**.
- `DefaultObservabilityProvider` with:
  - `stream: uiStream` (drives the TUI),
  - `JsonlObservabilityExporter` → `sessions/<id>/telemetry/` (durable),
  - redaction defaults (privacy mode toggle via config/flag).
- `Agent({ promptName, model, modelSelector, prompts, tools, context, policy,
  observability, sessionStore, approvalHandler })`.
- `InProcessSubagentRunner` + `SubagentRuntimeFactory` that **forwards
  `parentTrace`** so subagent runs join the parent trace (core supports this).

### 3.2 Streaming to the UI (uiStream.ts)
Implement `StreamSink.push(event)` that emits into a React store. Map the core
stream events:
- `model.thinking_started/completed` → spinner + Thinking panel open/close.
- `model.reasoning_delta` / `model.reasoning_completed` → Thinking panel text.
- `model.output_delta` / `model.output_completed` → assistant bubble tokens.
- `model.selected`, `model.usage` → status bar (model, token counts).
- `tool.started` / `tool.completed` / `tool.blocked` → ToolCall cards.
- `tool.approval_requested` / `tool.approval_resolved` → approval flow.
- `context.window` → status bar (used/free/max tokens + utilization %).
- `limit.reached`, `run.completed`, `run.failed` → run lifecycle.

`Agent.run(...)` runs in the background while the UI pumps stream events; input
during a run is queued; **Esc/Ctrl-C → `agent.kill()`** (core AbortController).

### 3.3 Modes (modes.ts + approvalPolicy.ts + approvalHandler.ts)
Cycle with Shift+Tab; current mode shown in the StatusBar.

| Mode | Tool scope | Approvals | Behavior |
|---|---|---|---|
| **Plan** | read-only (`capabilityScope.allowActions` = explore/read/plan tools from core defaults) | n/a (no mutations) | Produces a plan; no file/shell changes |
| **Accept edits** | all tools | file edits + shell → `require_approval`; **diff preview** per edit | User approves/rejects each change (`always` to auto-approve that tool for the session) |
| **Autopilot** | all tools | auto-approve everything | Full autonomy; still renders diffs + can interrupt |

Implementation:
- `approvalPolicy`: a `PolicyRule` that, based on current mode, returns
  `require_approval` for mutating tools (fs write/patch, shell) — except in
  Autopilot (`allow`); Plan mode uses `capabilityScope` to deny mutations.
- `approvalHandler`: receives the `ApprovalRequest` (tool + input), renders
  `DiffView`/`ApprovalPrompt`, returns the user's decision; honors per-tool
  "always allow" for the session.

### 3.4 Effort / thinking (modelSelector.ts)
- Config/flag `--effort low|medium|high` (and `/effort`).
- Custom `ModelSelector` mapping effort → `ModelProfile`
  (`fastModel`/`defaultModel`/`reasoningModel`) + task-type hint, so higher effort
  selects the reasoning model and surfaces more of the Thinking panel.

### 3.5 Sessions (sessionService.ts + SessionPicker.tsx)
Over core `SessionStore`: `listSessions()` (sorted), `getSession()`,
`loadLatestSnapshot()` for resume. `/sessions` opens a fuzzy picker; `/resume
<id>` continues; `/new` starts fresh. Show goal, updatedAt, latest run, and a
telemetry summary (turns, tokens, errors) read from `sessions/<id>/telemetry/`.

---

## 4. Slash commands & keybindings

- **Slash**: `/new`, `/sessions`, `/resume <id>`, `/model <id>`,
  `/provider <id>`, `/effort <low|med|high>`, `/mode <plan|edits|auto>`, `/plan`,
  `/context` (window utilization), `/telemetry` (recent metrics/spans),
  `/help`, `/clear`, `/exit`.
- **Keys**: `Enter` send; `Shift+Tab` cycle mode; `Esc`/`Ctrl-C` interrupt run;
  `Ctrl-D` exit; arrow keys to scroll history / navigate picker;
  `Tab` to toggle the Thinking panel.

---

## 5. Config & auth

- `~/.microharness/config.json`: default provider/model, effort, mode, safety,
  redaction/privacy, telemetry (OTLP endpoint) — merged with env vars and flags
  (flags > env > file > defaults).
- API keys via env (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, …) resolved by core's
  built-in env credentials; Ollama needs none. No bespoke login flow in v1.
- Optional telemetry export: when configured, load the planned
  `@micro-harnesses/plugin-observability-otel` (see
  `docs/specs/observability-otel/plan.md`) to ship traces/metrics/logs to
  Jaeger/Tempo/Prometheus/Grafana.

---

## 6. Headless / scripting

- `mh -p "prompt" [--json]` → single run, prints final message (or JSON with
  turns/usage) to stdout; logs/telemetry to stderr/session. Non-TTY auto-denies
  approvals (safe default) unless `--mode autopilot`.
- `mh sessions list|show <id>` → JSON (preserve machine-readable contract).

---

## 7. Testing & validation

- **Unit**: arg parsing, config merge, mode state machine, `approvalPolicy`
  decisions per mode, `approvalHandler` diff/decision logic, `sessionService`,
  `uiStream` reducer (event → view-state), effort→profile mapping.
- **Component**: Ink components via `ink-testing-library` (streaming bubble,
  ToolCall states, DiffView, ApprovalPrompt, StatusBar values).
- **Integration**: a `FakeModel`/scripted provider driving a full run; assert
  streamed output, tool approval gating per mode, and session persistence.
- Follow repo conventions: build first, run compiled tests
  (`node --test "dist/**/*.test.js"`), Biome clean.
- **Add `apps/*` to root `workspaces`** so `npm run build|test|lint` cover the CLI.

---

## 8. Package & housekeeping changes

- `package.json`: rename to **`@micro-harnesses/cli`** (fix scope), version
  **1.0.0**, `bin: { mh, micro-harness }`, deps on real packages
  (`@micro-harnesses/core`, `@micro-harnesses/plugin-basic-tools`,
  `@micro-harnesses/plugin-example-tools`,
  `ink`, `react`, `ink-spinner`, `ink-text-input`, `diff`), add `test` script.
- Delete `src/**` and old `prompts/**`; write new persona prompts (coder + planner).
- Root `workspaces`: `["packages/*", "plugins/*", "apps/*"]`.
- Update `README.md` (CLI usage, modes, keybindings) and `docs/` cross-links.

---

## 9. Incorporated changes from this chat / core v1

- Consume the **observability v2** stream (`StreamSink`) for all live rendering,
  and the new **context-window metrics** (used/free/max/utilization) in the status
  bar — directly using the "how full/empty/total" telemetry added to core.
- Persist telemetry to `sessions/<id>/telemetry/` via `JsonlObservabilityExporter`.
- Optional OTLP export through the planned observability-otel plugin.
- Honor **redaction / privacy mode** from core for prompt/reasoning/tool content.
- Subagent **trace propagation** (`parentTrace`) wired in the subagent factory.
- Drop all removed concepts (`EventSink`, `HarnessRuntime`, phantom packages).

---

## 10. Milestones

1. **Reset & scaffold** — delete old `src`/prompts; new `package.json`/`tsconfig`;
   add `apps/*` to workspaces; Ink "hello chat" that echoes input; CJS/ESM spike.
2. **Composition on core v1** — providers + tools + plugins + observability +
   `Agent`; headless `mh -p` working end-to-end with streaming to stdout.
3. **Chat TUI** — ChatView, streaming assistant bubble, ThinkingPanel, ToolCall
   cards, StatusBar (model/effort/mode/ctx%/tokens/turns/errors), InputBar.
4. **Modes + approvals** — mode state machine, `approvalPolicy`, `approvalHandler`
   with `DiffView`, per-tool "always allow"; Plan/Accept-edits/Autopilot.
5. **Effort** — effort→model profile/task-type; Thinking panel depth by effort.
6. **Sessions** — sessionService + SessionPicker; `/new /resume /sessions`;
   telemetry summary.
7. **Slash commands + keybindings + config file + optional OTLP**.
8. **Tests + docs + polish**; validate full-workspace build/test/lint;
   bump/verify `1.0.0`.
