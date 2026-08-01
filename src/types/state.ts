import type {
  AutoCompressState,
  HistorySnipBoundary,
  ToolResultBudgetState,
} from "./context.js";
import {
  createAgentNotificationsState,
  createAgentTasksState,
  type AgentNotification,
  type AgentTasksState,
} from "../Tools/Agent/state.js";
import {
  createBackgroundTaskNotificationsState,
  createBackgroundTasksState,
  type BackgroundTaskNotification,
  type BackgroundTasksState,
} from "../Tools/Bash/state.js";
import type { Message, MessageId } from "./messages.js";
import {
  createSessionMemoryState,
  type SessionMemoryState,
} from "./session-memory.js";
import type { TodoList } from "../Tools/TodoWrite/type.js";

export interface InvokedSkill {
  name: string;
  description: string;
  content: string;
  invokedAt: number;
  agentId: string | null;
  skillDir?: string;
  skillPath?: string;
}

export interface State {
  Messages: Message[];
  runtimeContextMessages: Message[];
  autoCompress: AutoCompressState;
  historySnips: HistorySnipBoundary[];
  toolResultBudgetState: ToolResultBudgetState;
  sessionMemory: SessionMemoryState;
  mode: "default" | "plan";
  plan?: PlanState;
  agentTasks: AgentTasksState;
  agentNotifications: AgentNotification[];
  backgroundTasks: BackgroundTasksState;
  backgroundTaskNotifications: BackgroundTaskNotification[];
  invokedSkills: InvokedSkill[];
  todos: Record<string, TodoList>;
  longTermMemory: LongTermMemoryState;
}

export interface PlanState {
  path: string;
  content: string;
  updatedAt: number;
}

export interface SurfacedLongTermMemoryFile {
  modifiedAtMs: number;
  injectedBytes: number;
}

export interface LongTermMemoryState {
  surfacedFiles: Record<string, SurfacedLongTermMemoryFile>;
  surfacedBytes: number;
  lastExtractedMessageId?: MessageId;
  retryFromMessageId?: MessageId;
}

export interface CreateStateOptions {
  messages?: Message[];
  runtimeContextMessages?: Message[];
  autoCompress?: AutoCompressState;
  historySnips?: HistorySnipBoundary[];
  toolResultBudgetState?: ToolResultBudgetState;
  sessionMemory?: SessionMemoryState;
  mode?: State["mode"];
  plan?: State["plan"];
  agentTasks?: AgentTasksState;
  agentNotifications?: AgentNotification[];
  backgroundTasks?: BackgroundTasksState;
  backgroundTaskNotifications?: BackgroundTaskNotification[];
  invokedSkills?: InvokedSkill[];
  todos?: Record<string, TodoList>;
  longTermMemory?: LongTermMemoryState;
}

export function createState(options: CreateStateOptions = {}): State {
  return {
    Messages: options.messages ?? [],
    runtimeContextMessages: options.runtimeContextMessages ?? [],
    autoCompress: options.autoCompress ?? {
      summaries: [],
      sessionMemoryUpdated: false,
    },
    historySnips: options.historySnips ?? [],
    toolResultBudgetState: options.toolResultBudgetState ?? {
      seenIds: new Set(),
      replacements: new Map(),
    },
    sessionMemory: options.sessionMemory ?? createSessionMemoryState(),
    mode: options.mode ?? "default",
    plan: options.plan,
    agentTasks: options.agentTasks ?? createAgentTasksState(),
    agentNotifications: options.agentNotifications ??
      createAgentNotificationsState(),
    backgroundTasks: options.backgroundTasks ?? createBackgroundTasksState(),
    backgroundTaskNotifications: options.backgroundTaskNotifications ??
      createBackgroundTaskNotificationsState(),
    invokedSkills: options.invokedSkills ?? [],
    todos: options.todos ?? {},
    longTermMemory: options.longTermMemory ?? {
      surfacedFiles: {},
      surfacedBytes: 0,
    },
  };
}
