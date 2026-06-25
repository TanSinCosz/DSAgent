import type { AgentExecutionMode } from "./runner.js";

export type AgentTaskStatus =
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type AgentTask = {
  id: string;
  agentType: string;
  description: string;
  prompt: string;
  mode: AgentExecutionMode;
  status: AgentTaskStatus;
  createdAt: number;
  updatedAt: number;
  outputFile?: string;
  result?: string;
  error?: string;
};

export type AgentNotification = {
  id: string;
  agentTaskId: string;
  agentType: string;
  description: string;
  status: Exclude<AgentTaskStatus, "running">;
  createdAt: number;
  message: string;
  outputFile?: string;
};

export type AgentTasksState = Record<string, AgentTask>;

export function createAgentTasksState(): AgentTasksState {
  return {};
}

export function createAgentNotificationsState(): AgentNotification[] {
  return [];
}
