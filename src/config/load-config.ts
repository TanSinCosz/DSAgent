import type { DeepSeekRuntimeSettings } from "../types/config.js";

export function loadConfig(): DeepSeekRuntimeSettings {
  return {
    apiKey: process.env.DEEPSEEK_API_KEY ?? process.env.OPENAI_API_KEY ?? "",
    baseUrl: process.env.DEEPSEEK_BASE_URL ?? process.env.OPENCAT_API_BASE_URL,
    model: process.env.OPENCAT_MODEL ?? "deepseek-v4-flash",
    maxTokens: Number(process.env.OPENCAT_MAX_TOKENS ?? 4096),
  };
}
