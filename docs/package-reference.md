# Package reference and concepts

This page documents package functionality and the concepts each package is responsible for.

## `@micro-harnesses/core`

**Role**: reusable runtime library.

### Main capabilities

- Runtime loop (`Agent`)
- Tool/skill/channel registries and execution engines
- Context + session persistence (`ContextManager`, `SessionStore`)
- Policy model (`DefaultPolicyEngine`, `CompositePolicyEngine`, `PolicyRule`)
- Plugin host + capability enforcement (`PluginHost`)
- Provider + credentials registries
- Subagent primitive (`InProcessSubagentRunner`)

### Concepts

- **Interfaces first**: model, prompts, policy, session, tools are all replaceable seams.
- **Capability boundaries**: plugin APIs are guarded by declared capabilities.
- **Most restrictive wins**: policy composition can only increase restrictions.
- **Prompt pack convention**: `FsPromptSource` uses `<rootDir>/<promptName>/system.md` plus optional sections (`developer`, `tools`, and custom sections).

---

## `@micro-harnesses/plugin-basic-tools`

**Role**: workspace-scoped mutation and shell tools.

### Tools

- `fs_write`
- `fs_append`
- `fs_mkdir`
- `fs_move`
- `fs_remove`
- `shell_exec`

### Concepts

- **Workspace confinement** via root directory resolution.
- **Bounded execution** for shell calls (timeout, output caps, abort support).
- **High-risk classification** so policy engines can gate mutation/command tools.

---

## `@micro-harnesses/plugin-plan-mode`

**Role**: read-only planning and exploration.

### Tools

- `plan_agent`
- `explore_agent`
- `plan_mode_info`

### Concepts

- **Read-only guarantees**: no writes, no process execution, no network calls.
- **Planning-first workflow**: generate ordered steps before mutating code.
- **Targeted exploration**: query and inspect repository files safely.

---

## `@micro-harnesses/plugin-example-tools`

**Role**: minimal reference plugin for authors.

### Tools

- `echo`
- `time`

### Concepts

- **Authoring template**: smallest complete plugin shape.
- **Low-risk tool definition**: simple schemas and deterministic outputs.

## Composition recommendation

Keep core generic and stable, then package environment-specific behavior into plugins. This preserves reuse and makes safety posture explicit in your composition root.
