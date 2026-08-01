import { z } from "zod";

export const inputSchema = () =>
  z.strictObject({
    task_id: z.string().min(1).describe("The background task id to stop."),
  });

export const outputSchema = () =>
  z.strictObject({
    stopped: z.boolean(),
    taskId: z.string(),
    status: z.enum(["running", "completed", "failed", "killed"]).optional(),
    command: z.string().optional(),
    outputFile: z.string().optional(),
    message: z.string(),
  });

