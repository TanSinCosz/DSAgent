import { randomUUID } from "node:crypto";
import {
  isSessionMemoryEmpty,
  truncateSessionMemoryForCompact,
} from "../session-memory/prompts.js";
import {
  loadPersistedSessionMemory,
  savePersistedSessionMemory,
} from "../session-memory/persistence.js";
import { updateSessionMemoryForAutoCompress } from "../session-memory/session-memory.js";
import type {
  AutoCompressState,
  AutoCompressSummary,
  AutoCompressSummaryId,
} from "../types/context.js";
import type { MessageId } from "../types/messages.js";
import type { Runtime } from "../types/runtime.js";
import type { State } from "../types/state.js";

export type AutoCompressResult =
  | { status: "compressed"; summary: AutoCompressSummary }
  | { status: "skipped"; reason: string };

/**
 * Runs the durable auto-compress step against State.
 *
 * The caller is responsible for deciding that the current projection is too
 * large. This function only prepares session memory and records an
 * AutoCompressSummary that a later projection pass can render into the request.
 */
export async function applyAutoCompression(
  runtime: Runtime,
  state: State,
): Promise<AutoCompressResult> {
  const autoCompress = ensureAutoCompressState(state);
  await loadPersistedSessionMemory(runtime, state);

  const existingSummary = createSessionMemoryAutoCompressSummary(state);
  if (existingSummary) {
    return activateAutoCompressSummary(autoCompress, existingSummary);
  }

  if (!autoCompress.sessionMemoryUpdated) {
    const updateResult = await updateSessionMemoryForAutoCompress(runtime, state);
    if (updateResult.status === "updated") {
      autoCompress.sessionMemoryUpdated = true;
      await savePersistedSessionMemory(runtime, state);
    } else {
      return updateResult;
    }
  }

  const summary = createSessionMemoryAutoCompressSummary(state);
  if (!summary) {
    return { status: "skipped", reason: "session_memory_not_usable" };
  }

  return activateAutoCompressSummary(autoCompress, summary);
}

export function ensureAutoCompressState(state: State): AutoCompressState {
  state.autoCompress ??= { summaries: [], sessionMemoryUpdated: false };
  state.autoCompress.sessionMemoryUpdated ??= false;
  state.autoCompress.summaries ??= [];
  return state.autoCompress;
}

function createSessionMemoryAutoCompressSummary(
  state: State,
): AutoCompressSummary | null {
  const sessionMemory = state.sessionMemory;
  const throughMessageId = sessionMemory.lastSummarizedMessageId;

  if (
    sessionMemory.status !== "ready" ||
    !throughMessageId ||
    isSessionMemoryEmpty(sessionMemory.content)
  ) {
    return null;
  }

  const throughIndex = state.Messages.findIndex(
    (message) => message.id === throughMessageId,
  );
  if (throughIndex === -1) {
    return null;
  }

  return {
    id: createAutoCompressSummaryId(),
    content: renderSessionMemorySummary(sessionMemory.content),
    fromMessageId: state.Messages[0]?.id,
    throughMessageId,
    messageCount: throughIndex + 1,
    createdAt: Date.now(),
  };
}

function renderSessionMemorySummary(sessionMemory: string): string {
  const { truncatedContent, wasTruncated } =
    truncateSessionMemoryForCompact(sessionMemory);
  const lines = [
    "This session is being continued from a previous conversation that ran out of context. The session memory below covers the earlier portion of the conversation.",
    "",
    "<session_memory>",
    truncatedContent.trim(),
    "</session_memory>",
    "",
    "Recent messages after this summary are preserved verbatim.",
  ];

  if (wasTruncated) {
    lines.push(
      "",
      "Some session memory sections were truncated for length. Use the full session memory source if exact older details are needed.",
    );
  }

  return lines.join("\n");
}

function findSummaryByThroughMessageId(
  autoCompress: AutoCompressState,
  throughMessageId: MessageId | undefined,
): AutoCompressSummary | undefined {
  if (!throughMessageId) {
    return undefined;
  }

  return autoCompress.summaries.find(
    (summary) => summary.throughMessageId === throughMessageId,
  );
}

function activateAutoCompressSummary(
  autoCompress: AutoCompressState,
  summary: AutoCompressSummary,
): AutoCompressResult {
  const existing = findSummaryByThroughMessageId(
    autoCompress,
    summary.throughMessageId,
  );
  if (existing) {
    autoCompress.activeSummaryId = existing.id;
    return { status: "compressed", summary: existing };
  }

  autoCompress.summaries.push(summary);
  autoCompress.activeSummaryId = summary.id;
  return { status: "compressed", summary };
}

function createAutoCompressSummaryId(): AutoCompressSummaryId {
  return `autocompress_${randomUUID()}`;
}
