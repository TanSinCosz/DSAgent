import {
  mkdir,
  open,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { join, normalize, relative, resolve } from "node:path";

import type { AgentDefinition } from "../Tools/Agent/definitions.js";
import { runAgentTask } from "../Tools/Agent/runner.js";
import type { CanUseToolFn } from "../Tools/types.js";
import type { Runtime } from "../types/runtime.js";
import type { State } from "../types/state.js";
import {
  FILE_MEMORY_ENTRYPOINT,
  formatFileMemoryManifest,
  getFileMemoryDir,
  getFileMemoryLogsDir,
  MAX_FILE_MEMORY_ENTRYPOINT_CHARS,
  MAX_FILE_MEMORY_ENTRYPOINT_LINES,
  scanFileMemoryHeaders,
} from "./file-memory.js";

const MEMORY_DREAM_MAX_TURNS = 8;
const MEMORY_DREAM_LOCK_FILE = ".dream.lock";
const MEMORY_DREAM_STATE_FILE = ".dream-state.json";
const MEMORY_DREAM_RECENT_SESSION_LIMIT = 8;
const MEMORY_DREAM_TRANSCRIPT_DIR = ".opencat/transcripts";
const MEMORY_DREAM_LOCK_STALE_MS = 60 * 60 * 1_000;

export type MemoryDreamOptions = {
  recentSessionLimit?: number;
};

export type MemoryDreamTranscript = {
  filename: string;
  path: string;
  modifiedAt: string;
  sizeBytes: number;
};

type MemoryDreamState = {
  lastCompletedAt: number;
};

export type MemoryDreamResult =
  | {
    status: "completed";
    result: string;
    agentId: string;
    messageCount: number;
  }
  | { status: "skipped"; reason: "disabled" | "locked" }
  | { status: "failed"; reason: string };

/**
 * Manually consolidates file-based long-term memory.
 *
 * This is still a manual auto-dream surface: no cron and no background
 * scheduling. It runs a forked memory-maintenance agent over the memory
 * directory, daily logs, topic files, MEMORY.md, and a small index of recent
 * session transcripts. The agent may inspect transcripts with narrow searches,
 * but writes are only allowed inside the memory directory.
 */
export async function runMemoryDream(
  runtime: Runtime,
  state: State,
  options: MemoryDreamOptions = {},
): Promise<MemoryDreamResult> {
  if (!runtime.longTermMemoryConfig.enabled) {
    return { status: "skipped", reason: "disabled" };
  }

  const memoryDir = getFileMemoryDir(runtime);
  const lock = await acquireMemoryDreamLock(memoryDir);
  if (!lock.acquired) {
    return { status: "skipped", reason: "locked" };
  }

  try {
    const headers = await scanFileMemoryHeaders(runtime);
    const dreamState = await loadMemoryDreamState(memoryDir);
    const recentTranscripts = await listRecentMemoryDreamTranscripts(
      runtime,
      options.recentSessionLimit,
      dreamState.lastCompletedAt,
    );
    const output = await runAgentTask({
      parentRuntime: runtime,
      parentState: state,
      agentDefinition: createMemoryDreamAgentDefinition(),
      prompt: buildMemoryDreamPrompt({
        memoryDir,
        logsDir: getFileMemoryLogsDir(runtime),
        transcriptDir: getMemoryDreamTranscriptDir(runtime),
        recentTranscripts,
        existingMemories: formatFileMemoryManifest(headers),
        fallbackOriginSessionId: runtime.sessionId,
        lastCompletedAt: dreamState.lastCompletedAt,
      }),
      description: "Consolidate long-term memory",
      mode: "fork",
      isolation: "none",
      maxTurns: MEMORY_DREAM_MAX_TURNS,
      recordTaskLifecycle: false,
      agentRole: "session",
      canUseTool: createMemoryDreamCanUseTool(
        memoryDir,
        getFileMemoryLogsDir(runtime),
      ),
    });

    if (output.status !== "completed") {
      return {
        status: "failed",
        reason: `Unexpected memory dream output status: ${output.status}`,
      };
    }

    await saveMemoryDreamState(memoryDir, {
      lastCompletedAt: Date.now(),
    });
    return {
      status: "completed",
      result: output.result,
      agentId: output.agentId,
      messageCount: output.messageCount,
    };
  } catch (error) {
    return {
      status: "failed",
      reason: error instanceof Error ? error.message : String(error),
    };
  } finally {
    await lock.release();
  }
}

export async function listRecentMemoryDreamTranscripts(
  runtime: Runtime,
  limit = MEMORY_DREAM_RECENT_SESSION_LIMIT,
  modifiedAfterMs = 0,
): Promise<MemoryDreamTranscript[]> {
  const transcriptDir = getMemoryDreamTranscriptDir(runtime);
  let entries;
  try {
    entries = await readdir(transcriptDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const transcripts: Array<MemoryDreamTranscript & { modifiedAtMs: number }> = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".jsonl")) {
      continue;
    }

    const path = join(transcriptDir, entry.name);
    try {
      const info = await stat(path);
      if (info.mtimeMs <= modifiedAfterMs) {
        continue;
      }
      transcripts.push({
        filename: entry.name,
        path,
        modifiedAt: new Date(info.mtimeMs).toISOString(),
        modifiedAtMs: info.mtimeMs,
        sizeBytes: info.size,
      });
    } catch {
      // Ignore files that disappear while the dream is starting.
    }
  }

  return transcripts
    .sort((a, b) => b.modifiedAtMs - a.modifiedAtMs)
    .slice(0, Math.max(0, limit))
    .map(({ modifiedAtMs: _modifiedAtMs, ...transcript }) => transcript);
}

