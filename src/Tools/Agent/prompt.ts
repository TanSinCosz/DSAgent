export const AGENT_TOOL_NAME = 'Agent'
export const DESCRIPTION =
  "Launch a specialized subagent for complex, multi-step work.";

export function renderAgentPrompt(agentLines: readonly string[]): string {
  const availableAgents = agentLines.length
    ? agentLines.join("\n")
    : "- general-purpose: General-purpose agent for research and multi-step tasks.";

  return `Launch a new agent to handle complex, multi-step tasks autonomously.

Available agent types:
${availableAgents}

Usage notes:
- Use Agent when a task benefits from separate context, independent research, planning, or verification.
- Always include a short description summarizing what the agent will do.
- Use subagent_type to select a specialized agent. If omitted, general-purpose is used.
- execution_mode controls how the agent runs:
  - sync: run the agent now and wait for its result.
  - async: launch the agent in the background and return an output file path.
  - fork: inherit the parent conversation context and run the directive in that context.
- run_in_background is supported as an alias for execution_mode: async.
- Fork mode should be used when the child needs the parent's context but its detailed tool output should stay out of the parent conversation.
- Set isolation: "worktree" when an agent may edit files independently. This runs it in a temporary git worktree. If it makes changes, the worktree path is returned; if it makes no changes, the worktree is cleaned up.`;
}
