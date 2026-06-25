import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { query } from "../../query.js";
import { createMessage, type Message } from "../../types/messages.js";
import { createRuntime, type Runtime } from "../../types/runtime.js";
import { createState, type State } from "../../types/state.js";
import type {
  AppState,
  PermissionMode,
  Tool,
  ToolPermissionContext,
} from "../types.js";
import type { AgentDefinition } from "./definitions.js";

export type AgentExecutionMode = "sync" | "async" | "fork";

export type AgentCompletedOutput = {
  status: "completed";
  mode: "sync" | "fork";
  agentId: string;
  agentType: string;
  description: string;
  result: string;
  messageCount: number;
};

export type AgentAsyncLaunchedOutput = {
  status: "async_launched";
  mode: "async";
  agentId: string;
  agentType: string;
  description: string;
  prompt: string;
  outputFile: string;
};

export type AgentOutput = AgentCompletedOutput | AgentAsyncLaunchedOutput;

export type RunAgentOptions = {
  parentRuntime: Runtime;
  parentState: State;
  agentDefinition: AgentDefinition;
  prompt: string;
  description: string;
  mode: AgentExecutionMode;
  maxTurns?: number;
  agentId?: string;
  recordTaskLifecycle?: boolean;
};

export async function runAgentTask(options: RunAgentOptions): Promise<AgentOutput> {
  if (options.mode === "async") {
    return launchAsyncAgent(options);
  }

  return runAgentSynchronously(options);
}

async function launchAsyncAgent(options: RunAgentOptions): Promise<AgentAsyncLaunchedOutput> {
  const agentId = createAgentId();
  const outputFile = getAgentOutputFile(agentId);

  registerAgentTask(options, agentId, "async", outputFile);

  void runAgentSynchronously({
    ...options,
    mode: "sync",
    agentId,
    recordTaskLifecycle: false,
  })
    .then(async (result) => {
      await writeAgentOutput(outputFile, result);
      completeAgentTask(options, agentId, result.result, outputFile);
    })
    .catch(async (error) => {
      const message = stringifyError(error);
      await writeAgentOutput(outputFile, {
        status: "failed",
        agentId,
        agentType: options.agentDefinition.agentType,
        description: options.description,
        error: message,
      });
      failAgentTask(options, agentId, message, outputFile);
    });

  return {
    status: "async_launched",
    mode: "async",
    agentId,
    agentType: options.agentDefinition.agentType,
    description: options.description,
    prompt: options.prompt,
    outputFile,
  };
}

async function runAgentSynchronously(
  options: RunAgentOptions,
): Promise<AgentCompletedOutput> {
  const agentId = options.agentId ?? createAgentId();
  const shouldRecordLifecycle = options.recordTaskLifecycle ?? true;

  if (shouldRecordLifecycle) {
    registerAgentTask(options, agentId, options.mode);
  }

  const childState = createChildAgentState(options);
  const childRuntime = createChildAgentRuntime(options, childState);

  let result = "";

  try {
    for await (const event of query(childRuntime, childState, {
      maxTurns: options.maxTurns ?? options.agentDefinition.maxTurns ?? 10,
      promptOptions: options.mode === "fork"
        ? undefined
        : {
          outputStyle: {
            name: `${options.agentDefinition.agentType} agent`,
            prompt: options.agentDefinition.getSystemPrompt(),
          },
        },
    })) {
      if (event.type === "assistant_message" && event.message.content) {
        result = event.message.content;
      }
    }

    if (shouldRecordLifecycle) {
      completeAgentTask(options, agentId, result);
    }

    return {
      status: "completed",
      mode: options.mode === "fork" ? "fork" : "sync",
      agentId,
      agentType: options.agentDefinition.agentType,
      description: options.description,
      result,
      messageCount: childState.Messages.length,
    };
  } catch (error) {
    if (shouldRecordLifecycle) {
      failAgentTask(options, agentId, stringifyError(error));
    }

    throw error;
  }
}

