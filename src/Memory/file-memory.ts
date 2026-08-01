import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import {
  appendFile,
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

import type { Runtime } from "../types/runtime.js";

export const FILE_MEMORY_BASE_DIR = ".opencat/memory";
export const FILE_MEMORY_ENTRYPOINT = "MEMORY.md";
export const FILE_MEMORY_LOGS_DIR = "logs";
export const MAX_FILE_MEMORY_ENTRYPOINT_LINES = 200;
export const MAX_FILE_MEMORY_ENTRYPOINT_CHARS = 25_000;
export const MAX_FILE_MEMORY_LINES = 200;
export const MAX_FILE_MEMORY_BYTES = 4_096;

export type FileMemoryType = "user" | "feedback" | "project" | "reference";

export type FileMemoryMetadata = {
  node_type: "memory";
  type: FileMemoryType;
  originSessionId?: string;
};

export type SaveFileMemoryInput = {
  memory: string;
  reason?: string;
  type?: FileMemoryType;
};

export type FileMemorySignalOperation = "save" | "correct" | "forget";

export type AppendFileMemorySignalInput = SaveFileMemoryInput & {
  operation?: FileMemorySignalOperation;
};

export type SaveFileMemoryResult = {
  id: string;
  memory: string;
  metadata: {
    event: "ADD" | "EXISTS";
    path: string;
    entrypointPath: string;
    type: FileMemoryType;
    hash: string;
    reason?: string;
    node_type: "memory";
    originSessionId?: string;
  };
};

export type LoadedFileMemoryEntrypoint = {
  path: string;
  content: string;
};

export type FileMemoryHeader = {
  filename: string;
  path: string;
  name?: string;
  description?: string;
  type?: FileMemoryType;
  metadata?: FileMemoryMetadata;
  modifiedAtMs: number;
};

export type LoadedFileMemory = FileMemoryHeader & {
  content: string;
  truncated: boolean;
};

const DEFAULT_MEMORY_TYPE: FileMemoryType = "user";
const MAX_SCANNED_MEMORY_FILES = 200;
const projectRootCache = new Map<string, string>();
const ENTRYPOINT_HEADER = [
  "# Long-term memory",
  "",
  "This file is an index. Keep each entry short and put memory details in topic files.",
  "",
].join("\n");

/**
 * Append an explicit main-agent memory decision to today's staging log.
 * Formal topic files remain owned by the manual AutoDream consolidation pass.
 */
export async function appendFileMemorySignal(
  runtime: Runtime,
  input: AppendFileMemorySignalInput,
): Promise<{ results: SaveFileMemoryResult[] }> {
  if (!runtime.longTermMemoryConfig.enabled) {
    return { results: [] };
  }

  const memory = input.memory.trim();
  if (!memory) {
    return { results: [] };
  }

  const type = input.type ?? DEFAULT_MEMORY_TYPE;
  const operation = input.operation ?? "save";
  const hash = hashMemory(`${operation}\0${type}\0${memory}`);
  const signalId = hash.slice(0, 16);
  const now = new Date();
  const path = getFileMemoryDailyLogPath(runtime, now);
  await mkdir(dirname(path), { recursive: true });

  let existing = "";
  try {
    existing = await readFile(path, "utf8");
  } catch {
    // The first signal of the day creates the append-only log.
  }

  const metadata = {
    event: existing.includes(`signalId: ${signalId}`)
      ? "EXISTS" as const
      : "ADD" as const,
    path,
    entrypointPath: getFileMemoryEntrypointPath(runtime),
    type,
    hash,
    ...(input.reason ? { reason: input.reason } : {}),
    node_type: "memory" as const,
    originSessionId: runtime.sessionId,
    operation,
  };
  if (metadata.event === "EXISTS") {
    return {
      results: [{
        id: signalId,
        memory,
        metadata,
      }],
    };
  }

  const heading = existing.trim()
    ? ""
    : `# ${formatLocalDate(now)}\n\n`;
  const block = [
    `- ${formatLocalTime(now)} | type: ${type} | operation: ${operation} | originSessionId: ${runtime.sessionId} | signalId: ${signalId}`,
    `  ${indentDailyLogText(memory)}`,
    ...(input.reason
      ? [`  **Reason:** ${indentDailyLogText(input.reason.trim())}`]
      : []),
    "",
  ].join("\n");
  await appendFile(path, `${heading}${block}`, "utf8");

  return {
    results: [{
      id: signalId,
      memory,
      metadata,
    }],
  };
}

export async function saveFileMemory(
  runtime: Runtime,
  input: SaveFileMemoryInput,
): Promise<{ results: SaveFileMemoryResult[] }> {
  if (!runtime.longTermMemoryConfig.enabled) {
    return { results: [] };
  }

  const memory = input.memory.trim();
  if (!memory) {
    return { results: [] };
  }

  const memoryDir = getFileMemoryDir(runtime);
  await mkdir(memoryDir, { recursive: true });

  const hash = hashMemory(memory);
  const existing = await findMemoryByHash(memoryDir, hash);
  const type = input.type ?? DEFAULT_MEMORY_TYPE;
  const entrypointPath = getFileMemoryEntrypointPath(runtime);

  if (existing) {
    const memoryMetadata = await readMemoryMetadata(existing, type);
    await ensureEntrypointHasLink(entrypointPath, existing, memory);
    return {
      results: [{
        id: basename(existing, ".md"),
        memory,
        metadata: {
          event: "EXISTS",
          path: existing,
          entrypointPath,
          hash,
          ...(input.reason ? { reason: input.reason } : {}),
          ...memoryMetadata,
        },
      }],
    };
  }

  const memoryMetadata: FileMemoryMetadata = {
    node_type: "memory",
    type,
    originSessionId: runtime.sessionId,
  };

  const filename = `${slugify(memory)}-${hash.slice(0, 8)}.md`;
  const path = join(memoryDir, filename);
  await writeFile(
    path,
    renderMemoryFile({
      name: titleFromMemory(memory),
      description: descriptionFromMemory(memory),
      type,
      originSessionId: runtime.sessionId,
      memory,
    }),
    "utf8",
  );
  await ensureEntrypointHasLink(entrypointPath, path, memory);

  return {
    results: [{
      id: basename(path, ".md"),
      memory,
      metadata: {
        event: "ADD",
        path,
        entrypointPath,
        hash,
        ...(input.reason ? { reason: input.reason } : {}),
        ...memoryMetadata,
      },
    }],
  };
}

export async function loadFileMemoryEntrypoint(
  runtime: Runtime,
): Promise<LoadedFileMemoryEntrypoint | null> {
  if (!runtime.longTermMemoryConfig.enabled) {
    return null;
  }

  const path = getFileMemoryEntrypointPath(runtime);
  try {
    const content = truncateFileMemoryEntrypoint(
      await readFile(path, "utf8"),
    );
    return content ? { path, content } : null;
  } catch {
    return null;
  }
}

export async function scanFileMemoryHeaders(
  runtime: Runtime,
): Promise<FileMemoryHeader[]> {
  if (!runtime.longTermMemoryConfig.enabled) {
    return [];
  }

  const memoryDir = getFileMemoryDir(runtime);
  const files = await listMarkdownMemoryFiles(memoryDir);
  const headers: FileMemoryHeader[] = [];

  for (const path of files) {
    try {
      const [content, info] = await Promise.all([
        readFile(path, "utf8"),
        stat(path),
      ]);
      const frontmatter = parseFrontmatter(content);
      const memoryMetadata = parseFileMemoryMetadata(frontmatter);
      headers.push({
        filename: relative(memoryDir, path).replace(/\\/g, "/"),
        path,
        name: frontmatter.name,
        description: frontmatter.description,
        type: parseFileMemoryType(frontmatter.type) ?? memoryMetadata?.type,
        ...(memoryMetadata ? { metadata: memoryMetadata } : {}),
        modifiedAtMs: info.mtimeMs,
      });
    } catch {
      // Ignore unreadable memory files. Memory recall should never block the
      // main request because one old note is malformed.
    }
  }

  return headers
    .sort((left, right) => right.modifiedAtMs - left.modifiedAtMs)
    .slice(0, MAX_SCANNED_MEMORY_FILES);
}

export async function loadFileMemories(
  runtime: Runtime,
  filenames: readonly string[],
): Promise<LoadedFileMemory[]> {
  const memoryDir = getFileMemoryDir(runtime);
  const allowed = new Map(
    (await scanFileMemoryHeaders(runtime)).map((header) => [
      header.filename,
      header,
    ]),
  );
  const loaded: LoadedFileMemory[] = [];

  for (const filename of filenames) {
    const header = allowed.get(filename);
    if (!header) {
      continue;
    }

    try {
      const body = truncateFileMemoryBody(
        stripFrontmatter(await readFile(header.path, "utf8")).trim(),
      );
      loaded.push({
        ...header,
        content: body.content,
        truncated: body.truncated,
      });
    } catch {
      // Stale index entries and concurrently edited files are harmless.
    }
  }

  void memoryDir;
  return loaded;
}

export function formatFileMemoryManifest(
  headers: readonly FileMemoryHeader[],
): string {
  return headers.map((header) => {
    const type = header.type ? `[${header.type}] ` : "";
    const description = header.description ?? "";
    return `- ${type}${header.filename} (${
      new Date(header.modifiedAtMs).toISOString()
    }): ${description}`.trimEnd();
  }).join("\n");
}

export function getFileMemoryDir(runtime: Runtime): string {
  const configured = runtime.longTermMemoryConfig.fileMemoryDirectory;
  if (configured) {
    return resolveMemoryDirectory(configured, runtime.cwd);
  }

  return join(
    homedir(),
    FILE_MEMORY_BASE_DIR,
    "projects",
    createProjectMemoryKey(getFileMemoryProjectRoot(runtime.cwd)),
  );
}

/**
 * Resolve all worktrees of the same repository to one memory scope.
 * Non-git directories keep using their absolute working directory.
 */
export function getFileMemoryProjectRoot(cwd: string): string {
  const absolute = resolve(cwd);
  const cached = projectRootCache.get(absolute);
  if (cached) {
    return cached;
  }

  let projectRoot = absolute;
  try {
    const gitRoot = execFileSync(
      "git",
      ["rev-parse", "--show-toplevel"],
      {
        cwd: absolute,
        encoding: "utf8",
        windowsHide: true,
        timeout: 5_000,
        maxBuffer: 64 * 1024,
        stdio: ["ignore", "pipe", "ignore"],
      },
    ).trim();
    if (gitRoot) {
      projectRoot = resolveCanonicalGitProjectRoot(resolve(gitRoot));
    }
  } catch {
    // A non-git working directory is itself the project memory scope.
  }

  projectRootCache.set(absolute, projectRoot);
  return projectRoot;
}

function resolveCanonicalGitProjectRoot(gitRoot: string): string {
  try {
    const dotGitContent = readFileSync(join(gitRoot, ".git"), "utf8").trim();
    if (!dotGitContent.startsWith("gitdir:")) {
      return gitRoot;
    }

    const worktreeGitDir = resolve(
      gitRoot,
      dotGitContent.slice("gitdir:".length).trim(),
    );
    const commonDir = resolve(
      worktreeGitDir,
      readFileSync(join(worktreeGitDir, "commondir"), "utf8").trim(),
    );

    // Only trust the shape produced by `git worktree add`. A submodule has a
    // .git file but no commondir and therefore remains its own project.
    if (resolve(dirname(worktreeGitDir)) !== join(commonDir, "worktrees")) {
      return gitRoot;
    }
    const backlink = realpathSync(
      readFileSync(join(worktreeGitDir, "gitdir"), "utf8").trim(),
    );
    if (backlink !== join(realpathSync(gitRoot), ".git")) {
      return gitRoot;
    }

    return basename(commonDir) === ".git" ? dirname(commonDir) : commonDir;
  } catch {
    return gitRoot;
  }
}

export function getFileMemoryEntrypointPath(runtime: Runtime): string {
  return join(getFileMemoryDir(runtime), FILE_MEMORY_ENTRYPOINT);
}

export function getFileMemoryLogsDir(runtime: Runtime): string {
  return join(getFileMemoryDir(runtime), FILE_MEMORY_LOGS_DIR);
}

/**
 * Return the append-only daily log used as the staging layer for automatic
 * memory extraction. AutoDream later consolidates these logs into topic files
 * and MEMORY.md.
 */
export function getFileMemoryDailyLogPath(
  runtime: Runtime,
  date: Date = new Date(),
): string {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return join(
    getFileMemoryLogsDir(runtime),
    year,
    month,
    `${year}-${month}-${day}.md`,
  );
}

export function truncateFileMemoryEntrypoint(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    return "";
  }

  const lines = trimmed.split(/\r?\n/);
  const wasLineTruncated = lines.length > MAX_FILE_MEMORY_ENTRYPOINT_LINES;
  const wasCharTruncated = trimmed.length > MAX_FILE_MEMORY_ENTRYPOINT_CHARS;
  if (!wasLineTruncated && !wasCharTruncated) {
    return trimmed;
  }

  let content = wasLineTruncated
    ? lines.slice(0, MAX_FILE_MEMORY_ENTRYPOINT_LINES).join("\n")
    : trimmed;
  if (content.length > MAX_FILE_MEMORY_ENTRYPOINT_CHARS) {
    const cutAt = content.lastIndexOf(
      "\n",
      MAX_FILE_MEMORY_ENTRYPOINT_CHARS,
    );
    content = content.slice(
      0,
      cutAt > 0 ? cutAt : MAX_FILE_MEMORY_ENTRYPOINT_CHARS,
    );
  }

  return [
    content,
    "",
    `> WARNING: ${FILE_MEMORY_ENTRYPOINT} was truncated. Keep each index entry to one line under about 150 characters and move details into topic files.`,
  ].join("\n");
}

