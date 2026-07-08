# Multimodal Inputs and File Attachments Plan

Date: 2026-07-08
Status: Proposed (not implemented)
Owner: Core and CLI maintainers

## Problem Summary

The runtime is currently text-only at the model boundary even though some target
providers and models can already accept richer inputs.

Current gaps:

- Core turn state stores `userMessage` and `assistantMessage` as plain strings.
- Provider request messages use `content: string`, so the runtime cannot express
  images, PDFs, or other file-backed inputs.
- The session store persists snapshots of text turns only; there is no place for
  session-scoped input assets.
- CLI input flow has no first-class attachment concept, so even provider-capable
  models cannot receive files.

This means multimodal-capable providers are artificially constrained by core's
text-only abstractions.

## Goals

1. Add provider-agnostic support for user-supplied images and file inputs.
2. Keep core as the owning layer for content modeling, persistence, and provider
   request shaping.
3. Let CLI and other frontends attach files without embedding provider-specific
   request formats.
4. Preserve backward compatibility for existing text-only callers.
5. Make provider capability differences explicit so unsupported models fail
   clearly before request execution.

## Non-Goals

- Full assistant-side multimodal output rendering in the first iteration.
- Audio/video capture workflows.
- OCR, PDF extraction, or automatic preprocessing pipelines beyond what a model
  natively supports.
- A generic binary artifact system for every tool output type.

## Design Summary

The design should be additive and layered:

1. Core introduces structured conversation content parts and file references.
2. Session storage gains a dedicated input-asset area so snapshots persist
   metadata, not large inline blobs.
3. The provider layer maps core content parts into each provider's wire format.
4. CLI adds attachment intake, validation, and session-aware persistence.

The first iteration should focus on user input attachments only. Assistant text
output remains unchanged unless a provider returns structured output that we need
to preserve later.

## Proposed Core Changes

### 1) Add structured message content types

Introduce provider-agnostic content-part types in core rather than overloading
raw provider payloads.

Suggested shape:

```ts
export type MessageContentPart =
  | { type: "text"; text: string }
  | {
      type: "image";
      assetId: string;
      mimeType: string;
      detail?: "low" | "high" | "auto";
      altText?: string;
    }
  | {
      type: "file";
      assetId: string;
      mimeType: string;
      filename: string;
      title?: string;
    };
```

Core should also define persisted asset metadata separately from message parts:

```ts
export interface InputAsset {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  storagePath: string; // session-relative
  source?: { kind: "path" | "url"; value: string };
  sha256?: string;
  createdAt: string;
}
```

### 2) Extend runtime state without breaking existing callers

Do not replace text fields immediately. Add structured fields alongside them.

Suggested additions to `Turn`:

```ts
userContent?: MessageContentPart[];
assistantContent?: MessageContentPart[];
```

Rules:

- `userMessage` remains the text projection used by existing code paths.
- `userContent` becomes the authoritative structured input when present.
- For text-only calls, core synthesizes `userContent = [{ type: "text", text: userMessage }]`.
- `assistantContent` can be deferred or left text-only in phase 1, but adding the
  field now avoids another type migration later.

### 3) Extend provider request types

`ProviderMessage.content` should support structured parts.

Suggested change:

```ts
export interface ProviderMessage {
  role: "system" | "developer" | "user" | "assistant";
  content: string | ProviderContentPart[];
}
```

Where `ProviderContentPart` is still provider-agnostic and narrower than any one
vendor SDK shape.

`ProviderModelAdapter.buildMessages(...)` becomes the central conversion point:

- System/developer messages stay text.
- User turns emit structured parts when attachments exist.
- Text-only turns keep producing string content.
- Tool feedback remains text in phase 1.

This keeps multimodal behavior contained to the actual provider boundary instead
of leaking SDK-specific objects into runtime state.

### 4) Add provider capability declarations

Provider support is not uniform. Core should make that explicit.

