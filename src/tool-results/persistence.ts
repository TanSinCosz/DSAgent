import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, join, relative } from "node:path";

import type { Runtime } from "../types/runtime.js";
import type { ToolMessage } from "../types/messages.js";

const TOOL_RESULTS_DIR = ".opencat/tool-results";
const DEFAULT_MAX_RESULT_SIZE_CHARS = 50_000;
const TOOL_RESULT_PREVIEW_CHARS = 2_000;

export interface PersistToolResultOptions {
  runtime: Runtime;
  message: ToolMessage;
  toolName?: string;
  maxResultSizeChars?: number;
}

export async function persistLargeToolResultIfNeeded(
  options: PersistToolResultOptions,
): Promise<ToolMessage> {
  const threshold = getToolResultPersistThreshold(options.maxResultSizeChars);

  if (options.message.content.length <= threshold) {
    return {
      ...options.message,
      toolName: options.toolName ?? options.message.toolName,
    };
  }

  const content = options.message.content;
  const sha256 = createHash("sha256").update(content).digest("hex");
  const directory = join(
    options.runtime.cwd,
    TOOL_RESULTS_DIR,
    sanitizePathSegment(options.runtime.sessionId),
  );
  const fileName = [
    Date.now(),
    sanitizePathSegment(options.toolName ?? "tool"),
    sanitizePathSegment(options.message.tool_call_id),
    randomUUID(),
  ].join("-");
  const absolutePath = join(directory, `${fileName}.txt`);

  await mkdir(directory, { recursive: true });
  await writeFile(absolutePath, content, "utf8");

  const relativePath = normalizeRelativePath(
    relative(options.runtime.cwd, absolutePath),
  );

  return {
    ...options.message,
    toolName: options.toolName ?? options.message.toolName,
    content: buildPersistedToolResultPreview({
      toolName: options.toolName,
      originalContent: content,
      relativePath,
      size: Buffer.byteLength(content, "utf8"),
      sha256,
    }),
    persistedToolResult: {
      path: relativePath,
      absolutePath,
      size: Buffer.byteLength(content, "utf8"),
      sha256,
      previewChars: Math.min(content.length, TOOL_RESULT_PREVIEW_CHARS),
      originalContentType: "text",
    },
  };
}

function getToolResultPersistThreshold(
  toolMaxResultSizeChars: number | undefined,
): number {
  const configured = Number(process.env.OPENCAT_TOOL_RESULT_PERSIST_CHARS);
  const systemThreshold = Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_MAX_RESULT_SIZE_CHARS;

  if (
    Number.isFinite(toolMaxResultSizeChars) &&
    toolMaxResultSizeChars !== undefined &&
    toolMaxResultSizeChars > 0
  ) {
    return Math.min(systemThreshold, toolMaxResultSizeChars);
  }

  return systemThreshold;
}

function buildPersistedToolResultPreview(options: {
  toolName?: string;
  originalContent: string;
  relativePath: string;
  size: number;
  sha256: string;
}): string {
  const preview = options.originalContent.slice(0, TOOL_RESULT_PREVIEW_CHARS);
  const omittedChars = Math.max(
    0,
    options.originalContent.length - TOOL_RESULT_PREVIEW_CHARS,
  );
  const toolLabel = options.toolName ? ` from ${options.toolName}` : "";

  return [
    `Tool result${toolLabel} was ${options.size} bytes and was persisted to disk because it is too large to inline in the conversation transcript.`,
    `Full output path: ${options.relativePath}`,
    `SHA-256: ${options.sha256}`,
    "",
    "<tool_result_preview>",
    omittedChars > 0
      ? `${preview}\n[${omittedChars} additional characters omitted from this message. Read the persisted file if the full output is needed.]`
      : preview,
    "</tool_result_preview>",
  ].join("\n");
}

function sanitizePathSegment(value: string): string {
  const safe = value.replace(/[^a-zA-Z0-9_.-]/g, "_").slice(0, 96);
  return safe || "unknown";
}

function normalizeRelativePath(value: string): string {
  return value.split(/[\\/]+/).map((part) => basename(part)).join("/");
}
