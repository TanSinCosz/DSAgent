import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface, type Interface } from "node:readline";

import type {
  McpJsonRpcId,
  McpJsonRpcNotification,
  McpJsonRpcRequest,
  McpJsonRpcResponse,
  McpStdioServerConfig,
  McpToolCallResult,
  McpToolsListResult,
} from "./types.js";

const MCP_PROTOCOL_VERSION = "2025-06-18";
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

type PendingRequest = {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout;
};

export class McpStdioClient {
  private process?: ChildProcessWithoutNullStreams;
  private stdoutLines?: Interface;
  private nextRequestId = 1;
  private readonly pending = new Map<McpJsonRpcId, PendingRequest>();

  constructor(private readonly config: McpStdioServerConfig) {}

  get serverName(): string {
    return this.config.name;
  }

  async connect(): Promise<void> {
    if (this.process) {
      return;
    }

    this.process = spawn(this.config.command, this.config.args ?? [], {
      cwd: this.config.cwd,
      env: {
        ...process.env,
        ...this.config.env,
      },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    this.process.once("exit", (code, signal) => {
      this.rejectAllPending(
        new Error(
          `MCP stdio server '${this.config.name}' exited (code=${code}, signal=${signal}).`,
        ),
      );
      this.process = undefined;
    });

    this.process.once("error", (error) => {
      this.rejectAllPending(error);
      this.process = undefined;
    });

    this.stdoutLines = createInterface({
      input: this.process.stdout,
      crlfDelay: Infinity,
    });
    this.stdoutLines.on("line", (line) => this.handleLine(line));

    await this.initialize();
  }

  async initialize(): Promise<void> {
    await this.request("initialize", {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: {
        name: "opencat-typescript",
        version: "0.1.0",
      },
    });
    this.notify("notifications/initialized");
  }

  async listTools(): Promise<McpToolsListResult> {
    return await this.request("tools/list") as McpToolsListResult;
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<McpToolCallResult> {
    return await this.request("tools/call", {
      name,
      arguments: args,
    }) as McpToolCallResult;
  }

  async request(
    method: string,
    params?: unknown,
    timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  ): Promise<unknown> {
    const child = this.process;
    if (!child) {
      throw new Error(`MCP stdio server '${this.config.name}' is not connected.`);
    }

    const id = this.nextRequestId++;
    const message: McpJsonRpcRequest = {
      jsonrpc: "2.0",
      id,
      method,
      ...(params === undefined ? {} : { params }),
    };

    const promise = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP request timed out: ${method}`));
      }, timeoutMs);

      this.pending.set(id, { resolve, reject, timer });
    });

    child.stdin.write(`${JSON.stringify(message)}\n`);
    return promise;
  }

  notify(method: string, params?: unknown): void {
    const child = this.process;
    if (!child) {
      throw new Error(`MCP stdio server '${this.config.name}' is not connected.`);
    }

    const message: McpJsonRpcNotification = {
      jsonrpc: "2.0",
      method,
      ...(params === undefined ? {} : { params }),
    };
    child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  close(): void {
    this.stdoutLines?.close();
    this.stdoutLines = undefined;

    if (this.process && !this.process.killed) {
      this.process.kill();
    }

    this.process = undefined;
    this.rejectAllPending(
      new Error(`MCP stdio server '${this.config.name}' was closed.`),
    );
  }

  private handleLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }

    let message: unknown;
    try {
      message = JSON.parse(trimmed);
    } catch {
      return;
    }

    if (!isJsonRpcResponse(message)) {
      return;
    }

    const pending = this.pending.get(message.id);
    if (!pending) {
      return;
    }

    clearTimeout(pending.timer);
    this.pending.delete(message.id);

    if (message.error) {
      pending.reject(
        new Error(
          `MCP request failed (${message.error.code}): ${message.error.message}`,
        ),
      );
      return;
    }

    pending.resolve(message.result);
  }

  private rejectAllPending(error: Error): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.pending.delete(id);
    }
  }
}

function isJsonRpcResponse(value: unknown): value is McpJsonRpcResponse {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Partial<McpJsonRpcResponse>;
  return candidate.jsonrpc === "2.0" && candidate.id !== undefined;
}
