import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import { parse as parseYaml } from "yaml";

import {
  resolveModelProvider,
  type ModelProvider,
} from "../openai-compatible/provider.js";
import {
  normalizeModelRuntimeSettings,
  type ModelRuntimeSettings,
} from "../types/config.js";

const DEFAULT_CONFIG_PATH = path.join(homedir(), ".opencat", "config.yaml");
const DEFAULT_ARK_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3";
const DEFAULT_DEEPSEEK_MODEL = "deepseek-v4-pro";
const DEFAULT_MAX_TOKENS = 32_768;

type UserModelConfig = {
  profileName?: string;
  provider?: ModelProvider;
  apiKey?: string;
  apiKeyEnv?: string;
  baseUrl?: string;
  model?: string;
  maxTokens?: number;
  reasoningEffort?: ModelRuntimeSettings["reasoningEffort"];
  userId?: string;
  headers?: Record<string, string>;
};

export function loadConfig(): ModelRuntimeSettings {
  const fileConfig = loadUserModelConfig();
  const configuredProvider = parseProvider(
    envString("OPENCAT_MODEL_PROVIDER", "OPENCAT_API_PROVIDER"),
    "environment",
  ) ?? fileConfig.provider ?? inferProviderFromCredentials();
  const discoveryBaseUrl = envString(
    "OPENCAT_API_BASE_URL",
    "ARK_BASE_URL",
    "DEEPSEEK_BASE_URL",
    "OPENAI_BASE_URL",
  ) ?? fileConfig.baseUrl;
  const provider = resolveModelProvider({
    provider: configuredProvider,
    baseUrl: discoveryBaseUrl,
  });
  const providerBaseUrl = getProviderEnvironmentBaseUrl(provider);
  const baseUrl = envString("OPENCAT_API_BASE_URL") ??
    providerBaseUrl ??
    fileConfig.baseUrl ??
    (provider === "volcengine" ? DEFAULT_ARK_BASE_URL : undefined);
  const apiKey = envString("OPENCAT_API_KEY") ??
    providerApiKey(provider) ??
    fileConfig.apiKey ??
    resolveConfiguredApiKey(fileConfig.apiKeyEnv) ??
    envString("OPENAI_API_KEY") ??
    "";
  const model = envString("OPENCAT_MODEL") ??
    providerModel(provider) ??
    fileConfig.model ??
    (provider === "deepseek" ? DEFAULT_DEEPSEEK_MODEL : "");
  const maxTokens = readPositiveInteger(
    process.env.OPENCAT_MAX_TOKENS,
    "OPENCAT_MAX_TOKENS",
  ) ?? fileConfig.maxTokens ?? DEFAULT_MAX_TOKENS;
  const reasoningEffort = parseReasoningEffort(
    envString("OPENCAT_REASONING_EFFORT"),
    "OPENCAT_REASONING_EFFORT",
  ) ?? fileConfig.reasoningEffort ??
    (provider === "deepseek" ? "max" : undefined);

  return normalizeModelRuntimeSettings({
    profileName: fileConfig.profileName,
    provider,
    apiKey,
    baseUrl,
    headers: fileConfig.headers,
    userId: provider === "deepseek"
      ? envString("DEEPSEEK_USER_ID") ?? fileConfig.userId
      : undefined,
    model,
    maxTokens,
    reasoningEffort,
  });
}

export function getUserConfigPath(): string {
  const configuredPath = envString("OPENCAT_CONFIG_PATH");
  return configuredPath ? path.resolve(configuredPath) : DEFAULT_CONFIG_PATH;
}

function loadUserModelConfig(): UserModelConfig {
  const configPath = getUserConfigPath();
  let source: string;
  try {
    source = readFileSync(configPath, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return {};
    }
    throw new Error(`Unable to read model config: ${configPath}`, { cause: error });
  }

  let document: unknown;
  try {
    document = parseYaml(source);
  } catch (error) {
    throw new Error(`Invalid YAML model config: ${configPath}`, { cause: error });
  }

  if (document == null) {
    return {};
  }
  if (!isRecord(document)) {
    throw new Error(`Model config must be a YAML mapping: ${configPath}`);
  }

  if (isRecord(document.profiles)) {
    const profileNames = Object.keys(document.profiles);
    const profileName = envString("OPENCAT_MODEL_PROFILE") ??
      readString(document.activeProfile, "activeProfile") ??
      (profileNames.length === 1 ? profileNames[0] : undefined);
    if (!profileName) {
      throw new Error(
        `Model config must select an 'activeProfile' when multiple profiles exist: ${configPath}`,
      );
    }
    const profile = document.profiles[profileName];
    if (!isRecord(profile)) {
      throw new Error(
        `Unknown model profile '${profileName}' in ${configPath}`,
      );
    }
    return {
      profileName,
      ...parseUserModelMapping(profile, `profiles.${profileName}`),
    };
  }

  if (envString("OPENCAT_MODEL_PROFILE")) {
    throw new Error(
      `OPENCAT_MODEL_PROFILE requires a 'profiles' mapping: ${configPath}`,
    );
  }
  if (!isRecord(document.model)) {
    throw new Error(
      `Model config must contain either a 'model' or 'profiles' mapping: ${configPath}`,
    );
  }
  return parseUserModelMapping(document.model, "model");
}