function createMemoryDreamAgentDefinition(): AgentDefinition {
  return {
    agentType: "memory_dream",
    category: "worker",
    source: "built-in",
    whenToUse: "Internal agent used to consolidate file-based long-term memory.",
    tools: ["Read", "Grep", "Glob", "Edit", "Write"],
    disallowedTools: [
      "Agent",
      "Bash",
      "MemorySave",
      "SendMessage",
      "Plan",
      "TodoWrite",
      "WebSearch",
      "WebFetch",
      "ReadSkill",
    ],
    model: "inherit",
    permissionMode: "default",
    maxTurns: MEMORY_DREAM_MAX_TURNS,
    getSystemPrompt: () =>
      [
        "You are a forked memory dream agent.",
        "Your only job is to consolidate file-based long-term memory.",
        "Do not answer the user and do not modify project files.",
        "Write only inside the memory directory.",
      ].join("\n"),
  };
}

function buildMemoryDreamPrompt(input: {
  memoryDir: string;
  logsDir: string;
  transcriptDir: string;
  recentTranscripts: readonly MemoryDreamTranscript[];
  existingMemories: string;
  fallbackOriginSessionId: string;
  lastCompletedAt: number;
}): string {
  const manifest = input.existingMemories.trim() ||
    "(No topic memory files were found.)";
  const transcriptManifest = formatMemoryDreamTranscriptManifest(
    input.recentTranscripts,
    input.transcriptDir,
  );

  return [
    "# Dream: Memory Consolidation",
    "",
    "You are performing a manual dream: a reflective pass over OpenCat's file-based long-term memory.",
    "Synthesize recent signal into durable, well-organized topic memories so future sessions can orient quickly.",
    "",
    `Memory directory: \`${input.memoryDir}\``,
    `Daily logs directory: \`${input.logsDir}\``,
    `Session transcripts directory: \`${input.transcriptDir}\` (large JSONL files; search narrowly and do not read them whole)`,
    `Entrypoint index: ${FILE_MEMORY_ENTRYPOINT}`,
    `Current date: ${new Date().toISOString().slice(0, 10)}`,
    `Fallback origin session ID for memories without a transcript source: ${input.fallbackOriginSessionId}`,
    `Previous successful manual dream: ${
      input.lastCompletedAt > 0
        ? new Date(input.lastCompletedAt).toISOString()
        : "(none)"
    }`,
    "",
    "Use Read, Grep, and Glob to inspect memory files and recent signal. Use Edit/Write only inside the memory directory.",
    "Read an existing file before editing or overwriting it.",
    "",
    "## Existing memory manifest",
    manifest,
    "",
    "## Recent session transcripts",
    transcriptManifest,
    "",
    "## Phase 1 - Orient",
    `- Inspect the memory directory and read ${FILE_MEMORY_ENTRYPOINT} if it exists. If it is missing, continue without creating unrelated files.`,
    "- Skim existing topic files so you update them instead of creating near-duplicates.",
    "- If logs/ exists, review recent daily log entries. Logs are raw signal, not official memory.",
    "- Treat daily logs as immutable evidence. Never edit, rewrite, move, or delete them.",
    "",
    "## Phase 2 - Gather recent signal",
    "Look for information worth persisting. Use these sources in priority order:",
    "1. Daily logs under logs/YYYY/MM/YYYY-MM-DD.md when present; they are the append-only signal stream.",
    "2. Existing memories that drifted, contradict newer facts, or need cleanup.",
    "3. Narrow searches in the recent session transcripts listed above, only when logs and topic files do not provide enough context.",
    "- Look for user preferences, feedback, project context, and external references that will matter in future conversations.",
    "- Do not exhaustively read transcript JSONL files. Search with narrow terms and inspect only the matching region.",
    "- Do not preserve temporary task progress from transcripts unless it reveals a durable user preference or project rule.",
    "",
    "## Phase 3 - Consolidate",
    "- Write or update topic memory files at the top level of the memory directory.",
    "- Follow the same four memory types and save exclusions used by the long-term memory extraction flow.",
    "- Use this frontmatter format:",
    "```markdown",
    "---",
    "name: {{memory name}}",
    "description: {{one-line description used for future relevance selection}}",
    "type: {{user | feedback | project | reference}}",
    "metadata:",
    "  node_type: memory",
    "  type: {{same value as top-level type}}",
    "  originSessionId: {{source session ID, or the fallback origin session ID above}}",
    "---",
    "",
    "{{memory body}}",
    "```",
    "- Merge new signal into existing topic files rather than creating duplicates.",
    "- Each daily-log entry carries originSessionId. For a new memory, copy the originSessionId from the entry that supplied its primary fact. Preserve an existing memory's originSessionId when updating it; use the fallback only when neither the log nor a transcript identifies a source session.",
    "- Convert relative dates to absolute dates when possible.",
    "- If a memory is stale, wrong, or superseded, fix or remove it.",
    "- Keep feedback/project memories actionable; lead with the rule or fact, then include Why and How to apply when the source provides them.",
    "",
    "## What NOT to save",
    "- Code structure, file paths, architecture facts, or project conventions derivable from the repository.",
    "- Git history, recent changes, temporary task progress, current plans, or todo lists.",
    "- Debugging recipes that belong in code, tests, commits, or documentation.",
    "- Anything already documented in CLAUDE.md, OPENCAT.md, or other project instruction files.",
    "- Anything that is not surprising, durable, and useful across future sessions.",
    "",
    "## Phase 4 - Prune and index",
    `- Update ${FILE_MEMORY_ENTRYPOINT} so it stays under ${MAX_FILE_MEMORY_ENTRYPOINT_LINES} lines and about ${MAX_FILE_MEMORY_ENTRYPOINT_CHARS} characters.`,
    "- Each index entry should be one line: - [Title](file.md) - one-line hook.",
    "- Never put full memory bodies in the index.",
    "- Shorten verbose index entries and move details into topic files.",
    "- Remove pointers to stale, wrong, deleted, or superseded memories.",
    "- Add pointers to newly important memories and resolve contradictions at the source file.",
    "- Keep the index short and useful for future relevance selection.",
    "",
    "Return a brief summary of what you consolidated, updated, pruned, or why nothing changed.",
  ].join("\n");
}

