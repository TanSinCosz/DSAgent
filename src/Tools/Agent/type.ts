import { z } from "zod";

export const inputSchema = () =>
  z.object({
    prompt: z.string().min(1).describe("Task prompt for the spawned agent."),
    description: z
      .string()
      .min(1)
      .describe("Short 3-5 word summary of what the agent will do."),
    subagent_type: z
      .string()
      .optional()
      .describe("Agent type to use. Defaults to general-purpose."),
    name: z
      .string()
      .optional()
      .describe("Optional stable name for this agent run."),
    run_in_background: z
      .boolean()
      .optional()
      .describe("Whether this agent should run in the background. Alias for execution_mode: async."),
    execution_mode: z
      .enum(["sync", "async", "fork"])
      .optional()
      .describe("How to run the agent. sync waits for completion, async writes output to a file, fork inherits the parent conversation context."),
    isolation: z
      .enum(["none", "worktree"])
      .optional()
      .describe("Run the agent in the current working tree or in an isolated temporary git worktree."),
  });

export const outputSchema = () =>
  z.union([
    z.object({
      status: z.literal("completed"),
      mode: z.enum(["sync", "fork"]),
      agentId: z.string(),
      agentType: z.string(),
      description: z.string(),
      result: z.string(),
      messageCount: z.number(),
      worktreePath: z.string().optional(),
      worktreeBranch: z.string().optional(),
      baseCommit: z.string().optional(),
      changedFiles: z.array(z.string()).optional(),
    }),
    z.object({
      status: z.literal("async_launched"),
      mode: z.literal("async"),
      agentId: z.string(),
      agentType: z.string(),
      description: z.string(),
      prompt: z.string(),
      outputFile: z.string(),
      worktreePath: z.string().optional(),
      worktreeBranch: z.string().optional(),
      baseCommit: z.string().optional(),
    }),
  ]);
