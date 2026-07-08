# Planner Prompt and CLI Composition Alignment Plan

Date: 2026-07-08
Status: Proposed (not implemented)
Owner: CLI/Core maintainers

## Problem Summary

Current behavior has a mismatch between planning mode and planner persona:

- `/plan` switches runtime mode, but main runs still use the `coder` prompt pack.
- `plan_agent` is a built-in templated planner tool and does not use `prompts/planner/*`.
- The `planner` prompt pack exists but is not part of the primary planning flow.

This creates inconsistent expectations and weakens prompt-pack intent.

## Goals

1. Make planning behavior predictable and explicit.
2. Ensure planner persona is used when users choose planning workflow.
3. Keep `plan_agent` available as an optional helper, not the hidden primary planner.
4. Add tests so behavior cannot regress silently.

## Non-Goals

- Rewriting the full plan-mode policy model.
- Removing `plan_agent` in this iteration.
- Redesigning all prompt packs.

## Proposed Design

### 1) Introduce explicit persona selection in CLI runtime state

Add a runtime-level prompt persona selection for the main agent, defaulting to `coder`.

- New runtime state field: `promptName` (default `coder`).
- Main `agent.run(...)` should use the selected persona for prompt loading.

### 2) Bind `/plan` to planner persona by default

When user selects `/plan`:

- Set mode to `plan`.
- Set main persona to `planner`.

When user selects `/edits` or `/autopilot`:

- Set mode accordingly.
- Restore persona to `coder` by default (unless a future explicit persona override is active).

### 3) Keep `plan_agent` as helper tool only

Do not remove `plan_agent` now.

- Keep it in plan allowed tools.
- Update wording in prompt/tool docs so `plan_agent` is a utility, not the implicit planner persona.

### 4) Add explicit persona controls (optional but recommended)

Add slash command support:

- `/persona` to show current persona.
- `/persona <name>` to set (`coder`, `planner`, and any installed prompt pack).

This makes behavior transparent and debuggable.

### 5) Validate prompt-pack existence for main persona changes

Reuse existing pack validation approach (safe id + installed pack check) when switching main persona to avoid runtime surprises.

## Files Likely to Change

CLI runtime/composition:

- `apps/cli/src/runtime/composition.ts`
- `apps/cli/src/runtime/subagentPromptName.ts` (extract/reuse generic pack validation if needed)

CLI command handling:

- `apps/cli/src/slash/commands.ts`
- `apps/cli/src/app/slashController.ts`

Prompt docs/guidance:

- `apps/cli/prompts/coder/tools.md`
- `apps/cli/prompts/planner/system.md` (only if wording needs alignment)
- `apps/cli/README.md` (mode/persona behavior)

Core planning tool docs only (behavior unchanged in this phase):

- `packages/core/src/defaults/tools/planMode.ts` (description text if needed)

## Test Plan

### Unit tests

1. Slash parsing

- Parse `/persona` and `/persona <name>` commands.
- Preserve existing mode commands.

2. Slash controller behavior

- `/plan` sets mode to `plan` and persona to `planner`.
- `/edits` and `/autopilot` set persona defaults as designed.

3. Composition/run options

- Main run uses selected persona for prompt loading.
- Invalid persona names are rejected with clear error.

4. Subagent behavior regression checks

- Existing `spawn_subagent` default promptName remains `coder` unless explicitly provided.

### Integration-style checks

1. Prompt loading flow

- In plan mode, verify `prompts/planner/system.md` is loaded for main runs.
- In edits mode, verify `prompts/coder/system.md` is loaded for main runs.

2. Backward compatibility

- Existing workflows without persona commands continue to work.
- Existing agentic compression subagents (`context-summarizer`, `goal-finder`) remain unaffected.

## Rollout Strategy

Phase 1 (minimal, high impact):

- Wire mode-to-persona behavior (`/plan` => `planner`, others => `coder`).
- Add/update tests for this behavior.

Phase 2 (clarity/UX):

- Add `/persona` command and prompt-pack validation.
- Update help/README and prompt guidance.

Phase 3 (optional refinement):

- Revisit whether `plan_agent` should be reduced, refactored, or remain as-is.

## Risks and Mitigations

1. Risk: Surprising users who rely on current hidden behavior.

- Mitigation: Document mode/persona mapping in help and README.

2. Risk: Prompt-pack missing in custom `--prompts-dir`.

- Mitigation: Validate pack existence and provide actionable error listing valid packs.

3. Risk: Test fragility due to runtime composition internals.

- Mitigation: Assert behavior via observable outputs/events where possible.

## Acceptance Criteria

1. Running `/plan` causes main planning runs to use planner prompt pack content.
2. Running `/edits` or `/autopilot` restores coder prompt pack for main runs.
3. `plan_agent` remains callable in plan mode.
4. Tests cover mode/persona mapping and pass in CI.
5. Documentation clearly states difference between mode and persona.