function getMemoryDreamTranscriptDir(runtime: Runtime): string {
  return join(runtime.cwd, MEMORY_DREAM_TRANSCRIPT_DIR);
}

function formatMemoryDreamTranscriptManifest(
  transcripts: readonly MemoryDreamTranscript[],
  transcriptDir: string,
): string {
  if (transcripts.length === 0) {
    return "(No recent session transcript files were found.)";
  }

  return transcripts.map((transcript) => {
    const relativePath = relative(transcriptDir, transcript.path).replace(
      /\\/g,
      "/",
    );
    return `- ${relativePath} (${transcript.sizeBytes} bytes, modified ${
      transcript.modifiedAt
    })`;
  }).join("\n");
}

function createMemoryDreamCanUseTool(
  memoryDir: string,
  logsDir: string,
): CanUseToolFn {
  const root = normalize(resolve(memoryDir));
  const logsRoot = normalize(resolve(logsDir));
  const lockPath = normalize(resolve(memoryDir, MEMORY_DREAM_LOCK_FILE));
  const statePath = normalize(resolve(memoryDir, MEMORY_DREAM_STATE_FILE));

  return (tool, input) => {
    if (tool.name === "Read" || tool.name === "Grep" || tool.name === "Glob") {
      return { behavior: "allow" };
    }

    if (
      (tool.name === "Write" || tool.name === "Edit") &&
      typeof input === "object" &&
      input !== null &&
      "file_path" in input &&
      typeof input.file_path === "string" &&
      isPathInside(input.file_path, root) &&
      !isPathInside(input.file_path, logsRoot) &&
      normalize(resolve(input.file_path)) !== lockPath &&
      normalize(resolve(input.file_path)) !== statePath
    ) {
      return { behavior: "allow" };
    }

    return {
      behavior: "deny",
      message:
        `Memory dream may read files, may write formal memories inside ${memoryDir}, and must not modify append-only logs under ${logsDir}.`,
    };
  };
}

