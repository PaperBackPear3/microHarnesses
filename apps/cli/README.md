# @micro-harnesses/cli

`mh` / `micro-harness` is the v2 interactive development assistant built on
`@micro-harnesses/core`.

## Install

```bash
npm install @micro-harnesses/cli
```

## After install

Run the CLI from the project that installed it:

```bash
npx mh
```

Or run a one-off prompt:

```bash
npx mh -p "list apps/cli/src/app"
```

If you want the binary on every shell without `npx`, add a script or install it globally.

## Update

If you already installed the CLI, update it with:

```bash
npm install @micro-harnesses/cli@latest
```

Then re-run `npx mh` (or your local script) to pick up the new version.

## UX notes

- Chat input/composer is anchored at the bottom of the terminal.
- Runtime status (mode/model/context/usage) is rendered in a footer below input to keep the typing area clean.
- In autopilot mode, prompts are augmented with an execution contract that pushes the agent to continue until the requested goal is finished.

## Context compression

The CLI compresses older turns when the session exceeds the context manager's
working-turn window (`maxWorkingTurns`, currently `16` in
`src/runtime/composition.ts`).

At each loop iteration the runtime asks `ContextManager.buildWorkingTurns(...)`
for:

- recent turns to keep verbatim
- an optional persisted summary of older turns

Compression triggers automatically only when there is **new overflow**:

`overflowTurns = totalTurns - maxWorkingTurns`

If `overflowTurns` grows beyond what was already summarized, the compressor runs
for that new delta and persists a new summary under
`.micro-harness/sessions/<session>/context/summaries/`.

### Default vs agentic compressor

- **Default compressor** (`@micro-harnesses/core`): deterministic heuristic
  scoring (recency/impact/goal-keyword match), no model calls.
- **Agentic compressor** (`@micro-harnesses/plugin-agentic-compression`, used by
  this CLI): spawns two subagents in parallel:
  - `context-summarizer` for `SUMMARY` + `HIGHLIGHTS`
  - `goal-finder` for refined `GOAL` + `SUBGOALS`

Both subagents inherit the CLI's currently selected provider/model/effort.
If subagent compression fails, it falls back to the default deterministic
compressor.

## Commands

- `mh` — start chat TUI
- `mh -p "prompt"` — headless single prompt
- `mh -p "prompt" --json` — machine-readable output
- `mh sessions list` — list saved sessions (JSON)
- `mh sessions show <session-id>` — show one session (JSON)

## Runtime flags

- `--provider <openai|anthropic|ollama>`
- `--model <model-id>`
- `--effort <low|medium|high>`
- `--mode <plan|accept-edits|autopilot>`
- `--session <id>`
- `--state-dir <path>`
- `--iterations <n>`
- `--snapshot-every <n>`
- `--max-tokens <n>`
- `--no-safety`

## TUI slash commands

- Modes: `/plan`, `/edits`, `/autopilot`, `/mode <...>`
- Model/provider: `/model <id>`, `/provider <id>`, `/effort <...>`
- Sessions: `/new`, `/sessions`, `/session <id>`, `/resume <id>`
- Screens: `/chat`, `/context`, `/telemetry`, `/help` (or `/commands`)
- Compression: `/compact` (force a compaction pass for the active session)
- Control: `/clear`, `/exit`

## Keybindings

- `Enter` send prompt
- `Shift+Tab` cycle mode (Plan → Accept-edits → Autopilot)
- `Ctrl+T` toggle latest thinking collapse
- `y / n / a` resolve pending approval (approve / reject / always allow tool)
- `Esc` or `Ctrl+C` interrupt current run
- `Ctrl+D` exit
- `/help` (or `/commands`) shows the complete command + shortcut list
