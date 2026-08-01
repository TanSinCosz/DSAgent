export const TASK_STOP_TOOL_NAME = "TaskStop";
export const DESCRIPTION = "Stop a running background task";

export function renderTaskStopPrompt(): string {
  return [
    "Stops a managed background task by task id.",
    "Use the task id returned by Bash when run_in_background is true.",
    "Stopping a task terminates its process tree. Existing output remains available at the task output file.",
  ].join("\n");
}

