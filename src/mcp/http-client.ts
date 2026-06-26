import type {
  McpJsonRpcId,
  McpJsonRpcNotification,
  McpJsonRpcRequest,
  McpJsonRpcResponse,
  McpStreamableHttpServerConfig,
  McpToolCallResult,
  McpToolsListResult,
} from "./types.js";

const MCP_PROTOCOL_VERSION = "2025-06-18";

export class McpStreamableHttpClient {
  private nextRequestId = 1;
  private sessionId?: string;

  constructor(private readonly config: McpStreamableHttpServerConfig) {}

  get serverName(): string {
    return this.config.name;
  }

  async connect(): Promise<void> {
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
    await this.notify("notifications/initialized");
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

  async request(method: string, params?: unknown): Promise<unknown> {
    const id = this.nextRequestId++;
    const message: McpJsonRpcRequest = {
      jsonrpc: "2.0",
      id,
      method,
      ...(params === undefined ? {} : { params }),
    };
    const response = await this.postJsonRpc(message);
    const rpcResponse = await parseJsonRpcResponse(response, id);

    if (rpcResponse.error) {
      throw new Error(
        `MCP request failed (${rpcResponse.error.code}): ${rpcResponse.error.message}`,
      );
    }

    return rpcResponse.result;
  }

  async notify(method: string, params?: unknown): Promise<void> {
    const message: McpJsonRpcNotification = {
      jsonrpc: "2.0",
      method,
      ...(params === undefined ? {} : { params }),
    };
    const response = await this.postJsonRpc(message);

    if (!response.ok) {
      throw new Error(
        `MCP notification failed (${response.status}): ${await response.text()}`,
      );
    }
  }

  close(): void {
    this.sessionId = undefined;
  }

  private async postJsonRpc(
    message: McpJsonRpcRequest | McpJsonRpcNotification,
  ): Promise<Response> {
    const response = await fetch(this.config.url, {
      method: "POST",
      headers: this.buildHeaders(),
      body: JSON.stringify(message),
    });

    const sessionId = response.headers.get("mcp-session-id");
    if (sessionId) {
      this.sessionId = sessionId;
    }

    return response;
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
      "MCP-Protocol-Version": MCP_PROTOCOL_VERSION,
      ...this.config.headers,
    };

    if (this.sessionId) {
      headers["Mcp-Session-Id"] = this.sessionId;
    }

    if (this.config.auth?.type === "bearer") {
      headers.Authorization = `Bearer ${this.config.auth.token}`;
    }

    return headers;
  }
}

async function parseJsonRpcResponse(
  response: Response,
  expectedId: McpJsonRpcId,
): Promise<McpJsonRpcResponse> {
  if (!response.ok) {
    throw new Error(`MCP HTTP request failed (${response.status}): ${await response.text()}`);
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("text/event-stream")) {
    return parseSseJsonRpcResponse(await response.text(), expectedId);
  }

  const value = await response.json() as unknown;
  if (!isJsonRpcResponse(value) || value.id !== expectedId) {
    throw new Error("MCP HTTP response was not a matching JSON-RPC response.");
  }

  return value;
}

function parseSseJsonRpcResponse(
  body: string,
  expectedId: McpJsonRpcId,
): McpJsonRpcResponse {
  for (const line of body.split(/\r?\n/)) {
    if (!line.startsWith("data:")) {
      continue;
    }

    const value = JSON.parse(line.slice("data:".length).trim()) as unknown;
    if (isJsonRpcResponse(value) && value.id === expectedId) {
      return value;
    }
  }

  throw new Error("MCP SSE response did not contain a matching JSON-RPC response.");
}

function isJsonRpcResponse(value: unknown): value is McpJsonRpcResponse {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Partial<McpJsonRpcResponse>;
  return candidate.jsonrpc === "2.0" && candidate.id !== undefined;
}
