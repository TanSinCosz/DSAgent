import assert from "node:assert/strict";
import test from "node:test";
import {
  OpenAICompatibleApiError,
  formatOpenAICompatibleErrorForUser,
  normalizeOpenAICompatibleApiError,
} from "../src/openai-compatible/errors.js";

const deepSeekErrorContext = {
  provider: "deepseek" as const,
  providerDisplayName: "DeepSeek",
};

test("DeepSeek API errors are classified with actionable messages", () => {
  const error = normalizeOpenAICompatibleApiError(
    {
      status: 429,
      message: "Rate limit exceeded",
    },
    deepSeekErrorContext,
  );

  assert.ok(error instanceof OpenAICompatibleApiError);
  assert.equal(error.status, 429);
  assert.equal(error.category, "rate_limited");
  assert.equal(error.retryable, true);
  assert.match(error.message, /429 - Rate limit reached/);
  assert.match(error.message, /Reduce concurrency/);
  assert.match(error.message, /Original: Rate limit exceeded/);
});

test("non API errors keep their original message", () => {
  const error = new Error("local failure");

  assert.equal(
    normalizeOpenAICompatibleApiError(error, deepSeekErrorContext),
    error,
  );
  assert.equal(formatOpenAICompatibleErrorForUser(error), "local failure");
});

test("known provider status codes include recovery hints", () => {
  const cases = [
    [400, /request payload/i],
    [401, /API key/i],
    [402, /Recharge/i],
    [422, /model, tools/i],
    [500, /Retry later/i],
    [503, /backoff/i],
  ] as const;

  for (const [status, pattern] of cases) {
    const error = normalizeOpenAICompatibleApiError(
      { status },
      deepSeekErrorContext,
    );
    assert.match(error.message, pattern);
  }
});
