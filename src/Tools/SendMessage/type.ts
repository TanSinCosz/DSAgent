import { z } from "zod";

export const inputSchema = () =>
  z.strictObject({
    to: z
      .string()
      .min(1)
      .describe("Target running agent id, for example agent_abc123."),
    summary: z
      .string()
      .optional()
      .describe("Short optional preview for the message."),
    message: z
      .string()
      .min(1)
      .describe("Plain text message to enqueue for the target agent."),
  });

export const outputSchema = () =>
  z.strictObject({
    success: z.boolean(),
    queued: z.boolean(),
    agentId: z.string().optional(),
    pendingMessageCount: z.number().int().nonnegative().optional(),
    message: z.string(),
  });
