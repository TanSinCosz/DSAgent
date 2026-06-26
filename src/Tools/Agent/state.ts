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
  pendingMessages: string[];
  outputFile?: string;
  worktreePath?: string;
  worktreeBranch?: string;
  baseCommit?: string;
  changedFiles?: string[];
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
  worktreePath?: string;
  worktreeBranch?: string;
  baseCommit?: string;
  changedFiles?: string[];
};

export type AgentTasksState = Record<string, AgentTask>;

export function createAgentTasksState(): AgentTasksState {
  return {};
}

export function createAgentNotificationsState(): AgentNotification[] {
  return [];
}

export function queueAgentMessage(
  tasks: AgentTasksState,
  agentId: string,
  message: string,
): boolean {
  const task = tasks[agentId];
  if (!task || task.status !== "running") {
    return false;
  }

  task.pendingMessages.push(message);
  task.updatedAt = Date.now();
  return true;
}

export function drainAgentMessages(
  tasks: AgentTasksState,
  agentId: string,
): string[] {
  const task = tasks[agentId];
  if (!task || task.pendingMessages.length === 0) {
    return [];
  }

  const drained = task.pendingMessages.splice(0);
  task.updatedAt = Date.now();
  return drained;
}
