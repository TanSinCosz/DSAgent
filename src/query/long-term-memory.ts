import type { DeepSeekMessage } from "../deepseek/types.js";
import { searchLongTermMemory } from "../Memory/runtime.js";
import type { Message } from "../types/messages.js";
import type { Runtime } from "../types/runtime.js";

const MEMORY_QUERY_RECENT_MESSAGES = 6;
const MEMORY_QUERY_MAX_CHARS = 4_000;

/**
 * Builds a transient model-visible memory block.
 *
 * This deliberately returns a projection message instead of mutating
 * State.Messages: long-term memory is external context, not part of the
 * authoritative conversation transcript.
 */
export async function createLongTermMemoryContextMessage(
  runtime: Runtime,
  projectedMessages: readonly Message[],
): Promise<DeepSeekMessage | null> {
  const config = runtime.longTermMemoryConfig;
  if (!config.enabled || !config.autoInject) {
    return null;
  }

  const query = buildLongTermMemoryQuery(projectedMessages);
  if (!query) {
    return null;
  }

  try {
    const result = await searchLongTermMemory(runtime, query, {
      topK: config.autoInjectTopK,
      threshold: config.searchThreshold,
      scope: "user",
    });

    if (result.results.length === 0) {
      return null;
    }

    return {
      role: "user",
      content: renderLongTermMemoryContext(
        result.results,
        config.maxInjectedChars,
      ),
    };
  } catch {
    // Memory search is helpful context, not a hard dependency for answering.
    // Tool calls can still explicitly surface memory errors when debugging.
    return null;
  }
}

function buildLongTermMemoryQuery(messages: readonly Message[]): string {
  const parts: string[] = [];

  for (const message of messages.slice(-MEMORY_QUERY_RECENT_MESSAGES)) {
    const text = getMessageText(message);
    if (text) {
      parts.push(`${message.role}: ${text}`);
    }
  }

  return truncate(parts.join("\n"), MEMORY_QUERY_MAX_CHARS).trim();
}

function getMessageText(message: Message): string {
  if (message.role === "user") {
    return message.content;
  }

  if (message.role === "assistant") {
    return typeof message.content === "string" ? message.content : "";
  }

  return "";
}

type RenderableMemory = {
  id: string;
  memory: string;
  score?: number;
};

function renderLongTermMemoryContext(
  memories: readonly RenderableMemory[],
  maxChars: number,
): string {
  const lines = [
    "<long_term_memory>",
    "Relevant long-term memories retrieved for this request. Use them as context, but prefer newer user messages if there is a conflict.",
  ];

  for (const memory of memories) {
    const score = typeof memory.score === "number"
      ? ` score=${memory.score.toFixed(3)}`
      : "";
    lines.push(`- id=${memory.id}${score}: ${memory.memory}`);
  }

  lines.push("</long_term_memory>");
  return truncate(lines.join("\n"), maxChars);
}

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxChars))}\n[Long-term memory truncated]`;
}
