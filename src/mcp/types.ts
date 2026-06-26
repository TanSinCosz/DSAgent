import type { JSONSchemaObject } from "../Tools/types.js";

export type McpStdioServerConfig = {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
};

export type McpStreamableHttpAuth =
  | { type: "none" }
  | { type: "bearer"; token: string };

export type McpStreamableHttpServerConfig = {
  name: string;
  url: string;
  auth?: McpStreamableHttpAuth;
  headers?: Record<string, string>;
};

export type McpJsonRpcId = string | number;

export type McpJsonRpcRequest = {
  jsonrpc: "2.0";
  id: McpJsonRpcId;
  method: string;
  params?: unknown;
};

export type McpJsonRpcNotification = {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
};

export type McpJsonRpcResponse = {
  jsonrpc: "2.0";
  id: McpJsonRpcId;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
};

export type McpToolDefinition = {
  name: string;
  description?: string;
  inputSchema?: JSONSchemaObject;
};

export type McpToolsListResult = {
  tools: McpToolDefinition[];
};

export type McpToolCallResult = {
  content?: Array<
    | { type: "text"; text: string }
    | { type: string; [key: string]: unknown }
  >;
  isError?: boolean;
  [key: string]: unknown;
};

export type McpClient = {
  readonly serverName: string;
  listTools(): Promise<McpToolsListResult>;
  callTool(name: string, args: Record<string, unknown>): Promise<McpToolCallResult>;
  close(): void;
};