async function ensureEntrypointHasLink(
  entrypointPath: string,
  memoryPath: string,
  memory: string,
): Promise<void> {
  const entrypointDir = dirname(entrypointPath);
  await mkdir(entrypointDir, { recursive: true });

  let content = "";
  try {
    content = await readFile(entrypointPath, "utf8");
  } catch {
    content = ENTRYPOINT_HEADER;
  }

  if (!content.trim()) {
    content = ENTRYPOINT_HEADER;
  }

  const link = relative(entrypointDir, memoryPath).replace(/\\/g, "/");
  if (content.includes(`](${link})`)) {
    return;
  }

  const line = `- [${truncateOneLine(memory, 40)}](${link}) - ${
    truncateOneLine(memory, 35)
  }`;
  const next = `${content.trimEnd()}\n${line}\n`;
  await writeFile(entrypointPath, next, "utf8");
}

async function findMemoryByHash(
  memoryDir: string,
  hash: string,
): Promise<string | null> {
  for (const path of await listMarkdownMemoryFiles(memoryDir)) {
    try {
      const content = await readFile(path, "utf8");
      if (hashMemory(stripFrontmatter(content).trim()) === hash) {
        return path;
      }
    } catch {
      // Ignore unreadable memory files; the next save will still succeed.
    }
  }

  return null;
}

