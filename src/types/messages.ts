import { randomUUID } from "node:crypto";
import type {
  DeepSeekAssistantMessage,
  DeepSeekMessage,
  DeepSeekSystemMessage,
  DeepSeekToolMessage,
  DeepSeekUserMessage,
} from "../deepseek/types.js";

export type MessageId = `msg_${string}`;
export type ToolResultId = `tool_result_${string}`;

type MessageMeta = {
  id: MessageId;
  createdAt: number;
};

export type PersistedToolResult = {
  path: string;
  absolutePath: string;
  size: number;
  sha256: string;
  previewChars: number;
  originalContentType: "text";
};

export type SystemMessage = DeepSeekSystemMessage & MessageMeta;
export type UserMessage = DeepSeekUserMessage & MessageMeta;
export type AssistantMessage = DeepSeekAssistantMessage & MessageMeta;
export type ToolMessage = DeepSeekToolMessage & MessageMeta & {
  toolName?: string;
  toolResultId?: ToolResultId;
  persistedToolResult?: PersistedToolResult;
};

export type Message =
  | SystemMessage
  | UserMessage
  | AssistantMessage
  | ToolMessage;

export function createMessage(message: DeepSeekMessage): Message {
  return {
    ...message,
    id: createMessageId(),
    createdAt: Date.now(),
  } as Message;
}

export function toDeepSeekMessage(message: Message): DeepSeekMessage {
  switch (message.role) {
    case "system": {
      const { id: _id, createdAt: _createdAt, ...deepSeekMessage } = message;
      return deepSeekMessage;
    }
    case "user": {
      const { id: _id, createdAt: _createdAt, ...deepSeekMessage } = message;
      return deepSeekMessage;
    }
    case "assistant": {
      const { id: _id, createdAt: _createdAt, ...deepSeekMessage } = message;
      return deepSeekMessage;
    }
    case "tool": {
      const {
        id: _id,
        createdAt: _createdAt,
        toolName: _toolName,
        toolResultId: _toolResultId,
        persistedToolResult: _persistedToolResult,
        ...deepSeekMessage
      } = message;
      return deepSeekMessage;
    }
  }
}

function createMessageId(): MessageId {
  return `msg_${randomUUID()}`;
}
