import { z } from "zod";

export const inputSchema = () =>
  z.strictObject({
    memory: z
      .string()
      .min(1)
      .describe("A self-contained durable memory for future conversations. Prefer one fact per call."),
    memoryType: z
      .enum(["user", "feedback", "project", "reference"])
      .optional()
      .describe("Optional memory category. Defaults to user."),
    operation: z
      .enum(["save", "correct", "forget"])
      .optional()
      .describe(
        "Append a durable save, correction, or forget signal. Defaults to save.",
      ),
    reason: z
      .string()
      .optional()
      .describe("Short reason this memory should be durable, when useful for auditing."),
  });

export const outputSchema = () =>
  z.object({
    results: z.array(
      z.object({
        id: z.string(),
        memory: z.string(),
        metadata: z.record(z.string(), z.any()).optional(),
      }),
    ),
  });
