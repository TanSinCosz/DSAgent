import {
  createLongTermMemoryRuntimeConfig,
  type CreateLongTermMemoryRuntimeConfigOptions,
  type LongTermMemoryRuntimeConfig,
} from "../Memory/runtime.js";
import { MemoryTool } from "../Memory/Memory.js";
import type { MemoryConfig } from "../Memory/type.js";
import type { McpConnection } from "../mcp/index.js";
import {
  createTranscriptStore,
  type TranscriptStore,
} from "../transcript/persistence.js";
import { createAgentDefinitions } from "../Tools/Agent/index.js";
import { createDefaultTools } from "../Tools/index.js";
import { createDeepSeekClient, type DeepSeekClient } from "../deepseek/client.js";
import {
  createToolUseContext,
  type AgentDefinitionsResult,
  type AppState,
  type CanUseToolFn,
  type FileStateCache,
  type ThinkingConfig,
  type Tools,
  type ToolUseContext,
} from "../Tools/types.js";
import type { Tokenizer } from "../Tools/utils/Tokenizer.js";
import { createSessionId } from "../utils/session.js";
import {
  forceDeepSeekRuntimeSettings,
  type DeepSeekRuntimeSettings,
} from "./config.js";
import type { ContextProjectionState, ToolResultBudgetState } from "./context.js";
import type { RunObserver } from "../telemetry/observer.js";
import type { Message } from "./messages.js";

export type MainAgentId = "main";
export type SubAgentId = `agent_${string}`;
export type RuntimeAgentId = MainAgentId | SubAgentId;
export type RuntimeAgentRole = "main" | "subagent" | "session";

export interface RuntimeUsageStats {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  promptCacheHitTokens: number;
  promptCacheMissTokens: number;
}

export interface ContextCompressionConfig {
  /** Keep the normal message projection pipeline enabled by default. */
  enableProjection?: boolean;
  /** Override the auto-compress trigger for benchmark profiles. */
  autoCompressTriggerTokens?: number;
}

export interface Runtime {
  // Runtime identity.
  sessionId: string;
  agentId: RuntimeAgentId;
  agentRole: RuntimeAgentRole;
  parentAgentId?: RuntimeAgentId;
  agentType?: string;

  // Runtime capabilities and configuration.
  cwd: string;
  deepSeekRuntimeConfig: DeepSeekRuntimeSettings;
  deepSeekClient: DeepSeekClient;
  systemPrompt?: string;
  systemContext?: Record<string, string>;
  userContext?: Record<string, string>;
  contextProjectionState?: ContextProjectionState;
  toolResultBudgetState?: ToolResultBudgetState;
  contextCompressionConfig?: ContextCompressionConfig;
  /**
   * Internal fork policies must run before temporary command allow rules.
   * Ordinary interactive permission callbacks retain their existing behavior.
   */
  enforceCanUseToolBeforeTemporaryRules?: boolean;
  MemoryConfig: MemoryConfig;
  longTermMemory?: MemoryTool;
  longTermMemoryConfig: LongTermMemoryRuntimeConfig;
  transcriptStore?: TranscriptStore;
  observer?: RunObserver;
  usage: RuntimeUsageStats;

  tools: Tools;
  toolUseContext: ToolUseContext;
  mcpConnections: readonly McpConnection[];
  /**
   * Exact business-message prefix used by the latest parent model request.
   * Cache-safe forks reuse this prefix instead of rebuilding from raw State.
   */
  lastModelRequestContextMessages?: Message[];
}

export interface CreateRuntimeOptions {
  // Runtime fields.
  sessionId?: string;
  agentId?: Runtime["agentId"];
  agentRole?: Runtime["agentRole"];
  parentAgentId?: Runtime["parentAgentId"];
  agentType?: Runtime["agentType"];
  cwd?: string;
  deepSeekRuntimeConfig: DeepSeekRuntimeSettings;
  deepSeekClient?: DeepSeekClient;
  systemPrompt?: string;
  systemContext?: Record<string, string>;
  userContext?: Record<string, string>;
  contextProjectionState?: ContextProjectionState;
  toolResultBudgetState?: ToolResultBudgetState;
  contextCompressionConfig?: ContextCompressionConfig;
  enforceCanUseToolBeforeTemporaryRules?: boolean;
  MemoryConfig: MemoryConfig;
  longTermMemory?: MemoryTool;
  longTermMemoryConfig?: CreateLongTermMemoryRuntimeConfigOptions;
  transcriptStore?: TranscriptStore | false;
  observer?: RunObserver;
  usage?: RuntimeUsageStats;
  tools?: Tools;
  mcpConnections?: readonly McpConnection[];

  // ToolUseContext fields.
  abortController?: AbortController;
  tokenizer?: Tokenizer;
  isNonInteractiveSession?: boolean;
  mainLoopModel?: string;
  agentDefinitions?: AgentDefinitionsResult;
  thinkingConfig?: ThinkingConfig;
  appState?: AppState;
  readFileState?: FileStateCache;
  canUseTool?: CanUseToolFn;
}

export function createRuntime(options: CreateRuntimeOptions): Runtime {
  const sessionId = options.sessionId ?? createSessionId();
  const agentId = options.agentId ?? "main";
  const agentRole = options.agentRole ?? (agentId === "main" ? "main" : "subagent");
  const agentDefinitions = options.agentDefinitions ?? createAgentDefinitions();
  const tools = options.tools ?? createDefaultTools({ agentDefinitions });
  const cwd = options.cwd ?? process.cwd();
  const deepSeekRuntimeConfig = forceDeepSeekRuntimeSettings(
    options.deepSeekRuntimeConfig,
  );
  const transcriptStore = options.transcriptStore === false
    ? undefined
    : options.transcriptStore ??
      createTranscriptStore({
        cwd,
        sessionId,
        agentId,
        agentRole,
        parentAgentId: options.parentAgentId,
        agentType: options.agentType,
      });

  return {
    sessionId,
    agentId,
    agentRole,
    parentAgentId: options.parentAgentId,
    agentType: options.agentType,
    cwd,
    deepSeekRuntimeConfig,
    deepSeekClient:
      options.deepSeekClient ??
      createDeepSeekClient({
        config: deepSeekRuntimeConfig,
    }),
    systemPrompt: options.systemPrompt,
    systemContext: options.systemContext,
    userContext: options.userContext,
    contextProjectionState: options.contextProjectionState,
    toolResultBudgetState: options.toolResultBudgetState,
    contextCompressionConfig: options.contextCompressionConfig,
    enforceCanUseToolBeforeTemporaryRules:
      options.enforceCanUseToolBeforeTemporaryRules,
    MemoryConfig: options.MemoryConfig,
    longTermMemory: options.longTermMemory,
    longTermMemoryConfig: createLongTermMemoryRuntimeConfig(
      options.longTermMemoryConfig,
      { sessionId, agentId },
    ),
    transcriptStore,
    observer: options.observer,
    usage: options.usage ?? createRuntimeUsageStats(),
    tools,
    mcpConnections: options.mcpConnections ?? [],
    toolUseContext: createToolUseContext({
      tools,
      appState: options.appState,
      abortController: options.abortController,
      tokenizer: options.tokenizer,
      isNonInteractiveSession: options.isNonInteractiveSession,
      mainLoopModel: options.mainLoopModel,
      agentDefinitions,
      thinkingConfig: options.thinkingConfig,
      readFileState: options.readFileState,
      canUseTool: options.canUseTool,
    }),
  };
}

export function createRuntimeUsageStats(): RuntimeUsageStats {
  return {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    promptCacheHitTokens: 0,
    promptCacheMissTokens: 0,
  };
}
