import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { getUserConfigPath, loadConfig } from "../src/config/load-config.js";

const MODEL_ENV_KEYS = [
  "OPENCAT_CONFIG_PATH",
  "OPENCAT_MODEL_PROFILE",
  "OPENCAT_MODEL_PROVIDER",
  "OPENCAT_API_PROVIDER",
  "OPENCAT_API_KEY",
  "OPENCAT_API_BASE_URL",
  "OPENCAT_MODEL",
  "OPENCAT_MAX_TOKENS",
  "OPENCAT_REASONING_EFFORT",
  "ARK_API_KEY",
  "ARK_BASE_URL",
  "ARK_MODEL",
  "DEEPSEEK_API_KEY",
  "DEEPSEEK_BASE_URL",
  "DEEPSEEK_MODEL",
  "DEEPSEEK_USER_ID",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "OPENAI_MODEL",
  "TEST_ARK_KEY",
] as const;

test("loadConfig reads the user YAML model configuration", () => {
  withModelEnvironment({ TEST_ARK_KEY: "ark-secret" }, (directory) => {
    const configPath = path.join(directory, "config.yaml");
    writeFileSync(configPath, [
      "model:",
      "  provider: ark",
      "  apiKeyEnv: TEST_ARK_KEY",
      "  baseUrl: https://ark.example/api/v3",
      "  model: endpoint-id",
      "  maxTokens: 24576",
      "  reasoningEffort: high",
      "  headers:",
      "    X-Project: opencat",
      "",
    ].join("\n"));
    process.env.OPENCAT_CONFIG_PATH = configPath;

    const config = loadConfig();

    assert.equal(getUserConfigPath(), configPath);
    assert.equal(config.provider, "volcengine");
    assert.equal(config.apiKey, "ark-secret");
    assert.equal(config.baseUrl, "https://ark.example/api/v3");
    assert.equal(config.model, "endpoint-id");
    assert.equal(config.maxTokens, 24_576);
    assert.equal(config.reasoningEffort, "high");
    assert.deepEqual(config.headers, { "X-Project": "opencat" });
  });
});

test("loadConfig accepts a direct key in the private user YAML", () => {
  withModelEnvironment({}, (directory) => {
    const configPath = path.join(directory, "config.yaml");
    writeFileSync(configPath, [
      "model:",
      "  provider: volcengine",
      "  apiKey: local-ark-secret",
      "  baseUrl: https://ark.example/api/coding/v3",
      "  model: deepseek-v4-pro",
      "",
    ].join("\n"));
    process.env.OPENCAT_CONFIG_PATH = configPath;

    const config = loadConfig();

    assert.equal(config.apiKey, "local-ark-secret");
    assert.equal(config.provider, "volcengine");
  });
});

test("loadConfig selects a named model profile", () => {
  withModelEnvironment({ TEST_ARK_KEY: "ark-secret" }, (directory) => {
    const configPath = path.join(directory, "config.yaml");
    writeFileSync(configPath, [
      "activeProfile: ark-coding",
      "profiles:",
      "  ark-coding:",
      "    provider: volcengine",
      "    apiKeyEnv: TEST_ARK_KEY",
      "    baseUrl: https://ark.example/api/coding/v3",
      "    model: deepseek-v4-pro",
      "  deepseek:",
      "    provider: deepseek",
      "    apiKey: deepseek-secret",
      "    model: deepseek-v4-pro",
      "",
    ].join("\n"));
    process.env.OPENCAT_CONFIG_PATH = configPath;

    const config = loadConfig();

    assert.equal(config.profileName, "ark-coding");
    assert.equal(config.provider, "volcengine");
    assert.equal(config.apiKey, "ark-secret");
    assert.equal(config.baseUrl, "https://ark.example/api/coding/v3");
  });
});