async function listMarkdownMemoryFiles(memoryDir: string): Promise<string[]> {
  const result: string[] = [];

  async function visit(dir: string): Promise<void> {
    let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === FILE_MEMORY_LOGS_DIR) {
          continue;
        }
        await visit(path);
      } else if (entry.isFile() && entry.name.endsWith(".md") && entry.name !== FILE_MEMORY_ENTRYPOINT) {
        result.push(path);
      }
    }
  }

  await visit(memoryDir);
  return result.sort();
}

type ParsedFileMemoryFrontmatter = Record<string, string> & {
  metadata?: Record<string, string>;
};

function parseFrontmatter(content: string): ParsedFileMemoryFrontmatter {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
  if (!match) {
    return {};
  }

  const result: ParsedFileMemoryFrontmatter = {};
  let nestedSection: string | undefined;
  for (const line of match[1].split(/\r?\n/)) {
    if (/^\s+/.test(line)) {
      if (nestedSection !== "metadata") {
        continue;
      }

      const nestedSeparator = line.indexOf(":");
      if (nestedSeparator <= 0) {
        continue;
      }

      const key = line.slice(0, nestedSeparator).trim();
      const rawValue = line.slice(nestedSeparator + 1).trim();
      result.metadata ??= {};
      result.metadata[key] = parseYamlScalar(rawValue);
      continue;
    }

    const separator = line.indexOf(":");
    if (separator <= 0) {
      continue;
    }

    const key = line.slice(0, separator).trim();
    const rawValue = line.slice(separator + 1).trim();
    if (key === "metadata" && rawValue === "") {
      result.metadata = {};
      nestedSection = "metadata";
      continue;
    }

    nestedSection = undefined;
    result[key] = parseYamlScalar(rawValue);
  }

  return result;
}

