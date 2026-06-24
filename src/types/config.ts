
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
