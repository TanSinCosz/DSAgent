export const MEMORY_SEARCH_TOOL_NAME = "MemorySearch";

export const DESCRIPTION =
  "Search long-term memory for user preferences, durable facts, and prior project decisions.";

export function renderMemorySearchPrompt(): string {
  return [
    "Searches long-term memory for relevant durable information.",
    "",
    "Use this when older preferences, cross-session facts, or prior project decisions may matter.",
    "Do not use it for facts already visible in the current conversation.",
  ].join("\n");
}