function parseFileMemoryMetadata(
  frontmatter: ParsedFileMemoryFrontmatter,
  fallbackType?: FileMemoryType,
): FileMemoryMetadata | undefined {
  const metadata = frontmatter.metadata;
  const type = parseFileMemoryType(metadata?.type) ??
    parseFileMemoryType(frontmatter.type) ??
    fallbackType;
  if (metadata?.node_type !== "memory" || !type) {
    return undefined;
  }

  return {
    node_type: "memory",
    type,
    ...(metadata.originSessionId
      ? { originSessionId: metadata.originSessionId }
      : {}),
  };
}

async function readMemoryMetadata(
  path: string,
  fallbackType: FileMemoryType,
): Promise<FileMemoryMetadata> {
  try {
    const metadata = parseFileMemoryMetadata(
      parseFrontmatter(await readFile(path, "utf8")),
      fallbackType,
    );
    return metadata ?? { node_type: "memory", type: fallbackType };
  } catch {
    return { node_type: "memory", type: fallbackType };
  }
}

function stripFrontmatter(content: string): string {
  return content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
}

function parseYamlScalar(value: string): string {
  if (
    (value.startsWith("\"") && value.endsWith("\"")) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    try {
      return JSON.parse(value);
    } catch {
      return value.slice(1, -1);
    }
  }

  return value;
}