function buildInitialMessages(options: RunAgentOptions): Message[] {
  if (options.mode === "fork") {
    return [
      ...options.parentRuntime.toolUseContext.messages.map((message) => ({
        ...message,
      })),
      createMessage({
        role: "user",
        content: buildForkDirective(options.prompt),
      }),
    ];
  }

  return [
    createMessage({
      role: "user",
      content: options.prompt,
    }),
  ];
}

function createChildAgentState(options: RunAgentOptions): State {
  return createState({
    messages: buildInitialMessages(options),
    mode: options.agentDefinition.permissionMode === "plan" ? "plan" : "default",
  });
}

function createChildAgentRuntime(
  options: RunAgentOptions,
  childState: State,
): Runtime {
  const parent = options.parentRuntime;
  const childTools = options.mode === "fork"
    ? parent.tools
    : filterToolsForAgent(parent.tools, options.agentDefinition);

  return createRuntime({
    sessionId: parent.sessionId,
    agentId: "sub",
    cwd: parent.cwd,
    deepSeekRuntimeConfig: {
      ...parent.deepSeekRuntimeConfig,
      model: resolveAgentModel(
        options.agentDefinition.model,
        parent.deepSeekRuntimeConfig.model,
      ),
    },
    deepSeekClient: parent.deepSeekClient,
    contextProjectionState: parent.contextProjectionState,
    toolResultBudgetState: parent.toolResultBudgetState,
    MemoryConfig: parent.MemoryConfig,
    tools: childTools,
    messages: childState.Messages,
    tokenizer: parent.toolUseContext.tokenizer,
    isNonInteractiveSession: parent.toolUseContext.options.isNonInteractiveSession,
    mainLoopModel: parent.deepSeekRuntimeConfig.model,
    agentDefinitions: parent.toolUseContext.options.agentDefinitions,
    thinkingConfig: parent.toolUseContext.options.thinkingConfig,
    appState: deriveChildAppState(options),
    systemPrompt: options.mode === "fork" ? parent.systemPrompt : undefined,
  });
}

function deriveChildAppState(options: RunAgentOptions): AppState {
  const parentAppState = options.parentRuntime.toolUseContext.getAppState();

  return {
    ...parentAppState,
    toolPermissionContext: deriveChildPermissionContext(
      parentAppState.toolPermissionContext,
      options,
    ),
  };
}

function deriveChildPermissionContext(
  parent: ToolPermissionContext,
  options: RunAgentOptions,
): ToolPermissionContext {
  const mode = resolveChildPermissionMode(parent.mode, options);

  return {
    ...parent,
    mode,
    additionalWorkingDirectories: new Map(parent.additionalWorkingDirectories),
    alwaysAllowRules: clonePermissionRules(parent.alwaysAllowRules),
    alwaysDenyRules: clonePermissionRules(parent.alwaysDenyRules),
    alwaysAskRules: clonePermissionRules(parent.alwaysAskRules),
  };
}

function resolveChildPermissionMode(
  parentMode: PermissionMode,
  options: RunAgentOptions,
): PermissionMode {
  if (options.mode === "fork") {
    return parentMode;
  }

  return options.agentDefinition.permissionMode ?? parentMode;
}

function clonePermissionRules<T extends Record<string, string[] | undefined>>(
  rules: T,
): T {
  return Object.fromEntries(
    Object.entries(rules).map(([source, values]) => [
      source,
      values ? [...values] : values,
    ]),
  ) as T;
}

function filterToolsForAgent(
  tools: readonly Tool[],
  agentDefinition: AgentDefinition,
): Tool[] {
  const allowAll = !agentDefinition.tools || agentDefinition.tools.includes("*");
  const allowed = new Set(agentDefinition.tools ?? []);
  const denied = new Set(agentDefinition.disallowedTools ?? []);

  return tools.filter((tool) => {
    if (denied.has(tool.name)) {
      return false;
    }

    return allowAll || allowed.has(tool.name);
  });
}

function resolveAgentModel(
  agentModel: AgentDefinition["model"],
  parentModel: string,
): string {
  if (!agentModel || agentModel === "inherit") {
    return parentModel;
  }

  return agentModel;
}