function isPathInside(filePath: string, root: string): boolean {
  const candidate = normalize(resolve(filePath)).toLowerCase();
  const normalizedRoot = root.toLowerCase();
  return candidate === normalizedRoot ||
    candidate.startsWith(`${normalizedRoot}\\`) ||
    candidate.startsWith(`${normalizedRoot}/`);
}

async function acquireMemoryDreamLock(
  memoryDir: string,
): Promise<
  | { acquired: true; release(): Promise<void> }
  | { acquired: false }
> {
  const lockPath = resolve(memoryDir, MEMORY_DREAM_LOCK_FILE);

  await mkdir(memoryDir, { recursive: true });
  if (await isMemoryDreamLockReclaimable(lockPath)) {
    await rm(lockPath, { force: true });
  }

  try {
    const handle = await open(lockPath, "wx");
    await handle.writeFile(JSON.stringify({
      pid: process.pid,
      startedAt: new Date().toISOString(),
    }, null, 2));
    await handle.close();
  } catch {
    return { acquired: false };
  }

  return {
    acquired: true,
    async release() {
      await rm(lockPath, { force: true });
    },
  };
}

async function isMemoryDreamLockReclaimable(lockPath: string): Promise<boolean> {
  try {
    const [raw, info] = await Promise.all([
      readFile(lockPath, "utf8"),
      stat(lockPath),
    ]);
    if (Date.now() - info.mtimeMs >= MEMORY_DREAM_LOCK_STALE_MS) {
      return true;
    }

    const parsed = JSON.parse(raw) as { pid?: unknown };
    return typeof parsed.pid === "number" && !isProcessRunning(parsed.pid);
  } catch {
    return false;
  }
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error instanceof Error &&
      "code" in error &&
      error.code === "EPERM";
  }
}

async function loadMemoryDreamState(memoryDir: string): Promise<MemoryDreamState> {
  try {
    const parsed = JSON.parse(
      await readFile(join(memoryDir, MEMORY_DREAM_STATE_FILE), "utf8"),
    ) as Partial<MemoryDreamState>;
    return {
      lastCompletedAt: typeof parsed.lastCompletedAt === "number" &&
          Number.isFinite(parsed.lastCompletedAt)
        ? parsed.lastCompletedAt
        : 0,
    };
  } catch {
    return { lastCompletedAt: 0 };
  }
}

async function saveMemoryDreamState(
  memoryDir: string,
  state: MemoryDreamState,
): Promise<void> {
  await writeFile(
    join(memoryDir, MEMORY_DREAM_STATE_FILE),
    `${JSON.stringify(state, null, 2)}\n`,
    "utf8",
  );
}
