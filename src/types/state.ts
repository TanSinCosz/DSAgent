import type { AutoCompressState } from "./context.js";
import type { Message } from "./messages.js";
import {
  createSessionMemoryState,
  type SessionMemoryState,
} from "./session-memory.js";

export interface State {
  Messages: Message[];
  autoCompress: AutoCompressState;
  sessionMemory: SessionMemoryState;
  mode: "default" | "plan";
}

export interface CreateStateOptions {
  messages?: Message[];
  autoCompress?: AutoCompressState;
  sessionMemory?: SessionMemoryState;
  mode?: State["mode"];
}

export function createState(options: CreateStateOptions = {}): State {
  return {
    Messages: options.messages ?? [],
    autoCompress: options.autoCompress ?? {
      summaries: [],
      sessionMemoryUpdated: false,
    },
    sessionMemory: options.sessionMemory ?? createSessionMemoryState(),
    mode: options.mode ?? "default",
  };
}
