import { z } from "zod";

export const inputSchema = () =>
  z.strictObject({
    memory: z
      .string()
      .min(1)
      .describe("The exact durable memory the user asked to add. Prefer one fact per call."),
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
