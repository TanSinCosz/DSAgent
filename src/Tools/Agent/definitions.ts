import type { PermissionMode } from "../types.js";

export type AgentCategory =
  | "general"
  | "explore"
  | "plan"
  | "verify"
  | "worker";

export type AgentSource =
  | "built-in"
  | "userSettings"
  | "projectSettings"
  | "localSettings"
  | "policySettings"
  | "flagSettings"
  | "plugin";

export type AgentModel = "inherit" | "deepseek-v4-flash" | "deepseek-v4-pro" | string;

export type AgentDefinition = {
  agentType: string;
  category: AgentCategory;
  whenToUse: string;
  getSystemPrompt: () => string;

  source: AgentSource;
  tools?: string[];
  disallowedTools?: string[];
  model?: AgentModel;
  permissionMode?: PermissionMode;
  maxTurns?: number;
  background?: boolean;
  omitProjectMemory?: boolean;
  criticalSystemReminder?: string;
};

export type AgentDefinitionsResult = {
  activeAgents: AgentDefinition[];
  allAgents: AgentDefinition[];
};