test("OPENCAT_MODEL_PROFILE switches profiles without editing YAML", () => {
  withModelEnvironment({
    OPENCAT_MODEL_PROFILE: "custom",
    OPENAI_API_KEY: "openai-compatible-secret",
  }, (directory) => {
    const configPath = path.join(directory, "config.yaml");
    writeFileSync(configPath, [
      "activeProfile: deepseek",
      "profiles:",
      "  deepseek:",
      "    provider: deepseek",
      "    apiKey: deepseek-secret",
      "    model: deepseek-v4-pro",
      "  custom:",
      "    provider: openai-compatible",
      "    apiKeyEnv: OPENAI_API_KEY",
      "    baseUrl: https://gateway.example/v1",
      "    model: custom-model",
      "",
    ].join("\n"));
    process.env.OPENCAT_CONFIG_PATH = configPath;

    const config = loadConfig();

    assert.equal(config.profileName, "custom");
    assert.equal(config.provider, "openai-compatible");
    assert.equal(config.apiKey, "openai-compatible-secret");
    assert.equal(config.baseUrl, "https://gateway.example/v1");
    assert.equal(config.model, "custom-model");
  });
});

test("model environment variables override YAML values", () => {
  withModelEnvironment({
    OPENCAT_MODEL_PROVIDER: "deepseek",
    OPENCAT_API_KEY: "override-key",
    OPENCAT_API_BASE_URL: "https://gateway.example/v1",
    OPENCAT_MODEL: "deepseek-custom",
    OPENCAT_MAX_TOKENS: "16384",
    OPENCAT_REASONING_EFFORT: "low",
    DEEPSEEK_USER_ID: "worker-7",
  }, (directory) => {
    const configPath = path.join(directory, "config.yaml");
    writeFileSync(configPath, [
      "model:",
      "  provider: volcengine",
      "  apiKeyEnv: TEST_ARK_KEY",
      "  model: yaml-model",
      "  maxTokens: 1000",
      "",
    ].join("\n"));
    process.env.OPENCAT_CONFIG_PATH = configPath;

    const config = loadConfig();

    assert.equal(config.provider, "deepseek");
    assert.equal(config.apiKey, "override-key");
    assert.equal(config.baseUrl, "https://gateway.example/v1");
    assert.equal(config.model, "deepseek-custom");
    assert.equal(config.maxTokens, 16_384);
    assert.equal(config.reasoningEffort, "low");
    assert.equal(config.userId, "worker-7");
  });
});

test("loadConfig keeps DeepSeek defaults when the YAML file is absent", () => {
  withModelEnvironment({ DEEPSEEK_API_KEY: "deepseek-secret" }, (directory) => {
    process.env.OPENCAT_CONFIG_PATH = path.join(directory, "missing.yaml");

    const config = loadConfig();

    assert.equal(config.provider, "deepseek");
    assert.equal(config.apiKey, "deepseek-secret");
    assert.equal(config.model, "deepseek-v4-pro");
    assert.equal(config.maxTokens, 32_768);
    assert.equal(config.reasoningEffort, "max");
  });
});

test("loadConfig rejects invalid YAML model settings", () => {
  withModelEnvironment({}, (directory) => {
    const configPath = path.join(directory, "config.yaml");
    writeFileSync(configPath, [
      "model:",
      "  provider: unsupported-provider",
      "  maxTokens: -1",
      "",
    ].join("\n"));
    process.env.OPENCAT_CONFIG_PATH = configPath;

    assert.throws(
      () => loadConfig(),
      /Unsupported model provider 'unsupported-provider'/,
    );
  });
});

test("loadConfig rejects an API key value used as apiKeyEnv", () => {
  withModelEnvironment({}, (directory) => {
    const configPath = path.join(directory, "config.yaml");
    writeFileSync(configPath, [
      "model:",
      "  provider: volcengine",
      "  apiKeyEnv: ark-secret-value",
      "  model: endpoint-id",
      "",
    ].join("\n"));
    process.env.OPENCAT_CONFIG_PATH = configPath;

    assert.throws(
      () => loadConfig(),
      /apiKeyEnv must be an environment variable name such as ARK_API_KEY/,
    );
  });
});

function withModelEnvironment(
  values: Partial<Record<(typeof MODEL_ENV_KEYS)[number], string>>,
  run: (directory: string) => void,
): void {
  const previous = new Map<string, string | undefined>();
  for (const key of MODEL_ENV_KEYS) {
    previous.set(key, process.env[key]);
    delete process.env[key];
  }
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) {
      process.env[key] = value;
    }
  }

  const directory = mkdtempSync(path.join(tmpdir(), "opencat-model-config-"));
  try {
    run(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}
