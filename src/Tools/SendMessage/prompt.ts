export const SEND_MESSAGE_TOOL_NAME = "SendMessage";

export const DESCRIPTION = "Send a queued message to a running subagent.";

export function renderSendMessagePrompt(): string {
  return [
    "Queues a message for a running background subagent.",
    "",
    "Use this when you need to give additional instructions or context to an agent that was launched earlier and returned an agentId.",
    "Plain assistant text is visible to the user, not to subagents; use this tool for subagent communication.",
    "The first version only supports direct agentId targets. Broadcast, teammate names, cross-session addresses, and resume are not supported yet.",
    "Messages are stored in the target agent's pendingMessages mailbox and will be consumed when the agent loop drains that mailbox.",
    "Do not use this for ordinary user-facing replies.",
  ].join("\n");
}
