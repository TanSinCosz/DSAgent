export const MEMORY_SAVE_TOOL_NAME = "MemorySave";

export const DESCRIPTION =
  "Stage a durable cross-session memory save, correction, or forget signal.";

export function renderMemorySavePrompt(): string {
  return [
    "Appends a concise signal to today's file-based long-term-memory daily log.",
    "",
    "If the user explicitly asks you to remember or save something, use this tool immediately when the content is suitable for long-term memory.",
    "You may also save a clearly durable, non-obvious fact that will materially improve future conversations.",
    "Pass a self-contained memory signal. It is staged in an append-only daily log; manual AutoDream later consolidates it into topic files and MEMORY.md.",
    "Use memoryType when the category is clear: user, feedback, project, or reference.",
    "Use operation=correct when newer evidence changes an existing memory. State both the corrected fact and what it supersedes.",
    "Use operation=forget when the user asks to forget something or when a known memory is no longer valid. Describe the memory to remove precisely.",
    "For feedback and project memories, include the rule or fact followed by **Why:** and **How to apply:** when that context is available.",
    "",
    "Do not save code patterns, architecture, file paths, project structure, git history, debugging recipes, facts already documented in project instructions, transient task progress, plans, or todo items.",
    "Do not call this for ordinary conversation or memory lookup.",
    "Do not call save for a fact already present. Use correct or forget when current evidence conflicts with stored memory; current observed state and newer user instructions take precedence.",
    "Do not save secrets or sensitive information unless the user explicitly asks you to remember that exact information.",
  ].join("\n");
}