function parseUserModelMapping(
  model: Record<string, unknown>,
  field: string,
): UserModelConfig {
  return {
    provider: parseProvider(
      readString(model.provider, `${field}.provider`),
      "YAML",
    ),
    apiKey: readString(model.apiKey, `${field}.apiKey`),
    apiKeyEnv: readEnvironmentVariableName(
      model.apiKeyEnv,
      `${field}.apiKeyEnv`,
    ),
    baseUrl: readString(model.baseUrl, `${field}.baseUrl`),
    model: readString(model.model, `${field}.model`),
    maxTokens: readPositiveInteger(model.maxTokens, `${field}.maxTokens`),
    reasoningEffort: parseReasoningEffort(
      readString(model.reasoningEffort, `${field}.reasoningEffort`),
      `${field}.reasoningEffort`,
    ),
    userId: readString(model.userId, `${field}.userId`),
    headers: readStringRecord(model.headers, `${field}.headers`),
  };
}

function parseProvider(
  value: string | undefined,
  source: string,
): ModelProvider | undefined {
  switch (value?.trim().toLowerCase()) {
    case undefined:
      return undefined;
    case "deepseek":
      return "deepseek";
    case "volcengine":
    case "ark":
      return "volcengine";
    case "openai-compatible":
      return "openai-compatible";
    default:
      throw new Error(`Unsupported model provider '${value}' in ${source}`);
  }
}

function parseReasoningEffort(
  value: string | undefined,
  source: string,
): ModelRuntimeSettings["reasoningEffort"] {
  switch (value) {
    case undefined:
      return undefined;
    case "low":
    case "medium":
    case "high":
    case "xhigh":
    case "max":
      return value;
    default:
      throw new Error(`Unsupported reasoning effort '${value}' in ${source}`);
  }
}

function providerApiKey(provider: ModelProvider): string | undefined {
  switch (provider) {
    case "volcengine":
      return envString("ARK_API_KEY");
    case "deepseek":
      return envString("DEEPSEEK_API_KEY");
    case "openai-compatible":
      return envString("OPENAI_API_KEY");
  }
}

function getProviderEnvironmentBaseUrl(
  provider: ModelProvider,
): string | undefined {
  switch (provider) {
    case "volcengine":
      return envString("ARK_BASE_URL");
    case "deepseek":
      return envString("DEEPSEEK_BASE_URL");
    case "openai-compatible":
      return envString("OPENAI_BASE_URL");
  }
}

function providerModel(provider: ModelProvider): string | undefined {
  switch (provider) {
    case "volcengine":
      return envString("ARK_MODEL");
    case "deepseek":
      return envString("DEEPSEEK_MODEL");
    case "openai-compatible":
      return envString("OPENAI_MODEL");
  }
}

function resolveConfiguredApiKey(variableName: string | undefined): string | undefined {
  return variableName ? process.env[variableName]?.trim() || undefined : undefined;
}

function inferProviderFromCredentials(): ModelProvider | undefined {
  if (process.env.ARK_API_KEY && !process.env.DEEPSEEK_API_KEY) {
    return "volcengine";
  }
  if (
    process.env.OPENAI_API_KEY &&
    !process.env.ARK_API_KEY &&
    !process.env.DEEPSEEK_API_KEY
  ) {
    return "openai-compatible";
  }
  return undefined;
}

function envString(...names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) {
      return value;
    }
  }
  return undefined;
}

function readString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error(`${field} must be a string`);
  }
  return value.trim() || undefined;
}

function readEnvironmentVariableName(
  value: unknown,
  field: string,
): string | undefined {
  const name = readString(value, field);
  if (name !== undefined && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(
      `${field} must be an environment variable name such as ARK_API_KEY, not the API key value`,
    );
  }
  return name;
}

function readPositiveInteger(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw new Error(`${field} must be a positive integer`);
  }
  return number;
}

function readStringRecord(
  value: unknown,
  field: string,
): Record<string, string> | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!isRecord(value)) {
    throw new Error(`${field} must be a mapping of strings`);
  }
  const result: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== "string") {
      throw new Error(`${field}.${key} must be a string`);
    }
    result[key] = item;
  }
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error;
}
