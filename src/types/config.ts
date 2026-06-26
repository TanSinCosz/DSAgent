
export interface AgentConfig {
  model: string;
  apiBaseUrl: string;
  apiKeyEnvVar: string;
}

export interface DeepSeekRuntimeSettings {
  apiKey: string;
  baseUrl?: string;
  headers?: Record<string, string>;
  model: string;
  maxTokens: number;
  systemPrompt?: string;
  reasoningEffort?: "low" | "medium" | "high" | "xhigh" | "max";
}

export const FORCED_DEEPSEEK_MODEL = "deepseek-v4-pro";
export const FORCED_DEEPSEEK_REASONING_EFFORT = "max";

export function forceDeepSeekRuntimeSettings(
  settings: DeepSeekRuntimeSettings,
): DeepSeekRuntimeSettings {
  return {
    ...settings,
    model: FORCED_DEEPSEEK_MODEL,
    reasoningEffort: FORCED_DEEPSEEK_REASONING_EFFORT,
  };
}
