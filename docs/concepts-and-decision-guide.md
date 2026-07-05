# Concepts and decision guide

This guide is for teams building apps on top of `@micro-harnesses/core`.

## Who should use what

| You are | Start with | Add when needed |
|---|---|---|
| App team building one agent workflow | `Agent` + `FsPromptSource` + read-only tools | `SessionStore`, `CompositePolicyEngine`, approval handler |
| Platform team supporting many agents | `PluginHost` + capability-declared plugins | custom policy rules, custom provider plugins, governance rules |
| Security-sensitive deployment | `CompositePolicyEngine` + `createCommandSafetyRule()` | strict safety mode, approval UX, audited high-risk tools |
| Local/offline-first workflow | built-in `ollama` provider registration + local models | custom provider adapters for internal gateways |

## Composition choices

### 1) Direct runtime vs plugin host

- Use **direct runtime wiring** when your tool/provider set is small and static.
- Use **PluginHost** when you need modular ownership, dynamic loading, or capability boundaries.

### 2) Core defaults vs explicit registration

- `registerCoreDefaults(...)` is the fastest path to bootstrap built-in providers and selected tools.
- Fully explicit registration is better when you need stricter control and minimal surface area.

### 3) Single-agent vs subagent workflows

- Use a **single runtime** for straightforward tasks.
- Use **subagents** when one task needs isolated delegated runs with limited tool scope.

### 4) Prompt source choice

- Use `FsPromptSource` for markdown prompt packs checked into source control.
- Implement custom `PromptSource` when prompts come from DB, API, or dynamic generation.

## Policy and safety model (practical)

- Mark mutation/exec tools as high risk.
- Use `DefaultPolicyEngine` for baseline behavior.
- Add `CompositePolicyEngine` rules for domain-specific restrictions.
- Add approval handling for `require_approval` paths to keep high-risk actions user-mediated.

## Prompt architecture recommendation

For `FsPromptSource` prompt packs:

- `system.md` -> stable role and non-negotiable guardrails
- `developer.md` -> workflow and output contract for this app
- `tools.md` -> tool usage constraints and discovery hints
- custom sections -> domain-specific conventions (`constraints.md`, `examples.md`, ...)

## Provider strategy recommendation

- Start with built-in providers for speed.
- Keep provider choice in composition, not in core logic.
- Use environment-based credentials for local/dev and pluggable resolvers for production.

## Common anti-patterns to avoid

- Putting app-specific workflow logic inside core runtime code.
- Using one huge plugin instead of focused capability plugins.
- Relying on command safety screening as if it were a sandbox.
- Treating `developer.md` as optional when you require consistent review or output shape.
