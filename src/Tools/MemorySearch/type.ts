import { z } from "zod";

export const inputSchema = () =>
  z.strictObject({
    query: z.string().min(1).describe("Natural-language memory search query."),
    topK: z
      .number()
      .int()
      .min(1)
      .max(20)
      .optional()
      .describe("Maximum number of memories to return. Defaults to 8."),
    scope: z
      .enum(["user", "agent", "run"])
      .optional()
      .describe("Memory namespace to search. Defaults to user."),
    threshold: z
      .number()
      .min(0)
      .max(1)
      .optional()
      .describe("Minimum relevance score. Defaults to runtime memory threshold."),
  });

export const outputSchema = () =>
  z.object({
    results: z.array(
      z.object({
        id: z.string(),
        memory: z.string(),
        score: z.number().optional(),
        metadata: z.record(z.string(), z.any()).optional(),
      }),
    ),
  });
