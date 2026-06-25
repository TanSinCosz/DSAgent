import type { MemoryConfig } from "../Memory/type.js";
import { createAgentDefinitions } from "../Tools/Agent/index.js";
import { createDefaultTools } from "../Tools/index.js";
import { createDeepSeekClient, type DeepSeekClient } from "../deepseek/client.js";
import {
  createToolUseContext,
  type AgentDefinitionsResult,
  type AppState,
  type ThinkingConfig,
  type Tools,
  type ToolUseContext,
} from "../Tools/types.js";
import type { Tokenizer } from "../Tools/utils/Tokenizer.js";
import { createSessionId } from "../utils/session.js";
import type { DeepSeekRuntimeSettings } from "./config.js";
import type { ContextProjectionState, ToolResultBudgetState } from "./context.js";
import type { Message } from "./messages.js";

export interface Runtime {
  // Runtime identity.
  sessionId: string;
  agentId: "main" | "sub";

  // Runtime capabilities and configuration.
  cwd: string;
  deepSeekRuntimeConfig: DeepSeekRuntimeSettings;
  deepSeekClient: DeepSeekClient;
  systemPrompt?: string;
  contextProjectionState?: ContextProjectionState;
  toolResultBudgetState?: ToolResultBudgetState;
  MemoryConfig: MemoryConfig;

  tools: Tools;
  toolUseContext: ToolUseContext;
}

export interface CreateRuntimeOptions {
  // Runtime fields.
  sessionId?: string;
  agentId?: Runtime["agentId"];
  cwd?: string;
  deepSeekRuntimeConfig: DeepSeekRuntimeSettings;
  deepSeekClient?: DeepSeekClient;
  systemPrompt?: string;
  contextProjectionState?: ContextProjectionState;
  toolResultBudgetState?: ToolResultBudgetState;
  MemoryConfig: MemoryConfig;
  tools?: Tools;

  // ToolUseContext fields.
  messages?: Message[];
  abortController?: AbortController;
  tokenizer?: Tokenizer;
  isNonInteractiveSession?: boolean;
  mainLoopModel?: string;
  agentDefinitions?: AgentDefinitionsResult;
  thinkingConfig?: ThinkingConfig;
  appState?: AppState;
}

export function createRuntime(options: CreateRuntimeOptions): Runtime {
  const agentDefinitions = options.agentDefinitions ?? createAgentDefinitions();
  const tools = options.tools ?? createDefaultTools({ agentDefinitions });

  return {
    sessionId: options.sessionId ?? createSessionId(),
    agentId: options.agentId ?? "main",
    cwd: options.cwd ?? process.cwd(),
    deepSeekRuntimeConfig: options.deepSeekRuntimeConfig,
    deepSeekClient:
      options.deepSeekClient ??
      createDeepSeekClient({
        config: options.deepSeekRuntimeConfig,
    }),
    systemPrompt: options.systemPrompt,
    contextProjectionState: options.contextProjectionState,
    toolResultBudgetState: options.toolResultBudgetState,
    MemoryConfig: options.MemoryConfig,
    tools,
    toolUseContext: createToolUseContext({
      tools,
      messages: options.messages,
      appState: options.appState,
      abortController: options.abortController,
      tokenizer: options.tokenizer,
      isNonInteractiveSession: options.isNonInteractiveSession,
      mainLoopModel: options.mainLoopModel,
      agentDefinitions,
      thinkingConfig: options.thinkingConfig,
    }),
  };
}
