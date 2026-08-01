export type BackgroundTaskStatus =
  | "running"
  | "completed"
  | "failed"
  | "killed";

export type BackgroundTask = {
  id: string;
  type: "bash";
  sessionId: string;
  ownerAgentId: string;
  command: string;
  description: string;
  cwd: string;
  outputFile: string;
  status: BackgroundTaskStatus;
  createdAt: number;
  updatedAt: number;
  finishedAt?: number;
  pid?: number;
  exitCode?: number;
  signal?: string;
  outputBytes: number;
  timedOut?: boolean;
  error?: string;
  lastNotificationAt?: number;
};

export type BackgroundTaskNotification = {
  id: string;
  taskId: string;
  ownerAgentId: string;
  createdAt: number;
  message: string;
};

export type BackgroundTasksState = Record<string, BackgroundTask>;

export function createBackgroundTasksState(): BackgroundTasksState {
  return {};
}

export function createBackgroundTaskNotificationsState():
  BackgroundTaskNotification[] {
  return [];
}

export function markRestoredBackgroundTasksDetached(
  tasks: BackgroundTasksState,
): BackgroundTasksState {
  const now = Date.now();
  const restored: BackgroundTasksState = {};

  for (const [id, task] of Object.entries(tasks)) {
    restored[id] = task.status === "running"
      ? {
        ...task,
        status: "failed",
        updatedAt: now,
        finishedAt: now,
        error: "The host process ended before this task was restored.",
      }
      : task;
  }

  return restored;
}
