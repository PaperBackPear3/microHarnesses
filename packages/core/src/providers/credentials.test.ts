import assert from "node:assert/strict";
import test from "node:test";
import { EnvCredentialsResolver } from "./credentials";

test("EnvCredentialsResolver returns default local config for ollama", async () => {
  const originalBase = process.env.OLLAMA_BASE_URL;
  const originalKey = process.env.OLLAMA_API_KEY;
  delete process.env.OLLAMA_BASE_URL;
  delete process.env.OLLAMA_API_KEY;

  try {
    const resolver = new EnvCredentialsResolver();
    const auth = await resolver.resolve("ollama");
    assert.equal(auth.baseUrl, "http://127.0.0.1:11434/v1");
    assert.equal(auth.apiKey, "ollama");
  } finally {
    if (originalBase === undefined) {
      delete process.env.OLLAMA_BASE_URL;
    } else {
      process.env.OLLAMA_BASE_URL = originalBase;
    }
    if (originalKey === undefined) {
      delete process.env.OLLAMA_API_KEY;
    } else {
      process.env.OLLAMA_API_KEY = originalKey;
    }
  }
});