function parseFileMemoryType(value: string | undefined): FileMemoryType | undefined {
  return value === "user" ||
      value === "feedback" ||
      value === "project" ||
      value === "reference"
    ? value
    : undefined;
}

function renderMemoryFile(input: {
  name: string;
  description: string;
  type: FileMemoryType;
  originSessionId: string;
  memory: string;
}): string {
  return [
    "---",
    `name: ${yamlScalar(input.name)}`,
    `description: ${yamlScalar(input.description)}`,
    `type: ${input.type}`,
    "metadata:",
    "  node_type: memory",
    `  type: ${input.type}`,
    `  originSessionId: ${yamlScalar(input.originSessionId)}`,
    "---",
    "",
    input.memory,
    "",
  ].filter((line): line is string => line !== undefined).join("\n");
}

function hashMemory(memory: string): string {
  return createHash("sha256").update(memory).digest("hex");
}

function resolveMemoryDirectory(path: string, cwd: string): string {
  const expanded = path === "~" || path.startsWith("~/") || path.startsWith("~\\")
    ? join(homedir(), path.slice(2))
    : path;
  return isAbsolute(expanded) ? expanded : resolve(cwd, expanded);
}

function createProjectMemoryKey(cwd: string): string {
  const absolute = resolve(cwd);
  const slug = absolute
    .replace(/^[A-Za-z]:/, (drive) => drive.slice(0, 1))
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "project";
  return `${slug}-${hashMemory(absolute).slice(0, 8)}`;
}

function slugify(value: string): string {
  const ascii = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return ascii || "memory";
}

function titleFromMemory(memory: string): string {
  return truncateOneLine(memory, 64);
}

function descriptionFromMemory(memory: string): string {
  return truncateOneLine(memory, 150);
}

function truncateOneLine(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 3))}...`;
}

function yamlScalar(value: string): string {
  return JSON.stringify(value.replace(/\r?\n/g, " "));
}

function truncateFileMemoryBody(
  value: string,
): { content: string; truncated: boolean } {
  const lines = value.split(/\r?\n/);
  const lineLimited = lines.slice(0, MAX_FILE_MEMORY_LINES).join("\n");
  const truncated = lines.length > MAX_FILE_MEMORY_LINES ||
    Buffer.byteLength(lineLimited, "utf8") > MAX_FILE_MEMORY_BYTES;
  if (!truncated) {
    return { content: lineLimited, truncated: false };
  }

  const suffix = "\n[Memory file truncated; read the source file for the rest.]";
  return {
    content: `${truncateUtf8(
      lineLimited,
      MAX_FILE_MEMORY_BYTES - Buffer.byteLength(suffix, "utf8"),
    )}${suffix}`,
    truncated: true,
  };
}

function truncateUtf8(value: string, maxBytes: number): string {
  let bytes = 0;
  let result = "";
  for (const character of value) {
    const characterBytes = Buffer.byteLength(character, "utf8");
    if (bytes + characterBytes > maxBytes) {
      break;
    }
    result += character;
    bytes += characterBytes;
  }
  return result;
}

function indentDailyLogText(value: string): string {
  return value.replace(/\r?\n/g, "\n  ");
}

function formatLocalDate(date: Date): string {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatLocalTime(date: Date): string {
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${hour}:${minute}`;
}
