import assert from "node:assert/strict";
import test from "node:test";
import { AnthropicEnvCredentials, OllamaEnvCredentials, OpenAIEnvCredentials } from "./credentials";

test("OllamaEnvCredentials returns default local config", async () => {
  const originalBase = process.env.OLLAMA_BASE_URL;
  const originalKey = process.env.OLLAMA_API_KEY;
  delete process.env.OLLAMA_BASE_URL;
  delete process.env.OLLAMA_API_KEY;

  try {
    const auth = await new OllamaEnvCredentials().resolve();
    assert.equal(auth.baseUrl, "http://127.0.0.1:11434/v1");
    assert.equal(auth.apiKey, "ollama");
  } finally {
    if (originalBase === undefined) delete process.env.OLLAMA_BASE_URL;
    else process.env.OLLAMA_BASE_URL = originalBase;
    if (originalKey === undefined) delete process.env.OLLAMA_API_KEY;
    else process.env.OLLAMA_API_KEY = originalKey;
  }
});

test("OpenAIEnvCredentials throws when OPENAI_API_KEY missing", async () => {
  const original = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    await assert.rejects(() => new OpenAIEnvCredentials().resolve(), /OPENAI_API_KEY/);
  } finally {
    if (original === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = original;
  }
});

test("OpenAIEnvCredentials returns configured auth", async () => {
  const originalKey = process.env.OPENAI_API_KEY;
  const originalBase = process.env.OPENAI_BASE_URL;
  process.env.OPENAI_API_KEY = "sk-test";
  process.env.OPENAI_BASE_URL = "https://example.test/v1";
  try {
    const auth = await new OpenAIEnvCredentials().resolve();
    assert.equal(auth.apiKey, "sk-test");
    assert.equal(auth.baseUrl, "https://example.test/v1");
  } finally {
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalKey;
    if (originalBase === undefined) delete process.env.OPENAI_BASE_URL;
    else process.env.OPENAI_BASE_URL = originalBase;
  }
});

test("AnthropicEnvCredentials throws when ANTHROPIC_API_KEY missing", async () => {
  const original = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    await assert.rejects(() => new AnthropicEnvCredentials().resolve(), /ANTHROPIC_API_KEY/);
  } finally {
    if (original === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = original;
  }
});