Extend `ProviderAdapter.features` with something like:

```ts
features?: {
  structuredTools?: boolean;
  inputParts?: {
    text: boolean;
    image?: boolean;
    file?: boolean;
    urlSource?: boolean;
    inlineBinary?: boolean;
  };
};
```

Use cases:

- CLI can block unsupported attachments before the run starts.
- Routing can prefer multimodal-capable routes later.
- Core can fail fast with a clear error when a run includes unsupported parts.

### 5) Add session-scoped input asset persistence

Do not store base64 payloads inside snapshots. Persist files once per session and
reference them by id from turns.

Suggested layout:

```text
sessions/<sessionId>/
  manifest.json
  snapshots/
  artifacts/
    tool-output/
  inputs/
    assets.json
    <assetId>-<sanitized-name>
```

Recommended `SessionStore` additions:

- `saveInputAsset(sessionId, sourcePathOrUrl, options)`
- `getInputAsset(sessionId, assetId)`
- `listInputAssets(sessionId)`

Behavior:

- Copy local files into the session input directory.
- Persist metadata in `assets.json`.
- Reference only `assetId` from turn content.
- Keep snapshots small and deterministic.

This mirrors the existing session-owned artifact model instead of introducing a
second unrelated storage root.

### 6) Update context and compression behavior

Context management cannot stay purely string-based once turns carry files.

Phase 1 behavior:

- Token estimation uses text only plus a small fixed per-attachment surcharge.
- Compression summaries mention attachment metadata, not binary content.
- Highlight strings include markers like `attachments=2 [image/png, application/pdf]`.

Do not attempt provider-accurate multimodal token accounting in the first pass.
That varies heavily by vendor and is better treated as a later refinement.

### 7) Extend agent invoke surface carefully

Current `AgentInvokeRequest` uses `prompt: string`. That is too narrow for file
attachments.

Recommended additive API:

```ts
interface AgentUserInput {
  text?: string;
  content?: MessageContentPart[];
}

interface AgentInvokeRequest {
  prompt: string; // preserved shorthand
  input?: AgentUserInput;
  execution: RunOptions;
}
```

Semantics:

- Existing callers continue passing `prompt` only.
- New callers set `input.content` and may also set `input.text` for the display
  projection.
- Runtime stores both `userMessage` and `userContent` on the first turn.

## Provider Adapter Plan

### OpenAI-compatible adapter

This is the easiest first target because the OpenAI-compatible chat schema
already supports array content parts for multimodal models.

Plan:

- Widen `toBody()` to pass string content or structured parts.
- Map core image/file parts to OpenAI-compatible content arrays.
- Support `image_url` first.
- Add file/document support only for models/endpoints that actually expose it;
  keep the mapping capability-gated.

### Anthropic adapter

Anthropic already uses structured `content` blocks in its SDK, so the adapter is
well-positioned for this work.

Plan:

- Change `toRequestBody()` to emit mixed `text` and document/image blocks.
- Preserve system/developer messages as text.
- Gate document and image support via `features.inputParts`.

### Ollama and other OpenAI-compatible providers

Treat these as capability-dependent, not universally multimodal.

Plan:

- The adapter class can support structured parts.
- Individual composed routes or providers decide whether image/file inputs are
  enabled.
- Do not assume every OpenAI-compatible server supports the same multimodal
  schema.

## CLI Plan

CLI should be an ingestion and UX layer, not the owner of multimodal semantics.

### 1) Introduce attachment intake in CLI app state

Add pending attachment state near the composer/runtime state.

Possible user flows:

- `/attach <path>` to stage a local file for the next user turn.
- Repeated `/attach` calls add multiple files.
- `/attachments` shows staged files.
- `/detach <index|name>` removes one.
- Sending the next prompt consumes the staged attachments into the run.

This keeps terminal UX simple and does not require a full-screen file picker.

### 2) Validate early in CLI

Before invoking the agent:

