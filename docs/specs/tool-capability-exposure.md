# Spec: Tool capability exposure for model-driven tool use

- **Status:** Proposed
- **Target:** `@micro-harness/core`, `@micro-harness/providers`, `apps/cli`
- **Problem date:** 2026-07-03

## Context

Today, tools are registered in `ToolRegistry` and executable by the runtime, but
the model is primarily informed via prompt text (`tools.md`). This creates a gap:

1. Plugin-added tools are not guaranteed to be visible to the model unless prompt content is manually updated.
2. Natural-language requests (for example "explore the codebase") depend on prompt wording rather than a canonical, runtime-derived tool catalog.
3. Provider adapters do not receive structured tool definitions (`tools` / function schema payloads), even when providers support them.

## Goals

1. Make all registered tools (including plugin tools) discoverable to the model automatically.
2. Support provider-native structured tool calling where available.
3. Keep full backward compatibility for existing plugins and providers.
4. Preserve project principles: plugin-first, explicit capabilities, composability, zero runtime deps in core, behavior-safe defaults.
5. Ensure subagent runs expose only the filtered child tool set.

## Non-goals

1. No change to policy enforcement semantics (policy remains authoritative server-side).
2. No mandatory schema migration for existing tools.
3. No provider lock-in or provider-specific behavior leaking into core abstractions.

## Design principles alignment

1. **Plugin-first:** tool exposure is derived from `ToolRegistry`, so plugins remain the source of truth.
2. **Composable interfaces:** add optional interfaces/fields; avoid hard-coding provider behavior in runtime.
3. **Capability-safe:** no new plugin capability required to register ordinary tools.
4. **Core remains dependency-light:** implement with existing TypeScript + runtime primitives only.
5. **Most-restrictive safety preserved:** model awareness of tools never bypasses policy/approval gates.

## Proposed architecture

### 1) Canonical tool descriptors in core

Extend `ToolDefinition` with optional metadata for model exposure:

```ts
interface ToolDefinition {
  name: string;
  description: string;
  risk: "low" | "high";
  inputAnnotations?: ToolInputAnnotation[];
  inputSchema?: Record<string, unknown>; // JSON-Schema-like (optional)
  execute(input: Record<string, unknown>, context?: ToolExecutionContext): Promise<Record<string, unknown>>;
}
```

Add internal descriptor shape in core:

```ts
interface ToolDescriptor {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>; // explicit schema or synthesized fallback
}
```

If `inputSchema` is missing, synthesize a conservative default:

```json
{ "type": "object", "additionalProperties": true }
```

### 2) Pass tools through model boundary

Extend model/provider request types:

```ts
interface StepInput {
  // existing fields...
  availableTools?: ToolDescriptor[];
}

interface CompletionRequest {
  model: string;
  messages: ProviderMessage[];
  maxTokens?: number;
  temperature?: number;
  tools?: ToolDescriptor[];
}
```

### 3) Provider capability negotiation

Extend `ProviderAdapter` with optional features:

```ts
interface ProviderAdapter {
  providerId: ProviderId;
  defaultModel?: string;
  features?: { structuredTools?: boolean };
  complete(request: CompletionRequest, auth: ProviderAuth): Promise<ProviderResponse>;
}
```

Behavior:

1. If `features.structuredTools === true`, adapter maps `tools` to provider-native tool/function payloads.
2. If false/undefined, adapter ignores `tools`; runtime fallback still provides tool awareness via prompt injection.

### 4) Runtime-driven tool context (provider-agnostic fallback)

In `ProviderModelAdapter.nextStep`:

1. Read tools from `ToolRegistry`.
2. Build `ToolDescriptor[]`.
3. Add descriptors to `CompletionRequest.tools`.
4. If adapter does not support structured tools, append a generated developer/tool instruction that lists available tools and expected call shape.

This keeps compatibility with providers that do not support tool schema APIs.

### 5) Subagent inheritance

No new subagent API required. Child runtimes already get a filtered `ToolRegistry`;
tool descriptors are generated from that registry, so exposure remains bounded by
`allowedTools` and recursion safeguards.

## CLI-specific behavior

1. Keep `apps/cli/prompts/default/tools.md` as optional static guidance, but do not rely on it as the only tool source.
2. Ensure default CLI runs expose all auto-registered plugin tools (`echo`, `time`, `spawn_subagent`, `plan_agent`, `explore_agent`, `plan_mode_info`) without users naming them explicitly.

## Policy and safety

1. Tool execution still goes through `ToolExecutionEngine` and `ToolPolicyEngine`.
2. `require_approval` flow remains unchanged.
3. Unknown tool names continue to fail deterministically (`UnknownToolError` path).
4. Structured tool exposure must not execute anything by itself; execution remains explicit on tool-call path only.

## Backward compatibility

1. Existing plugins compiling against current `ToolDefinition` continue to work (`inputSchema` optional).
2. Existing providers continue to work (`features` optional; `tools` optional request field).
3. Existing prompts continue to work; generated tool context is additive.

## Implementation plan

1. **Core types and registry**
   - Add optional `inputSchema` to `ToolDefinition`.
   - Add helper to derive `ToolDescriptor[]` from `ToolRegistry`.
2. **Model/provider plumbing**
   - Add `availableTools` in `StepInput`.
   - Add `tools` in `CompletionRequest`.
   - Thread values through `HarnessRuntime` -> `ProviderModelAdapter` -> provider adapter.
3. **Providers**
   - OpenAI/Ollama adapters: emit `tools` payload in chat completions.
   - Anthropic adapter: emit `tools` payload in messages API format.
   - Parse tool-call responses exactly as today.
4. **Fallback generation**
   - Add provider-agnostic text renderer for tool catalog when structured tools are unavailable.
5. **Tests**
   - Unit: descriptor derivation, fallback rendering.
   - Adapter tests: outgoing payload includes tools when supported.
   - Runtime integration: plugin tool can be called without being manually listed in prompt files.
   - Subagent integration: child tool catalog respects `allowedTools`.

## Acceptance criteria

1. With CLI defaults, a prompt like "explore code under apps/cli/src" can trigger `explore_agent` without explicitly naming it.
2. Adding a new plugin tool automatically exposes it to the model in the same run.
3. Providers with structured tools receive schema payload; providers without it still get generated tool context text.
4. No regression in policy enforcement, approval behavior, or unknown-tool handling.
5. Existing public package APIs remain source-compatible for downstream plugin authors.

## Risks and mitigations

1. **Risk:** schema quality varies across tools.  
   **Mitigation:** allow optional explicit schema; fallback stays permissive.
2. **Risk:** large tool catalogs inflate prompt tokens.  
   **Mitigation:** add configurable truncation/summarization strategy in renderer.
3. **Risk:** provider payload divergence.  
   **Mitigation:** keep provider-specific mapping inside adapters; core remains provider-agnostic.

## Open questions

1. Should tool exposure be configurable per run (for example `--tool-exposure=structured|prompt|auto`)?
2. Should we add optional output schema metadata for better post-call validation?
3. Should we add per-tool "read_only" metadata for model planning heuristics?
