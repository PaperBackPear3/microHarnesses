# How to run the CLI

The reference CLI is in `apps/cli` and composes the core runtime with default plugins.

## 1. Set credentials

```bash
export OPENAI_API_KEY=sk-...
export ANTHROPIC_API_KEY=sk-ant-...
export OLLAMA_BASE_URL=http://127.0.0.1:11434/v1
```

## 2. Run with a cloud provider

```bash
npm run cli:run -- "summarise this task" --provider openai --model gpt-4.1-mini
```

## 3. Run interactive mode

```bash
npm run cli:run -- --provider openai --model gpt-4.1-mini
```

## 4. Run with a local model (Ollama)

```bash
ollama pull llama3.2:3b
npm run cli:run -- "small local task" --provider ollama --model llama3.2:3b
```

## 5. Inspect sessions

```bash
node apps/cli/dist/index.js sessions list
node apps/cli/dist/index.js sessions show <session-id>
node apps/cli/dist/index.js sessions resume <session-id> "continue task"
```
