import type { MemoryConfig } from "../Memory/type.js";
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
import { createState, type State } from "./state.js";

export interface Runtime {
  sessionId: string;
  agentId: "main" | "sub";

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
  state?: State;
  abortController?: AbortController;
  tokenizer?: Tokenizer;
  isNonInteractiveSession?: boolean;
  mainLoopModel?: string;
  agentDefinitions?: AgentDefinitionsResult;
  thinkingConfig?: ThinkingConfig;
  appState?: AppState;
}

export function createRuntime(options: CreateRuntimeOptions): Runtime {
  const state = options.state ?? createState();
  const tools = options.tools ?? [];

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
      messages: state.Messages,
      appState: options.appState,
      abortController: options.abortController,
      tokenizer: options.tokenizer,
      isNonInteractiveSession: options.isNonInteractiveSession,
      mainLoopModel: options.mainLoopModel,
      agentDefinitions: options.agentDefinitions,
      thinkingConfig: options.thinkingConfig,
    }),
  };
}
