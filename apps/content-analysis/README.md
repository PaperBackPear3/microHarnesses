# Content Analysis App

Multimodal content analysis web app built on `@micro-harnesses/core`. Drop images, files, or URLs into it and get back:

- **Summary** – concise overview of the content
- **Categories** – model-inferred topic tags with confidence levels
- **Clarifications** – when content is ambiguous or unclear, the model surfaces the confusion and suggests what would help

---

## Prerequisites

- **Node.js ≥ 22**
- **Ollama** running locally with a vision-capable model (default: `gemma4:latest`)

```bash
# Install the model if you don't have it
ollama pull gemma4
```

---

## Running the app

From the **monorepo root**, build everything first (only needed once or after code changes):

```bash
npm run build
```

Then start the server:

```bash
node apps/content-analysis/dist/index.js
```

Open **http://localhost:3000** in your browser.

---

## Using the UI

1. **Drag & drop** files onto the upload zone, or click to browse.
2. **Add URLs** (images or web pages) with the URL input.
3. Optionally add **context** (what is this?) or **instructions** (what to focus on).
4. Click **Analyze** and wait for results.

The header shows the active provider and model. Results include a summary card, colour-coded category tags, expandable clarification cards, and a per-file breakdown.

---

## API

The same server also exposes a JSON API.

### `GET /health`

```json
{ "ok": true, "provider": "ollama", "model": "gemma4:latest", "maxTokens": 4096 }
```

### `POST /analyze` — JSON

```bash
curl -X POST http://localhost:3000/analyze \
  -H "Content-Type: application/json" \
  -d '{
    "urls": ["https://example.com/chart.png"],
    "text": "A quarterly sales chart",
    "instructions": "Focus on trends"
  }'
```

### `POST /analyze` — multipart/form-data

```bash
curl -X POST http://localhost:3000/analyze \
  -F "file=@./diagram.png" \
  -F "url=https://example.com/report.pdf" \
  -F "text=Context about the content" \
  -F "instructions=Focus on risks"
```

### Response shape

```jsonc
{
  "sessionId": "s-<uuid>",
  "runId": "<uuid>",
  "provider": "ollama",
  "model": "gemma4:latest",
  "summary": "A bar chart showing Q3 revenue…",
  "categories": [
    { "name": "Finance", "confidence": "high" },
    { "name": "Data Visualization", "confidence": "medium" }
  ],
  "clarifications": [
    {
      "issue": "Y-axis units are unclear",
      "bestEffortInterpretation": "Assumed USD thousands based on scale",
      "whatWouldHelp": "A labelled axis or caption"
    }
  ],
  "items": [
    {
      "source": "diagram.png",
      "mimeType": "image/png",
      "summary": "Bar chart…",
      "categories": ["Finance"]
    }
  ],
  "rawAssistantMessage": "…"
}
```

---

## Configuration

All settings are controlled via environment variables. Defaults work for a local Ollama setup.

| Variable | Default | Description |
|---|---|---|
| `CONTENT_ANALYSIS_PORT` | `3000` | HTTP port |
| `CONTENT_ANALYSIS_HOST` | `127.0.0.1` | Bind address (`0.0.0.0` to expose externally) |
| `CONTENT_ANALYSIS_PROVIDER` | `ollama` | Provider id (`ollama`, `openai`, `anthropic`) |
| `CONTENT_ANALYSIS_MODEL` | `gemma4:latest` | Model to use |
| `CONTENT_ANALYSIS_MAX_TOKENS` | `4096` | Max tokens per LLM call |
| `CONTENT_ANALYSIS_STATE_DIR` | `.micro-harness/content-analysis` | Session state directory |
| `CONTENT_ANALYSIS_PROMPTS_DIR` | `apps/content-analysis/prompts` | Prompt pack directory |
| `CONTENT_ANALYSIS_REQUEST_TIMEOUT_MS` | `15000` | HTTP request timeout (ms) |
| `CONTENT_ANALYSIS_MAX_REQUEST_BYTES` | `15728640` | Max request body size (15 MB) |
| `CONTENT_ANALYSIS_MAX_FETCH_BYTES` | `8388608` | Max bytes fetched from a URL (8 MB) |
| `CONTENT_ANALYSIS_MAX_REDIRECTS` | `3` | Max URL redirects to follow |
| `CONTENT_ANALYSIS_ALLOW_LOCAL_PATHS` | `false` | Allow `file://` / local path inputs |

### Using OpenAI or Anthropic

```bash
CONTENT_ANALYSIS_PROVIDER=openai \
CONTENT_ANALYSIS_MODEL=gpt-4o \
OPENAI_API_KEY=sk-... \
node apps/content-analysis/dist/index.js
```

```bash
CONTENT_ANALYSIS_PROVIDER=anthropic \
CONTENT_ANALYSIS_MODEL=claude-opus-4-5 \
ANTHROPIC_API_KEY=sk-ant-... \
node apps/content-analysis/dist/index.js
```

---

## Development

```bash
# Run tests (requires a build first)
npm run build
npm test --workspace=apps/content-analysis
```