- Validate the path exists and is a file.
- Infer MIME type from extension or sniffing helper.
- Check max file size policy.
- Check current provider/model capability before sending.

CLI should surface actionable errors like:

- current model does not support image inputs
- PDF inputs require a provider with `file` support
- file exceeds configured size limit

### 3) Persist attachments through core session storage

CLI should not hold raw file paths as the only source of truth after send.

Flow:

1. User stages a path.
2. Before the run, CLI asks core/session storage to save the input asset.
3. CLI passes content parts referencing the persisted `assetId`.
4. Session snapshots and resumed runs continue to work even if the original file
   moves.

### 4) Update session inspection output

`sessions show` currently dumps raw manifest data only. As attachment support is
added, session inspection should eventually expose attachment metadata as part of
run snapshots or via a dedicated session-inspection command.

That is a follow-up, not a blocker for core support, but it should be kept in
scope for operability.

## Context, Resume, and Replay Rules

Resume behavior matters more once turns depend on external files.

Required rules:

- Resumed runs must reload input asset metadata from session storage.
- Provider request shaping must resolve assets relative to session state, not the
  original CLI working directory.
- Older snapshots remain readable because new content fields are optional.
- If a referenced asset file is missing, runtime should fail with a targeted
  corruption error.

## Testing Plan

### Core unit tests

1. `ProviderModelAdapter` emits structured provider messages when `userContent`
   includes image/file parts.
2. Text-only runs remain byte-for-byte compatible where expected.
3. Unsupported provider capability rejects multimodal input before request send.
4. Context compression mentions attachments without trying to inline content.

### Session tests

1. Saving an input asset copies it into the session input directory.
2. Snapshots persist `assetId` references and reload correctly.
3. Resume still works after the original source file is removed.

### Provider adapter tests

1. OpenAI-compatible adapter maps image parts to content arrays correctly.
2. Anthropic adapter maps image/document parts to SDK blocks correctly.
3. Providers without declared support reject attachments clearly.

### CLI tests

1. `/attach` stages files and shows them in composer state.
2. Sending a prompt converts staged files into `input.content`.
3. Validation errors are clear for missing files, oversize files, and unsupported
   models.

## Rollout Plan

### Phase 1: Core types and persistence

- Add content-part and asset metadata types.
- Extend `Turn`, invoke input, and provider request types additively.
- Add session input asset persistence.
- Keep all existing text-only flows working.

### Phase 2: Provider request shaping

- Update `ProviderModelAdapter.buildMessages(...)`.
- Implement OpenAI-compatible image support.
- Implement Anthropic image/document support.
- Add capability gating and clear runtime errors.

### Phase 3: CLI attachment UX

- Add staged attachment commands and state.
- Persist assets through session storage before invocation.
- Add tests for send/resume behavior.

### Phase 4: Follow-up refinements

- Add richer session inspection for attachment metadata.
- Improve token estimation heuristics for multimodal inputs.
- Consider route filtering or scoring based on multimodal capabilities.

## Risks and Mitigations

1. Risk: bloating snapshots with binary data.

Mitigation: store only asset references in snapshots and keep bytes in session
input storage.

2. Risk: provider capability mismatch across OpenAI-compatible servers.

Mitigation: declare capability support explicitly per provider/route instead of
assuming schema compatibility implies feature compatibility.

3. Risk: resume breaks if attachments rely on original local paths.

Mitigation: copy files into session-owned storage before first send.

4. Risk: compression and token estimates become misleading.

Mitigation: ship conservative heuristics first and avoid claiming exact
multimodal token accounting.

## Acceptance Criteria

1. Core can represent a user turn containing text plus at least one image or
   file attachment.
2. Session state persists attachment references and resumes successfully.
3. OpenAI-compatible and Anthropic adapters can send supported multimodal input
   parts.
4. CLI can stage and send local files with clear validation errors.
5. Text-only existing callers continue to work without changes.