function buildForkDirective(prompt: string): string {
  return `<fork_worker>
STOP. READ THIS FIRST.

You are a forked worker process. You are not the main agent.

Rules:
1. You inherit the parent conversation context above. Use it, but do not repeat it.
2. Do not spawn other agents.
3. Execute the directive directly using your tools.
4. Stay strictly within the directive's scope.
5. Keep your final report concise and factual.

Output format:
Scope: <the scope you handled>
Result: <answer or key findings>
Key files: <relevant file paths, if any>
Files changed: <files changed, if any>
Issues: <only if there are issues to flag>
</fork_worker>

Directive: ${prompt}`;
}

function createAgentId(): string {
  return `agent_${randomUUID()}`;
}

function registerAgentTask(
  options: RunAgentOptions,
  agentId: string,
  mode: AgentExecutionMode,
  outputFile?: string,
): void {
  const now = Date.now();

  options.parentState.agentTasks[agentId] = {
    id: agentId,
    agentType: options.agentDefinition.agentType,
    description: options.description,
    prompt: options.prompt,
    mode,
    status: "running",
    createdAt: now,
    updatedAt: now,
    outputFile,
  };
}

function completeAgentTask(
  options: RunAgentOptions,
  agentId: string,
  result: string,
  outputFile?: string,
): void {
  const now = Date.now();
  const existing = options.parentState.agentTasks[agentId];

  options.parentState.agentTasks[agentId] = {
    ...(existing ?? createTaskFallback(options, agentId, outputFile)),
    status: "completed",
    updatedAt: now,
    result,
    outputFile: outputFile ?? existing?.outputFile,
  };

  if (outputFile) {
    enqueueAgentNotification(options, agentId, "completed", outputFile);
  }
}

function failAgentTask(
  options: RunAgentOptions,
  agentId: string,
  error: string,
  outputFile?: string,
): void {
  const now = Date.now();
  const existing = options.parentState.agentTasks[agentId];

  options.parentState.agentTasks[agentId] = {
    ...(existing ?? createTaskFallback(options, agentId, outputFile)),
    status: "failed",
    updatedAt: now,
    error,
    outputFile: outputFile ?? existing?.outputFile,
  };

  if (outputFile) {
    enqueueAgentNotification(options, agentId, "failed", outputFile);
  }
}

function createTaskFallback(
  options: RunAgentOptions,
  agentId: string,
  outputFile?: string,
) {
  const now = Date.now();

  return {
    id: agentId,
    agentType: options.agentDefinition.agentType,
    description: options.description,
    prompt: options.prompt,
    mode: options.mode,
    status: "running" as const,
    createdAt: now,
    updatedAt: now,
    outputFile,
  };
}

function enqueueAgentNotification(
  options: RunAgentOptions,
  agentId: string,
  status: "completed" | "failed",
  outputFile?: string,
): void {
  options.parentState.agentNotifications.push({
    id: `agent_notification_${randomUUID()}`,
    agentTaskId: agentId,
    agentType: options.agentDefinition.agentType,
    description: options.description,
    status,
    createdAt: Date.now(),
    message: buildAgentNotificationMessage(options, agentId, status, outputFile),
    outputFile,
  });
}

function buildAgentNotificationMessage(
  options: RunAgentOptions,
  agentId: string,
  status: "completed" | "failed",
  outputFile?: string,
): string {
  const lines = [
    `<task-notification>`,
    `Agent task ${status}: ${options.description}`,
    `agent_id: ${agentId}`,
    `agent_type: ${options.agentDefinition.agentType}`,
  ];

  if (outputFile) {
    lines.push(`output_file: ${outputFile}`);
  }

  lines.push(`</task-notification>`);

  return lines.join("\n");
}

function getAgentOutputFile(agentId: string): string {
  return path.join(tmpdir(), "opencat-agents", `${agentId}.json`);
}

async function writeAgentOutput(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
}

function stringifyError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
