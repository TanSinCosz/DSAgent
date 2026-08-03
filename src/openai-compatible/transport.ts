import OpenAI, { type ClientOptions } from "openai";
import type {
  ChatCompletion,
  ChatCompletionChunk,
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionCreateParamsStreaming,
} from "openai/resources/chat/completions";

import type { ModelRuntimeSettings } from "../types/config.js";
import { normalizeOpenAICompatibleApiError } from "./errors.js";
import {
  getProviderBaseUrl,
  getProviderProfile,
} from "./provider.js";

export interface OpenAICompatibleTransportConfig {
  apiKey: string;
  baseUrl?: string;
  headers?: Record<string, string>;
  provider?: ModelRuntimeSettings["provider"];
  fetchImpl?: typeof fetch;
}

export function createOpenAICompatibleSdkClient(
  config: OpenAICompatibleTransportConfig,
): OpenAI {
  const profile = getProviderProfile(config);
  if (!config.apiKey.trim()) {
    throw new Error(
      `Missing ${profile.displayName} credentials. Set the ${profile.apiKeyEnvironmentVariable} environment variable or pass apiKey explicitly.`,
    );
  }

  const options: ClientOptions = {
    apiKey: config.apiKey,
    baseURL: getProviderBaseUrl(config),
    defaultHeaders: config.headers,
    fetch: config.fetchImpl,
  };

  return new OpenAI(options);
}

export async function sendOpenAICompatibleRequest(
  config: OpenAICompatibleTransportConfig,
  request: ChatCompletionCreateParamsNonStreaming,
  options: { signal?: AbortSignal } = {},
): Promise<ChatCompletion> {
  const client = createOpenAICompatibleSdkClient(config);
  const profile = getProviderProfile(config);
  try {
    return await client.chat.completions.create(request, {
      signal: options.signal,
    });
  } catch (error) {
    throw normalizeOpenAICompatibleApiError(error, {
      provider: profile.name,
      providerDisplayName: profile.displayName,
    });
  }
}

export async function* streamOpenAICompatibleRequest(
  config: OpenAICompatibleTransportConfig,
  request: ChatCompletionCreateParamsStreaming,
  options: { signal?: AbortSignal } = {},
): AsyncGenerator<ChatCompletionChunk, void, void> {
  const client = createOpenAICompatibleSdkClient(config);
  const profile = getProviderProfile(config);
  let stream: AsyncIterable<ChatCompletionChunk>;
  try {
    stream = await client.chat.completions.create(request, {
      signal: options.signal,
    });
  } catch (error) {
    throw normalizeOpenAICompatibleApiError(error, {
      provider: profile.name,
      providerDisplayName: profile.displayName,
    });
  }

  try {
    for await (const chunk of stream) {
      yield chunk;
    }
  } catch (error) {
    throw normalizeOpenAICompatibleApiError(error, {
      provider: profile.name,
      providerDisplayName: profile.displayName,
    });
  }
}

export function toOpenAICompatibleTransportConfig(
  config: ModelRuntimeSettings,
  fetchImpl?: typeof fetch,
): OpenAICompatibleTransportConfig {
  return {
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    headers: config.headers,
    provider: config.provider,
    fetchImpl,
  };
}
